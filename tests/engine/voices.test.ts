import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/lib/db/client";
import { closedPositions, holderSnapshots, memories, snapshots, voiceScores, wallets } from "@/lib/db/schema";
import { decodeMemory } from "@/lib/memory/format";
import type { ClosedPosition } from "@/lib/tatum/prediction";
import { createEngineCtx, type EngineCtx } from "@/engine/ctx";
import {
  latestCredibility,
  pickHistoryCandidates,
  refreshVoiceHistory,
  rescoreVoices,
  seedVoicesFromLeaderboards,
} from "@/engine/voices";
import { createTestDb } from "../helpers/db";
import { NOW } from "../helpers/factories";
import { fakeTatum } from "../helpers/fakeTatum";

let db: Db;
const ctxWith = (tatum = fakeTatum(), now = NOW): EngineCtx => createEngineCtx({ db, tatum, memory: null, now: () => now, log: () => {} });

const closed = (o: Partial<ClosedPosition>, i: number): ClosedPosition => ({
  proxyWallet: "0xabc0000000000000000000000000000000000001",
  asset: `a${i}`,
  conditionId: `0xc${i}`,
  avgPrice: 0.4,
  totalBought: 100,
  realizedPnl: 150,
  curPrice: 1,
  timestamp: 1_760_000_000 + i,
  title: "Lakers vs. Celtics",
  slug: null,
  icon: null,
  eventSlug: "nba-lal-bos-2025-10-01",
  outcome: "Lakers",
  outcomeIndex: 0,
  oppositeOutcome: "Celtics",
  oppositeAsset: "x",
  endDate: null,
  ...o,
});
const WALLET = "0xabc0000000000000000000000000000000000001";

async function storeBets(n: number, o: Partial<ClosedPosition> = {}) {
  const rows = Array.from({ length: n }, (_, i) => closed(o, i));
  const tatum = fakeTatum({ getWalletHistory: async (_a, q) => (q.offset ? [] : rows) });
  await refreshVoiceHistory(ctxWith(tatum), WALLET, { maxPages: 1 });
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("voices", () => {
  test("seedVoicesFromLeaderboards upserts wallets from each board", async () => {
    const tatum = fakeTatum({
      getTopTraders: async (q) => [
        { rank: 1, proxyWallet: q.category === "SPORTS" ? "0xAAA" : "0xbbb", userName: "Jane", xUsername: "jane", verifiedBadge: true, vol: 1, pnl: 2, profileImage: null },
      ],
    });
    const n = await seedVoicesFromLeaderboards(ctxWith(tatum), { categories: ["SPORTS", "POLITICS"], periods: ["MONTH", "ALL"], perBoard: 50 });
    expect(n).toBe(2);
    expect(tatum.calls).toHaveLength(4);
    expect(tatum.calls[0].args[0]).toEqual({ category: "SPORTS", timePeriod: "MONTH", orderBy: "PNL", limit: 50 });
    const ws = await db.select().from(wallets);
    expect(ws.map((w) => w.address).sort()).toEqual(["0xaaa", "0xbbb"]);
    expect(ws[0]).toMatchObject({ name: "Jane", xUsername: "jane", verified: true });
  });

  test("refreshVoiceHistory stores categorized positions and pages until a short page", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => closed({}, i));
    const page2 = [closed({ title: "Which party will win the Senate in 2026?", eventSlug: "senate-2026", conditionId: "0xsenate" }, 99)];
    const tatum = fakeTatum({ getWalletHistory: async (_a, q) => (q.offset ? page2 : page1) });
    const count = await refreshVoiceHistory(ctxWith(tatum), WALLET, { maxPages: 5 });
    expect(count).toBe(51);
    expect(tatum.calls).toHaveLength(2);
    expect(tatum.calls[1].args).toEqual([WALLET, { limit: 50, offset: 50, sortBy: "TIMESTAMP", sortDirection: "DESC" }]);
    const rows = await db.select().from(closedPositions);
    expect(rows.find((r) => r.conditionId === "0xsenate")?.group).toBe("POLITICS");
    expect(rows.find((r) => r.conditionId === "0xc0")).toMatchObject({ group: "SPORTS", settledAt: 1_760_000_000_000 });
    const [w] = await db.select().from(wallets).where(eq(wallets.address, WALLET));
    expect(w).toMatchObject({ lastHistoryAt: NOW, historyStale: false });
  });

  test("rescore writes voice_scores per group and OVERALL", async () => {
    await storeBets(30);
    const deltas = await rescoreVoices(ctxWith(), [WALLET], NOW);
    expect(deltas.map((d) => d.group).sort()).toEqual(["OVERALL", "SPORTS"]);
    const rows = await db.select().from(voiceScores);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.n === 30 && r.asOf === NOW)).toBe(true);
  });

  test("strong new voice gets exactly one dossier memory", async () => {
    await storeBets(40);
    await rescoreVoices(ctxWith(), [WALLET], NOW);
    const mems = await db.select().from(memories);
    expect(mems).toHaveLength(1);
    expect(mems[0]).toMatchObject({ namespace: "credence-voices", kind: "dossier", refType: "wallet", refId: WALLET });
    const decoded = decodeMemory(mems[0].text)!;
    const [score] = await db.select().from(voiceScores).where(eq(voiceScores.group, "SPORTS"));
    expect(decoded.human).toContain("SPORTS");
    expect(decoded.human).toContain(String(Math.round(score.credibility)));
    expect(mems[0].effect).toMatchObject({ type: "credibility", group: "SPORTS", before: null });
  });

  test("weak sample gets no dossier", async () => {
    await storeBets(5);
    await rescoreVoices(ctxWith(), [WALLET], NOW);
    expect(await db.select().from(memories)).toHaveLength(0);
  });

  test("rescore with |Δ| < 5 writes no new dossier", async () => {
    await storeBets(40);
    await rescoreVoices(ctxWith(), [WALLET], NOW);
    await rescoreVoices(ctxWith(fakeTatum(), NOW + 1000), [WALLET], NOW + 1000);
    expect(await db.select().from(memories)).toHaveLength(1);
  });

  test("a big move writes a second dossier with before and after", async () => {
    await storeBets(40);
    await rescoreVoices(ctxWith(), [WALLET], NOW);
    const losses = Array.from({ length: 40 }, (_, i) => closed({ conditionId: `0xloss${i}`, curPrice: 0, realizedPnl: -100 }, 100 + i));
    await refreshVoiceHistory(ctxWith(fakeTatum({ getWalletHistory: async (_a, q) => (q.offset ? [] : losses) })), WALLET, { maxPages: 1 });
    const deltas = await rescoreVoices(ctxWith(fakeTatum(), NOW + 1000), [WALLET], NOW + 1000);
    const sports = deltas.find((d) => d.group === "SPORTS")!;
    expect(sports.before).not.toBeNull();
    expect(Math.abs(sports.after - sports.before!)).toBeGreaterThanOrEqual(5);
    expect(await db.select().from(memories)).toHaveLength(2);
  });

  test("latestCredibility falls back to OVERALL when group n < 5", async () => {
    await storeBets(30);
    await rescoreVoices(ctxWith(), [WALLET], NOW);
    const [overall] = await db.select().from(voiceScores).where(eq(voiceScores.group, "OVERALL"));
    expect(await latestCredibility(ctxWith(), WALLET, "POLITICS")).toBeCloseTo(overall.credibility, 10);
    expect(await latestCredibility(ctxWith(), "0xunknown", "SPORTS")).toBeNull();
  });

  test("pickHistoryCandidates respects value floor and freshness", async () => {
    await db.insert(snapshots).values({ id: "s1", marketId: "m", ts: NOW - 3_600_000, kind: "routine", prices: [0.5, 0.5] });
    const holder = (address: string, currentValue: number) => ({ snapshotId: "s1", marketId: "m", address, outcomeIndex: 0, size: 1, avgPrice: 0.5, currentValue });
    await db.insert(holderSnapshots).values([holder("0xnew", 1000), holder("0xsmall", 100), holder("0xfresh", 5000), holder("0xold", 2000), holder("0xstale", 800)]);
    await db.insert(wallets).values([
      { address: "0xfresh", lastHistoryAt: NOW - 3_600_000 },
      { address: "0xold", lastHistoryAt: NOW - 2 * 86_400_000 },
      { address: "0xstale", lastHistoryAt: NOW - 3_600_000, historyStale: true },
    ]);
    expect(await pickHistoryCandidates(ctxWith(), 10)).toEqual(["0xold", "0xnew", "0xstale"]);
  });
});
