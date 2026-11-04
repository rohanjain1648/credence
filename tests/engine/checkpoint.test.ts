import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/lib/db/client";
import { checkpoints, lambdas, memories, voiceScores } from "@/lib/db/schema";
import { decodeMemory } from "@/lib/memory/format";
import { writeCheckpoint, type CheckpointPayload } from "@/engine/checkpoint";
import { createEngineCtx, type EngineCtx } from "@/engine/ctx";
import { createTestDb } from "../helpers/db";
import { NOW } from "../helpers/factories";

let db: Db;
let ctx: EngineCtx;

beforeEach(async () => {
  db = await createTestDb();
  ctx = createEngineCtx({ db, tatum: null, memory: null, now: () => NOW, log: () => {} });
});

const score = (voiceId: string, group: string, credibility: number, n: number, asOf = NOW - 1000) => ({
  voiceId,
  group,
  asOf,
  n,
  wins: 0,
  edge: 0,
  z: 0,
  credibility,
  pnl: 0,
  volume: 0,
});

describe("checkpoints", () => {
  test("payload carries lambdas and the strongest voices with enough history", async () => {
    await db.insert(lambdas).values([
      { group: "SPORTS", asOf: 1, lambda: 0.2, n: 1 },
      { group: "SPORTS", asOf: 2, lambda: 0.31, n: 2 },
      { group: "POLITICS", asOf: 2, lambda: 0.08, n: 5 },
    ]);
    await db.insert(voiceScores).values([
      score("0xa", "SPORTS", 70, 30, NOW - 5000),
      score("0xa", "SPORTS", 84, 31),
      score("0xb", "POLITICS", 60, 25),
      score("0xc", "SPORTS", 99, 3),
    ]);
    const seq = await writeCheckpoint(ctx, "resolutions");
    expect(seq).toBe(1);
    const [cp] = await db.select().from(checkpoints);
    const payload = cp.payload as CheckpointPayload;
    expect(payload).toMatchObject({ seq: 1, prevBlobId: null, reason: "resolutions", asOf: NOW, lambda: { SPORTS: 0.31, POLITICS: 0.08 } });
    expect(payload.voices).toEqual([
      ["0xa", "SPORTS", 84, 31],
      ["0xb", "POLITICS", 60, 25],
    ]);
    const [mem] = await db.select().from(memories).where(eq(memories.id, cp.memoryId!));
    expect(mem).toMatchObject({ namespace: "credence-checkpoints", kind: "checkpoint" });
    expect(decodeMemory(mem.text)!.human).toContain("Checkpoint #1");
  });

  test("checkpoint chain links prevBlobId and increments seq", async () => {
    await writeCheckpoint(ctx, "first");
    const [first] = await db.select().from(checkpoints);
    await db.update(memories).set({ status: "stored", blobId: "b1" }).where(eq(memories.id, first.memoryId!));
    const seq = await writeCheckpoint(ctx, "second");
    expect(seq).toBe(2);
    const [second] = await db.select().from(checkpoints).where(eq(checkpoints.seq, 2));
    expect((second.payload as CheckpointPayload).prevBlobId).toBe("b1");
    expect(second.prevBlobId).toBe("b1");
  });
});
