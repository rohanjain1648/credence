import { beforeEach, describe, expect, test } from "vitest";
import { calibrationBins, pickWarnings, type SettledPick } from "@/engine/picks";
import { createEngineCtx } from "@/engine/ctx";
import { upsertMarkets } from "@/engine/markets";
import { createPick, settlePicksForMarket } from "@/engine/picks";
import type { Db } from "@/lib/db/client";
import { closedPositions, memories, voiceScores, wallets } from "@/lib/db/schema";
import { encodeMemory } from "@/lib/memory/format";
import { getMeView, getVoicesBoard, getVoiceView } from "@/lib/queries";
import { createTestDb } from "../helpers/db";
import { makeMarket, NOW } from "../helpers/factories";

let db: Db;

const score = (voiceId: string, group: string, credibility: number, n: number, asOf = NOW, extra: Partial<typeof voiceScores.$inferInsert> = {}) => ({
  voiceId,
  group,
  asOf,
  n,
  wins: 1,
  edge: 0.05,
  z: 1,
  credibility,
  pnl: 100,
  volume: 1000,
  ...extra,
});

beforeEach(async () => {
  db = await createTestDb();
});

describe("getVoicesBoard", () => {
  test("ranks the latest score per voice with 20+ bets in the category", async () => {
    await db.insert(wallets).values({ address: "0xa", name: "Ann" });
    await db.insert(voiceScores).values([
      score("0xa", "SPORTS", 60, 30, NOW - 5000),
      score("0xa", "SPORTS", 84, 40),
      score("0xb", "SPORTS", 70, 25),
      score("0xc", "SPORTS", 99, 3),
      score("0xd", "POLITICS", 95, 50),
    ]);
    const board = await getVoicesBoard(db, { group: "SPORTS", limit: 10 });
    expect(board.map((v) => [v.address, v.name, v.credibility, v.n])).toEqual([
      ["0xa", "Ann", 84, 40],
      ["0xb", null, 70, 25],
    ]);
  });

  test("the overall board and the limit work", async () => {
    await db.insert(voiceScores).values([score("0xa", "OVERALL", 60, 30), score("0xb", "OVERALL", 70, 30), score("0xc", "SPORTS", 90, 30)]);
    expect((await getVoicesBoard(db, { group: "OVERALL", limit: 1 })).map((v) => v.address)).toEqual(["0xb"]);
  });

  test("no voices gives an empty board", async () => {
    expect(await getVoicesBoard(db, { group: "SPORTS", limit: 10 })).toEqual([]);
  });
});

describe("getVoiceView", () => {
  const bet = (conditionId: string, settledAt: number) => ({
    address: "0xa",
    conditionId,
    outcomeIndex: 0,
    title: conditionId,
    outcome: "Yes",
    avgPrice: 0.4,
    curPrice: 1,
    realizedPnl: 60,
    totalBought: 40,
    settledAt,
    group: "SPORTS",
  });

  test("unknown voice is null", async () => {
    expect(await getVoiceView(db, "0xnope")).toBeNull();
  });

  test("gathers scores, history, recent bets and memory receipts", async () => {
    await db.insert(wallets).values({ address: "0xa", name: "Ann" });
    await db.insert(voiceScores).values([
      score("0xa", "SPORTS", 70, 30, NOW - 5000),
      score("0xa", "SPORTS", 84, 40),
      score("0xa", "OVERALL", 75, 45),
    ]);
    await db.insert(closedPositions).values([bet("old", 1000), bet("new", 2000)]);
    await db.insert(memories).values({
      id: "m1",
      namespace: "credence-voices",
      kind: "dossier",
      text: encodeMemory("dossier", "Wallet 0xa is sharp on SPORTS.", {}),
      refType: "wallet",
      refId: "0xa",
      status: "stored",
      blobId: "blob-1",
      createdAt: NOW,
    });

    const view = await getVoiceView(db, "0xA");

    expect(view?.name).toBe("Ann");
    expect(view?.scores.map((s) => [s.group, s.credibility])).toEqual([
      ["SPORTS", 84],
      ["OVERALL", 75],
    ]);
    expect(view?.history.filter((h) => h.group === "SPORTS").map((h) => h.credibility)).toEqual([70, 84]);
    expect(view?.bets.map((b) => b.conditionId)).toEqual(["new", "old"]);
    expect(view?.receipts).toEqual([expect.objectContaining({ human: "Wallet 0xa is sharp on SPORTS.", blobId: "blob-1", status: "stored" })]);
  });
});

describe("getMeView", () => {
  async function ctxAndMarket() {
    const ctx = createEngineCtx({ db, tatum: null, memory: null, now: () => NOW, log: () => {} });
    await upsertMarkets(ctx, [
      makeMarket({ id: "m1", outcomes: [{ name: "Lakers", price: 0.4, tokenId: "t0" }, { name: "Celtics", price: 0.6, tokenId: "t1" }] }),
      makeMarket({ id: "m2", question: "Knicks vs. Heat" }),
    ]);
    return ctx;
  }

  test("no picks gives an empty view", async () => {
    expect(await getMeView(db, "Ravi")).toEqual({
      handle: "ravi",
      open: [],
      settled: [],
      score: null,
      bias: { n: 0, hitRate: 0, overconfidence: 0, favoriteLean: 0, byGroup: {} },
      calibration: [],
    });
  });

  test("splits open and settled picks, with scores and memory links", async () => {
    const ctx = await ctxAndMarket();
    const won = await createPick(ctx, { handle: "ravi", marketId: "m1", outcomeIndex: 0, confidence: 0.7 });
    await createPick(ctx, { handle: "ravi", marketId: "m2", outcomeIndex: 1, confidence: 0.6 });
    await createPick(ctx, { handle: "someone_else", marketId: "m2", outcomeIndex: 0, confidence: 0.6 });
    await settlePicksForMarket(ctx, "m1", 0);

    const view = await getMeView(db, "RAVI");

    expect(view.open.map((p) => p.question)).toEqual(["Knicks vs. Heat"]);
    expect(view.settled[0]).toMatchObject({ id: won.id, question: "Lakers vs. Celtics", group: "SPORTS", status: "won", memoryStatus: "queued" });
    expect(view.score?.n).toBe(1);
    expect(view.bias.hitRate).toBe(1);
    expect(view.calibration).toHaveLength(1);
  });
});

describe("pickWarnings", () => {
  const report = (o: Partial<ReturnType<typeof base>>) => ({ ...base(), ...o });
  const base = () => ({ n: 7, hitRate: 0.5, overconfidence: 0, favoriteLean: 0.5, byGroup: {} as Partial<Record<"SPORTS" | "POLITICS", { n: number; edge: number }>> });

  test("warns about a losing record in this category", () => {
    const warnings = pickWarnings(report({ byGroup: { SPORTS: { n: 7, edge: -0.12 } } }), "SPORTS", 0.5);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("SPORTS");
    expect(warnings[0]).toContain("-12");
  });

  test("ignores a losing record in another category or a small sample", () => {
    expect(pickWarnings(report({ byGroup: { POLITICS: { n: 7, edge: -0.12 } } }), "SPORTS", 0.5)).toEqual([]);
    expect(pickWarnings(report({ byGroup: { SPORTS: { n: 4, edge: -0.12 } } }), "SPORTS", 0.5)).toEqual([]);
  });

  test("warns about overconfidence", () => {
    const warnings = pickWarnings(report({ overconfidence: 0.15 }), "SPORTS", 0.5);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/overconfiden/i);
  });

  test("warns about leaning on favorites only when this pick is a favorite", () => {
    expect(pickWarnings(report({ favoriteLean: 0.8 }), "SPORTS", 0.85)).toHaveLength(1);
    expect(pickWarnings(report({ favoriteLean: 0.8 }), "SPORTS", 0.4)).toEqual([]);
  });

  test("under 5 settled picks gives no warnings", () => {
    expect(pickWarnings(report({ n: 4, overconfidence: 0.3, favoriteLean: 0.9 }), "SPORTS", 0.9)).toEqual([]);
  });
});

describe("calibrationBins", () => {
  const pick = (confidence: number, y: number): SettledPick => ({ confidence, priceAtPick: 0.5, y, edge: y - 0.5, group: "SPORTS" });

  test("groups picks by confidence and reports the hit rate of each group", () => {
    expect(calibrationBins([pick(0.55, 1), pick(0.58, 0), pick(0.72, 1), pick(0.99, 1)])).toEqual([
      { from: 0.5, to: 0.6, n: 2, hitRate: 0.5, meanConfidence: expect.closeTo(0.565, 10) },
      { from: 0.7, to: 0.8, n: 1, hitRate: 1, meanConfidence: expect.closeTo(0.72, 10) },
      { from: 0.9, to: 1, n: 1, hitRate: 1, meanConfidence: expect.closeTo(0.99, 10) },
    ]);
  });
});
