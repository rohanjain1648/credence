import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/lib/db/client";
import { memories, picks, sharpLines, venuePairs } from "@/lib/db/schema";
import { decodeMemory } from "@/lib/memory/format";
import { createEngineCtx, type EngineCtx } from "@/engine/ctx";
import { upsertMarkets } from "@/engine/markets";
import { biasReport, createPick, PickError, scorePick, settlePicksForMarket, userScore, type SettledPick } from "@/engine/picks";
import { processResolutions } from "@/engine/resolve";
import { createTestDb } from "../helpers/db";
import { makeMarket, NOW } from "../helpers/factories";
import { fakeTatum } from "../helpers/fakeTatum";

let db: Db;
let ctx: EngineCtx;
const CLOSE = Date.parse("2026-11-04T23:00:00Z");

beforeEach(async () => {
  db = await createTestDb();
  ctx = createEngineCtx({ db, tatum: null, memory: null, now: () => NOW, log: () => {} });
  await upsertMarkets(ctx, [
    makeMarket({ outcomes: [{ name: "Lakers", price: 0.4, tokenId: "t0" }, { name: "Celtics", price: 0.6, tokenId: "t1" }] }),
  ]);
});

const base = { handle: "Ravi", marketId: "0xmarket1", outcomeIndex: 0 as const, confidence: 0.7 };
const codeOf = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof PickError ? e.code : String(e)));

describe("picks", () => {
  test("rejects picks at or after close time", async () => {
    const atClose = createEngineCtx({ db, tatum: null, memory: null, now: () => CLOSE, log: () => {} });
    expect(await codeOf(createPick(atClose, base))).toBe("MARKET_CLOSED");
  });

  test("rejects resolved market", async () => {
    await upsertMarkets(ctx, [makeMarket({ resolution: { outcome: "Lakers", resolvedAt: null, txHash: null, source: null } })]);
    expect(await codeOf(createPick(ctx, base))).toBe("MARKET_CLOSED");
  });

  test("rejects bad confidence, handle, outcome and unknown market", async () => {
    expect(await codeOf(createPick(ctx, { ...base, confidence: 0.4 }))).toBe("BAD_CONFIDENCE");
    expect(await codeOf(createPick(ctx, { ...base, confidence: 1.0 }))).toBe("BAD_CONFIDENCE");
    expect(await codeOf(createPick(ctx, { ...base, handle: "A!" }))).toBe("BAD_HANDLE");
    expect(await codeOf(createPick(ctx, { ...base, outcomeIndex: 2 as 0 }))).toBe("BAD_OUTCOME");
    expect(await codeOf(createPick(ctx, { ...base, marketId: "nope" }))).toBe("MARKET_NOT_FOUND");
  });

  test("stores price at pick and enqueues pick memory in user namespace", async () => {
    const pick = await createPick(ctx, { ...base, reason: "  healthy defense  " });
    expect(pick).toMatchObject({ handle: "ravi", outcomeName: "Lakers", priceAtPick: 0.4, confidence: 0.7, reason: "healthy defense", status: "open", createdAt: NOW });
    const [mem] = await db.select().from(memories).where(eq(memories.id, pick.memoryId!));
    expect(mem).toMatchObject({ namespace: "credence-user-ravi", kind: "pick", refType: "pick", refId: pick.id });
    const human = decodeMemory(mem.text)!.human;
    expect(human).toContain("@ravi picked Lakers");
    expect(human).toContain("70%");
    expect(human).toContain("40%");
    expect(human).toContain("healthy defense");
  });

  test("records Kalshi and Sharp Line prices in the picked outcome's terms", async () => {
    await upsertMarkets(ctx, [makeMarket({ id: "KX", platform: "kalshi", outcomes: [{ name: "Yes", price: 0.45, tokenId: null }, { name: "No", price: 0.55, tokenId: null }] })]);
    await db.insert(venuePairs).values({ polyId: "0xmarket1", kalshiId: "KX", flip: false, score: 1, method: "manual" });
    await db.insert(sharpLines).values({ marketId: "0xmarket1", snapshotId: "s", ts: NOW - 1000, priceA: 0.4, consensus: 0.8, line: 0.5, weight: 2, lambda: 0.25, contributors: [] });
    const pick = await createPick(ctx, { ...base, outcomeIndex: 1 });
    expect(pick.priceAtPick).toBe(0.6);
    expect(pick.kalshiAtPick).toBeCloseTo(0.55, 10);
    expect(pick.lineAtPick).toBeCloseTo(0.5, 10);
  });

  test("scorePick exact", () => {
    expect(scorePick({ confidence: 0.7, priceAtPick: 0.4 }, 1)).toEqual({
      edge: 0.6,
      brierUser: expect.closeTo(0.09, 10),
      brierMarket: expect.closeTo(0.36, 10),
    });
  });

  test("settle writes scorecard memory and status won/lost", async () => {
    const winner = await createPick(ctx, base);
    const loser = await createPick(ctx, { ...base, handle: "kim", outcomeIndex: 1 });
    expect(await settlePicksForMarket(ctx, "0xmarket1", 0)).toBe(2);
    const rows = await db.select().from(picks);
    expect(rows.find((p) => p.id === winner.id)).toMatchObject({ status: "won", y: 1, edge: expect.closeTo(0.6, 10), settledAt: NOW });
    expect(rows.find((p) => p.id === loser.id)).toMatchObject({ status: "lost", y: 0, edge: expect.closeTo(-0.6, 10) });
    const cards = (await db.select().from(memories)).filter((m) => m.kind === "scorecard");
    expect(cards.map((c) => c.namespace).sort()).toEqual(["credence-user-kim", "credence-user-ravi"]);
    expect(await settlePicksForMarket(ctx, "0xmarket1", 0)).toBe(0);
  });

  test("resolutions settle open picks", async () => {
    await createPick(ctx, base);
    await db.insert(sharpLines).values({ marketId: "0xmarket1", snapshotId: "s", ts: CLOSE - 1000, priceA: 0.4, consensus: 0.8, line: 0.5, weight: 2, lambda: 0.25, contributors: [] });
    const later = createEngineCtx({
      db,
      tatum: fakeTatum({ getMarket: async () => makeMarket({ resolution: { outcome: "Lakers", resolvedAt: "2026-11-05T03:00:00Z", txHash: null, source: "uma" } }) }),
      memory: null,
      now: () => CLOSE + 3_600_000,
      log: () => {},
    });
    await processResolutions(later, { maxMarkets: 20 });
    const [p] = await db.select().from(picks);
    expect(p.status).toBe("won");
  });

  test("biasReport overconfidence = mean confidence - hit rate", () => {
    const settled: SettledPick[] = [
      { confidence: 0.8, priceAtPick: 0.7, y: 1, edge: 0.3, group: "SPORTS" },
      { confidence: 0.9, priceAtPick: 0.6, y: 0, edge: -0.6, group: "SPORTS" },
      { confidence: 0.7, priceAtPick: 0.5, y: 0, edge: -0.5, group: "POLITICS" },
    ];
    const r = biasReport(settled);
    expect(r.n).toBe(3);
    expect(r.hitRate).toBeCloseTo(1 / 3, 10);
    expect(r.overconfidence).toBeCloseTo(0.8 - 1 / 3, 10);
    expect(r.favoriteLean).toBeCloseTo(0.6, 10);
    expect(r.byGroup.SPORTS).toEqual({ n: 2, edge: expect.closeTo(-0.15, 10) });
    expect(biasReport([])).toEqual({ n: 0, hitRate: 0, overconfidence: 0, favoriteLean: 0, byGroup: {} });
  });

  test("userScore reuses the wallet credibility formula", () => {
    const s = userScore([{ confidence: 0.6, priceAtPick: 0.5, y: 1, edge: 0.5, group: "SPORTS" }]);
    expect(s.n).toBe(1);
    expect(s.credibility).toBeGreaterThan(50);
  });
});
