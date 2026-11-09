import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/lib/db/client";
import { holderSnapshots, lambdas, memories, sharpLines, snapshots, venuePairs, voiceScores, wallets } from "@/lib/db/schema";
import { getHeaderStats, getMarketView, getRadar } from "@/lib/queries";
import { createEngineCtx } from "@/engine/ctx";
import { upsertMarkets } from "@/engine/markets";
import { createTestDb } from "../helpers/db";
import { makeMarket, NOW } from "../helpers/factories";

let db: Db;
const noSlug = (id: string) => ({ source: { platform: "polymarket", platformId: id, url: null } });

const two = (a: number) => [
  { name: "Yes", price: a, tokenId: null },
  { name: "No", price: 1 - a, tokenId: null },
];

async function line(marketId: string, priceA: number, l: number | null, ts = NOW - 1000) {
  await db.insert(sharpLines).values({ marketId, snapshotId: `s-${marketId}`, ts, priceA, consensus: l === null ? null : 0.8, line: l, weight: 2, lambda: 0.25, contributors: [] });
}

beforeEach(async () => {
  db = await createTestDb();
  const ctx = createEngineCtx({ db, tatum: null, memory: null, now: () => NOW, log: () => {} });
  await upsertMarkets(ctx, [
    makeMarket({ id: "big-sharp", eventId: "e1", question: "Lakers vs. Celtics", outcomes: two(0.4), volume: 10 }),
    makeMarket({ id: "venue", eventId: "e2", question: "Will the Senate flip in 2026?", outcomes: two(0.5), volume: 20, ...noSlug("venue") }),
    makeMarket({ id: "quiet", eventId: "e3", question: "Bitcoin above 100k on Nov 7?", outcomes: two(0.5), volume: 30, ...noSlug("quiet") }),
    makeMarket({ id: "closed", question: "Closed one", outcomes: two(0.5), closeTime: "2026-10-01T00:00:00Z" }),
    makeMarket({ id: "resolved", question: "Done", outcomes: two(0.5), resolution: { outcome: "Yes", resolvedAt: null, txHash: null, source: null } }),
    makeMarket({ id: "KX", platform: "kalshi", question: "Senate flip?", outcomes: two(0.55) }),
  ]);
  await line("big-sharp", 0.4, 0.5);
  await line("venue", 0.5, null);
  await db.insert(venuePairs).values({ polyId: "venue", kalshiId: "KX", flip: false, score: 0.9, method: "auto" });
});

describe("radar", () => {
  test("orders by the biggest credible or venue gap, gaps first", async () => {
    const rows = await getRadar(db, { limit: 10, now: NOW });
    expect(rows.map((r) => r.market.id)).toEqual(["big-sharp", "venue", "quiet"]);
    expect(rows[0]).toMatchObject({ priceA: 0.4, line: 0.5, sharpGap: expect.closeTo(0.1, 10), venueGap: null });
    expect(rows[1]).toMatchObject({ kalshiA: 0.55, venueGap: expect.closeTo(0.05, 10), line: null });
  });

  test("excludes closed, resolved and kalshi markets", async () => {
    const ids = (await getRadar(db, { limit: 10, now: NOW })).map((r) => r.market.id);
    expect(ids).not.toContain("closed");
    expect(ids).not.toContain("resolved");
    expect(ids).not.toContain("KX");
  });

  test("hides near-certain long shots unless asked", async () => {
    const ctx = createEngineCtx({ db, tatum: null, memory: null, now: () => NOW, log: () => {} });
    await upsertMarkets(ctx, [
      makeMarket({ id: "longshot", eventId: "e4", question: "Long shot", outcomes: two(0.01), volume: 99, ...noSlug("longshot") }),
      makeMarket({ id: "lock", eventId: "e5", question: "Lock", outcomes: two(0.985), volume: 98, ...noSlug("lock") }),
    ]);
    const ids = async (includeLongShots?: boolean) => (await getRadar(db, { limit: 10, now: NOW, includeLongShots })).map((r) => r.market.id);
    expect(await ids()).not.toContain("longshot");
    expect(await ids()).not.toContain("lock");
    expect(await ids(true)).toEqual(expect.arrayContaining(["longshot", "lock"]));
  });

  test("collapses brackets of one event into its biggest market", async () => {
    const ctx = createEngineCtx({ db, tatum: null, memory: null, now: () => NOW, log: () => {} });
    await upsertMarkets(ctx, [
      makeMarket({ id: "b1", eventId: "tweets", question: "400-419 tweets?", outcomes: two(0.3), volume: 50, ...noSlug("b1") }),
      makeMarket({ id: "b2", eventId: "tweets", question: "420-439 tweets?", outcomes: two(0.4), volume: 80, ...noSlug("b2") }),
      makeMarket({ id: "b3", eventId: "tweets", question: "440-459 tweets?", outcomes: two(0.2), volume: 60, ...noSlug("b3") }),
    ]);
    const rows = await getRadar(db, { limit: 10, now: NOW });
    const tweets = rows.filter((r) => r.market.eventId === "tweets");
    expect(tweets.map((r) => [r.market.id, r.siblings])).toEqual([["b2", 2]]);
    expect(rows.find((r) => r.market.id === "quiet")?.siblings).toBe(0);
  });

  test("filters by group", async () => {
    expect((await getRadar(db, { group: "CRYPTO", limit: 10, now: NOW })).map((r) => r.market.id)).toEqual(["quiet"]);
  });

  test("uses the latest sharp line", async () => {
    await line("big-sharp", 0.4, 0.45, NOW - 10);
    const rows = await getRadar(db, { limit: 10, now: NOW });
    expect(rows.find((r) => r.market.id === "big-sharp")?.line).toBe(0.45);
  });
});

describe("market view", () => {
  test("unknown market → null", async () => {
    expect(await getMarketView(db, "nope")).toBeNull();
  });

  test("holders come with names and remembered credibility", async () => {
    await db.insert(snapshots).values({ id: "s-big-sharp", marketId: "big-sharp", ts: NOW - 1000, kind: "routine", prices: [0.4, 0.6] });
    await db.insert(holderSnapshots).values([
      { snapshotId: "s-big-sharp", marketId: "big-sharp", address: "0xa", outcomeIndex: 0, size: 10, avgPrice: 0.4, currentValue: 900 },
      { snapshotId: "s-big-sharp", marketId: "big-sharp", address: "0xb", outcomeIndex: 1, size: 10, avgPrice: 0.6, currentValue: 100 },
    ]);
    await db.insert(wallets).values({ address: "0xa", name: "Ann" });
    await db.insert(voiceScores).values({ voiceId: "0xa", group: "SPORTS", asOf: NOW - 5000, n: 40, wins: 30, edge: 0.05, z: 2, credibility: 81, pnl: 1, volume: 1 });
    const view = await getMarketView(db, "big-sharp");
    expect(view?.market.question).toBe("Lakers vs. Celtics");
    expect(view?.line?.line).toBe(0.5);
    expect(view?.holders.map((h) => [h.address, h.name, h.credibility])).toEqual([
      ["0xa", "Ann", 81],
      ["0xb", null, null],
    ]);
  });
});

describe("header stats", () => {
  test("counts memories, voices and latest lambdas", async () => {
    const mem = (id: string, status: string) => ({ id, namespace: "n", kind: "lesson", text: "t", status, createdAt: NOW });
    await db.insert(memories).values([mem("1", "stored"), mem("2", "stored"), mem("3", "queued"), mem("4", "sent"), mem("5", "failed")]);
    await db.insert(voiceScores).values([
      { voiceId: "0xa", group: "SPORTS", asOf: 1, n: 25, wins: 1, edge: 0, z: 0, credibility: 60, pnl: 0, volume: 0 },
      { voiceId: "0xa", group: "OVERALL", asOf: 1, n: 25, wins: 1, edge: 0, z: 0, credibility: 60, pnl: 0, volume: 0 },
      { voiceId: "0xb", group: "SPORTS", asOf: 1, n: 3, wins: 1, edge: 0, z: 0, credibility: 60, pnl: 0, volume: 0 },
    ]);
    await db.insert(lambdas).values([
      { group: "SPORTS", asOf: 1, lambda: 0.2, n: 1 },
      { group: "SPORTS", asOf: 2, lambda: 0.3, n: 2 },
    ]);
    expect(await getHeaderStats(db)).toEqual({ memoriesStored: 2, memoriesQueued: 2, memoriesFailed: 1, voices: 1, lambdas: { SPORTS: 0.3 } });
  });
});
