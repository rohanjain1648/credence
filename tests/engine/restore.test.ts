import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { NoCheckpointError, restoreFromWalrus, writeCheckpoint, type CheckpointPayload } from "@/engine/checkpoint";
import { createEngineCtx } from "@/engine/ctx";
import { getLambda } from "@/engine/sharp";
import { latestCredibility } from "@/engine/voices";
import type { Db } from "@/lib/db/client";
import { checkpoints, lambdas, memories, voiceScores } from "@/lib/db/schema";
import type { MemWalLike } from "@/lib/memory/client";
import { encodeMemory } from "@/lib/memory/format";
import { createTestDb } from "../helpers/db";
import { NOW } from "../helpers/factories";
import { fakeMemory } from "../helpers/fakeMemory";

let db: Db;

const payload = (seq: number, o: Partial<CheckpointPayload> = {}): CheckpointPayload => ({
  seq,
  prevBlobId: null,
  asOf: NOW - 1000,
  reason: "resolutions",
  lambda: { SPORTS: 0.31, POLITICS: 0.08 },
  stats: { resolved: 12, brierMarket: 0.2, brierCredence: 0.19 },
  voices: [
    ["0xa", "SPORTS", 84, 31],
    ["0xb", "OVERALL", 60, 25],
  ],
  ...o,
});
const hit = (seq: number, blob: string) => ({
  blob_id: blob,
  text: encodeMemory("checkpoint", `Credence trust model — Checkpoint #${seq}`, payload(seq)),
  distance: 0.1,
  created_at: "2026-11-05T00:00:00Z",
});
const ctxWith = (memory: MemWalLike | null) => createEngineCtx({ db, tatum: null, memory, now: () => NOW, log: () => {} });

async function seedStaleModel() {
  await db.insert(voiceScores).values({ voiceId: "0xstale", group: "SPORTS", asOf: 1, n: 40, wins: 1, edge: 0, z: 0, credibility: 99, pnl: 0, volume: 0 });
  await db.insert(lambdas).values({ group: "SPORTS", asOf: 1, lambda: 0.5, n: 1 });
  await db.insert(checkpoints).values({ seq: 1, ts: 1, payload: {} });
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("restoreFromWalrus", () => {
  test("replaces the local trust model with the latest checkpoint", async () => {
    await seedStaleModel();
    const mem = fakeMemory();
    mem.recallResults = [hit(37, "blob-37")];
    mem.listed = Array.from({ length: 3 }, (_, i) => ({ id: `m${i}` })) as never;

    const report = await restoreFromWalrus(ctxWith(mem));

    expect(report).toMatchObject({ checkpointSeq: 37, blobId: "blob-37", voicesRestored: 2, lambdas: { SPORTS: 0.31, POLITICS: 0.08 }, memoriesOnWalrus: 3 });
    expect(report.ms).toBeGreaterThanOrEqual(0);
    expect(mem.recallCalls[0]).toMatchObject({ namespace: "credence-checkpoints", sort: "recent" });

    const voices = await db.select().from(voiceScores);
    expect(voices.map((v) => [v.voiceId, v.group, v.credibility, v.n]).sort()).toEqual([
      ["0xa", "SPORTS", 84, 31],
      ["0xb", "OVERALL", 60, 25],
    ]);
    expect((await db.select().from(lambdas)).map((l) => [l.group, l.lambda]).sort()).toEqual([
      ["POLITICS", 0.08],
      ["SPORTS", 0.31],
    ]);
    expect((await db.select().from(checkpoints)).map((c) => c.seq)).toEqual([37]);
  });

  test("the engine uses the restored numbers", async () => {
    await seedStaleModel();
    const mem = fakeMemory();
    mem.recallResults = [hit(37, "blob-37")];
    const ctx = ctxWith(mem);

    await restoreFromWalrus(ctx);

    expect(await getLambda(ctx, "SPORTS")).toBe(0.31);
    expect(await latestCredibility(ctx, "0xa", "SPORTS")).toBe(84);
    expect(await latestCredibility(ctx, "0xstale", "SPORTS")).toBeNull();
  });

  test("uses the highest checkpoint number among the results", async () => {
    const mem = fakeMemory();
    mem.recallResults = [hit(36, "blob-36"), hit(38, "blob-38"), hit(37, "blob-37")];
    expect((await restoreFromWalrus(ctxWith(mem))).checkpointSeq).toBe(38);
  });

  test("ignores recalled text that isn't a checkpoint", async () => {
    const mem = fakeMemory();
    mem.recallResults = [{ blob_id: "x", text: "free text", distance: 0.1 }, hit(5, "blob-5")];
    expect((await restoreFromWalrus(ctxWith(mem))).checkpointSeq).toBe(5);
  });

  test("with no checkpoint on Walrus nothing is wiped", async () => {
    await seedStaleModel();
    await expect(restoreFromWalrus(ctxWith(fakeMemory()))).rejects.toBeInstanceOf(NoCheckpointError);
    expect(await db.select().from(voiceScores)).toHaveLength(1);
    expect(await db.select().from(lambdas)).toHaveLength(1);
    expect(await db.select().from(checkpoints)).toHaveLength(1);
  });

  test("when recall fails nothing is wiped", async () => {
    await seedStaleModel();
    const mem = fakeMemory();
    mem.recall = async () => {
      throw new Error("relayer down");
    };
    await expect(restoreFromWalrus(ctxWith(mem))).rejects.toThrow("relayer down");
    expect(await db.select().from(voiceScores)).toHaveLength(1);
  });

  test("when counting memories fails nothing is wiped", async () => {
    await seedStaleModel();
    const mem = fakeMemory();
    mem.recallResults = [hit(5, "blob-5")];
    mem.listMemories = async () => {
      throw new Error("relayer down");
    };
    await expect(restoreFromWalrus(ctxWith(mem))).rejects.toThrow("relayer down");
    expect((await db.select().from(voiceScores)).map((v) => v.voiceId)).toEqual(["0xstale"]);
  });

  test("counts memories across pages", async () => {
    const mem = fakeMemory();
    mem.recallResults = [hit(5, "blob-5")];
    const page = (n: number, next: string | null) => ({
      memories: Array.from({ length: n }, () => ({})) as never,
      next_cursor: next,
      has_more: next !== null,
      snapshot_version: 1,
      deleted: [],
      must_resync: false,
    });
    mem.listMemories = async (o) => (o?.cursor ? page(2, null) : page(100, "c1"));
    expect((await restoreFromWalrus(ctxWith(mem))).memoriesOnWalrus).toBe(102);
  });

  test("without Walrus Memory it refuses", async () => {
    await seedStaleModel();
    await expect(restoreFromWalrus(ctxWith(null))).rejects.toThrow(/not configured/i);
    expect(await db.select().from(voiceScores)).toHaveLength(1);
  });

  test("the next checkpoint continues the chain, even from an empty database", async () => {
    const mem = fakeMemory();
    mem.recallResults = [hit(37, "blob-37")];
    const ctx = ctxWith(mem);
    await restoreFromWalrus(ctx);

    expect(await writeCheckpoint(ctx, "after restore")).toBe(38);

    const [next] = await db.select().from(checkpoints).where(eq(checkpoints.seq, 38));
    expect((next.payload as CheckpointPayload).prevBlobId).toBe("blob-37");
  });

  test("a checkpoint already indexed locally is not duplicated in the memory feed", async () => {
    await db.insert(memories).values({ id: "m1", namespace: "credence-checkpoints", kind: "checkpoint", text: "x", status: "stored", blobId: "blob-37", createdAt: 1 });
    const mem = fakeMemory();
    mem.recallResults = [hit(37, "blob-37")];
    await restoreFromWalrus(ctxWith(mem));
    expect(await db.select().from(memories)).toHaveLength(1);
    expect((await db.select().from(checkpoints))[0].memoryId).toBe("m1");
  });
});
