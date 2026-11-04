import { beforeEach, describe, expect, test } from "vitest";
import type { CheckpointPayload } from "@/engine/checkpoint";
import { createEngineCtx } from "@/engine/ctx";
import { upsertMarkets } from "@/engine/markets";
import type { Db } from "@/lib/db/client";
import { apiUsage, checkpoints, holderSnapshots, lambdas, memories, sharpLines, snapshots } from "@/lib/db/schema";
import { describeEffect } from "@/lib/format";
import { encodeMemory } from "@/lib/memory/format";
import { getBrainView, getTimeMachine } from "@/lib/queries";
import { createTestDb } from "../helpers/db";
import { makeMarket, NOW } from "../helpers/factories";

let db: Db;

const memory = (id: string, namespace: string, status: string, createdAt: number, o: Partial<typeof memories.$inferInsert> = {}) => ({
  id,
  namespace,
  kind: "lesson",
  text: encodeMemory("lesson", `Memory ${id}`, {}),
  status,
  createdAt,
  ...o,
});

const payload = (seq: number, voices: CheckpointPayload["voices"], lambda: CheckpointPayload["lambda"]): CheckpointPayload => ({
  seq,
  prevBlobId: null,
  asOf: NOW - seq,
  reason: "resolutions",
  lambda,
  stats: { resolved: seq, brierMarket: null, brierCredence: null },
  voices,
});

beforeEach(async () => {
  db = await createTestDb();
});

describe("getBrainView", () => {
  test("feed is newest first with decoded text and effects", async () => {
    await db.insert(memories).values([
      memory("a", "credence-lessons", "stored", 1, { blobId: "blob-a", effect: { type: "lambda", group: "SPORTS", before: 0.25, after: 0.31 } }),
      memory("b", "credence-calls", "queued", 2),
    ]);
    const view = await getBrainView(db, NOW);
    expect(view.feed.map((m) => [m.id, m.human, m.status, m.blobId])).toEqual([
      ["b", "Memory b", "queued", null],
      ["a", "Memory a", "stored", "blob-a"],
    ]);
    expect(view.feed[1].effect).toBe("λ SPORTS 0.25 to 0.31");
  });

  test("feed is limited to 100", async () => {
    await db.insert(memories).values(Array.from({ length: 105 }, (_, i) => memory(`m${i}`, "n", "queued", i)));
    expect((await getBrainView(db, NOW)).feed).toHaveLength(100);
  });

  test("counts by namespace and status", async () => {
    await db.insert(memories).values([
      memory("a", "credence-lessons", "stored", 1),
      memory("b", "credence-lessons", "failed", 2),
      memory("c", "credence-user-ravi", "sent", 3),
      memory("d", "credence-user-kim", "queued", 4),
    ]);
    const view = await getBrainView(db, NOW);
    expect(view.counts).toMatchObject({ stored: 1, onTheWay: 2, failed: 1, total: 4 });
    expect(view.counts.byNamespace).toEqual([
      { namespace: "credence-lessons", n: 2 },
      { namespace: "credence-user", n: 2 },
    ]);
  });

  test("reports today's credits, the latest λ per category and the checkpoints", async () => {
    await db.insert(apiUsage).values([
      { provider: "tatum", endpoint: "/x", credits: 300, status: 200, ts: NOW - 1000 },
      { provider: "tatum", endpoint: "/x", credits: 999, status: 200, ts: NOW - 86_400_000 },
    ]);
    await db.insert(lambdas).values([
      { group: "SPORTS", asOf: 1, lambda: 0.2, n: 1 },
      { group: "SPORTS", asOf: 2, lambda: 0.31, n: 4 },
    ]);
    await db.insert(checkpoints).values([
      { seq: 1, ts: 10, payload: payload(1, [], {}) },
      { seq: 2, ts: 20, payload: payload(2, [], {}) },
    ]);
    const view = await getBrainView(db, NOW);
    expect(view.creditsToday).toBe(300);
    expect(view.lambdas).toEqual([{ group: "SPORTS", lambda: 0.31, n: 4 }]);
    expect(view.checkpoints.map((c) => c.seq)).toEqual([1, 2]);
    expect(view.curve).toEqual([]);
  });
});

describe("getTimeMachine", () => {
  async function trackedMarket(id = "0xmarket1", closeTime = "2026-11-04T23:00:00Z", resolution: { outcome: string } | null = null) {
    const ctx = createEngineCtx({ db, tatum: null, memory: null, now: () => NOW, log: () => {} });
    await upsertMarkets(ctx, [
      makeMarket({
        id,
        closeTime,
        outcomes: [{ name: "Lakers", price: 0.5, tokenId: "t0" }, { name: "Celtics", price: 0.5, tokenId: "t1" }],
        resolution: resolution ? { ...resolution, resolvedAt: null, txHash: null, source: null } : null,
      }),
    ]);
    await db.insert(snapshots).values({ id: `s-${id}`, marketId: id, ts: NOW - 1000, kind: "routine", prices: [0.5, 0.5] });
    await db.insert(holderSnapshots).values([
      { snapshotId: `s-${id}`, marketId: id, address: "0xa", outcomeIndex: 0, size: 1, avgPrice: 0.5, currentValue: 1000 },
      { snapshotId: `s-${id}`, marketId: id, address: "0xb", outcomeIndex: 1, size: 1, avgPrice: 0.5, currentValue: 1000 },
    ]);
    await db.insert(sharpLines).values({ marketId: id, snapshotId: `s-${id}`, ts: NOW - 1000, priceA: 0.5, consensus: 0.7, line: 0.55, weight: 2, lambda: 0.25, contributors: [] });
  }

  test("unknown checkpoint is null", async () => {
    expect(await getTimeMachine(db, 99, NOW)).toBeNull();
  });

  test("recomputes Sharp Lines with what Credence believed then", async () => {
    await trackedMarket();
    await db.insert(checkpoints).values({
      seq: 3,
      ts: 500,
      payload: payload(3, [["0xa", "SPORTS", 80, 40], ["0xb", "SPORTS", 60, 30]], { SPORTS: 0.25 }),
    });

    const view = await getTimeMachine(db, 3, NOW);

    expect(view).toMatchObject({ seq: 3, ts: 500, reason: "resolutions", lambda: { SPORTS: 0.25 } });
    expect(view?.voices).toHaveLength(2);
    expect(view?.lines).toHaveLength(1);
    expect(view?.lines[0]).toMatchObject({ marketId: "0xmarket1", question: "Lakers vs. Celtics", priceA: 0.5, lineNow: 0.55 });
    expect(view?.lines[0].lineThen).toBeCloseTo(0.6, 6);
  });

  test("falls back to the overall score and the prior λ, like the live engine", async () => {
    await trackedMarket();
    await db.insert(checkpoints).values({
      seq: 1,
      ts: 500,
      payload: payload(1, [["0xa", "OVERALL", 80, 40], ["0xb", "OVERALL", 60, 30]], {}),
    });
    expect((await getTimeMachine(db, 1, NOW))?.lines[0].lineThen).toBeCloseTo(0.6, 6);
  });

  test("with too little credible money then, the line is empty", async () => {
    await trackedMarket();
    await db.insert(checkpoints).values({ seq: 1, ts: 500, payload: payload(1, [], {}) });
    expect((await getTimeMachine(db, 1, NOW))?.lines[0].lineThen).toBeNull();
  });

  test("closed and resolved markets are left out", async () => {
    await trackedMarket("closed", "2026-10-01T00:00:00Z");
    await trackedMarket("resolved", "2026-11-04T23:00:00Z", { outcome: "Lakers" });
    await db.insert(checkpoints).values({ seq: 1, ts: 500, payload: payload(1, [], {}) });
    expect((await getTimeMachine(db, 1, NOW))?.lines).toEqual([]);
  });
});

describe("describeEffect", () => {
  test.each([
    [{ type: "lambda", group: "SPORTS", before: 0.25, after: 0.31 }, "λ SPORTS 0.25 to 0.31"],
    [{ type: "credibility", group: "SPORTS", before: 70.2, after: 81.4 }, "Credibility on SPORTS 70 to 81"],
    [{ type: "credibility", group: "SPORTS", before: null, after: 81.4 }, "Credibility on SPORTS set to 81"],
    [{ type: "call", priceA: 0.41, line: 0.5 }, "Sharp Line 50% against a crowd at 41%"],
    [{ type: "call", priceA: 0.41, line: null }, "Crowd at 41%, no Sharp Line"],
    [{ type: "checkpoint", seq: 37 }, "Checkpoint #37"],
  ])("%o", (effect, text) => expect(describeEffect(effect)).toBe(text));

  test("anything else has no description", () => {
    expect(describeEffect(null)).toBeNull();
    expect(describeEffect({ type: "unknown" })).toBeNull();
  });
});
