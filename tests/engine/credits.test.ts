import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/lib/db/client";
import { apiUsage, holderSnapshots, marketPrices, sharpLines, snapshots } from "@/lib/db/schema";
import { createEngineCtx, optionalCreditsAvailable } from "@/engine/ctx";
import { upsertMarkets } from "@/engine/markets";
import { ensurePriceHistory } from "@/engine/priceHistory";
import { runTick, type TickReport } from "@/engine/tick";
import type { PredictionApi, PriceHistory } from "@/lib/tatum/prediction";
import { createTestDb } from "../helpers/db";
import { makeMarket, NOW } from "../helpers/factories";
import { fakeTatum, type FakeTatum } from "../helpers/fakeTatum";

// NOW is noon UTC, so half of the day's optional share (70% of 60,000) has been released: 21,000.
const CAP = 60_000;
const MIN = 60_000;
let db: Db;

const ctxWith = (tatum: FakeTatum, now = NOW) =>
  createEngineCtx({ db, tatum, memory: null, now: () => now, log: () => {}, creditCap: CAP });
const spend = (credits: number) =>
  db.insert(apiUsage).values({ provider: "tatum", endpoint: "/x", credits, status: 200, ts: NOW - 1000 });
const stage = (r: TickReport, name: string) => r.stages.find((s) => s.name === name)!;
const empty: Partial<PredictionApi> = { listMarkets: async () => ({ data: [] }) };

beforeEach(async () => {
  db = await createTestDb();
});

describe("optionalCreditsAvailable", () => {
  test("releases 70% of the cap evenly through the UTC day", async () => {
    expect(await optionalCreditsAvailable(ctxWith(fakeTatum()))).toBeCloseTo(21_000, 6);
  });

  test("subtracts credits already used today", async () => {
    await spend(20_000);
    expect(await optionalCreditsAvailable(ctxWith(fakeTatum()))).toBeCloseTo(1_000, 6);
  });

  test("ignores credits used on earlier days", async () => {
    await db.insert(apiUsage).values({ provider: "tatum", endpoint: "/x", credits: 50_000, status: 200, ts: NOW - 86_400_000 });
    expect(await optionalCreditsAvailable(ctxWith(fakeTatum()))).toBeCloseTo(21_000, 6);
  });

  test("is never negative", async () => {
    await spend(50_000);
    expect(await optionalCreditsAvailable(ctxWith(fakeTatum()))).toBe(0);
  });
});

describe("tick credit budget", () => {
  async function holders(addresses: string[]) {
    await db.insert(snapshots).values({ id: "s1", marketId: "m", ts: NOW - 3_600_000, kind: "routine", prices: [0.5, 0.5] });
    await db.insert(holderSnapshots).values(
      addresses.map((address, i) => ({ snapshotId: "s1", marketId: "m", address, outcomeIndex: 0, size: 1, avgPrice: 0.5, currentValue: 5000 - i })),
    );
  }

  test("optional stages wait once their share is spent, while resolutions still run", async () => {
    await spend(50_000);
    const past = new Date(NOW - 3_600_000).toISOString();
    const tatum = fakeTatum({ getMarket: async (id) => makeMarket({ id, closeTime: past }) });
    const ctx = ctxWith(tatum);
    await upsertMarkets(ctx, [makeMarket({ id: "closed", closeTime: past })]);
    await db.insert(sharpLines).values({ marketId: "closed", snapshotId: "x", ts: NOW - 7_200_000, priceA: 0.5, consensus: 0.8, line: 0.6, weight: 2, lambda: 0.25, contributors: [] });

    const report = await runTick(ctx);

    expect(stage(report, "syncMarkets").detail).toBe("waiting for credits");
    expect(stage(report, "syncKalshi").detail).toBe("waiting for credits");
    expect(stage(report, "history").detail).toBe("waiting for credits");
    expect(stage(report, "resolutions").detail).toMatchObject({ checked: 1 });
    expect(tatum.calls.map((c) => c.method)).toEqual(["getMarket"]);
  });

  test("final snapshots run when optional credits are spent, routine ones wait", async () => {
    await spend(50_000);
    const tatum = fakeTatum({ getMarketPositions: async () => [] });
    const ctx = ctxWith(tatum);
    await upsertMarkets(ctx, [
      makeMarket({ id: "closing", closeTime: new Date(NOW + 30 * MIN).toISOString() }),
      makeMarket({ id: "later", closeTime: new Date(NOW + 24 * 60 * MIN).toISOString() }),
    ]);

    const report = await runTick(ctx);

    expect(stage(report, "snapshots").detail).toEqual({ routine: "waiting for credits", final: 1 });
    expect(tatum.calls.map((c) => c.args[0])).toEqual(["closing"]);
  });

  test("a waiting stage runs as soon as credits are released", async () => {
    await spend(21_000);
    const tatum = fakeTatum(empty);
    expect(stage(await runTick(ctxWith(tatum)), "syncMarkets").detail).toBe("waiting for credits");
    expect(stage(await runTick(ctxWith(tatum, NOW + 30 * MIN)), "syncMarkets").detail).toEqual({ upserted: 0 });
  });

  test("history refreshes only as many wallets as the budget covers", async () => {
    await spend(20_700); // leaves 300: one wallet at up to 2 pages of 100 credits
    await holders(["0xa", "0xb", "0xc"]);
    const tatum = fakeTatum({ ...empty, getWalletHistory: async () => [] });

    const report = await runTick(ctxWith(tatum));

    expect(tatum.calls.filter((c) => c.method === "getWalletHistory").map((c) => c.args[0])).toEqual(["0xa"]);
    expect(stage(report, "history").detail).toEqual({ refreshed: 1, failed: 0 });
  });

  test("a wallet that fails does not block the others", async () => {
    await holders(["0xbad", "0xb", "0xc"]);
    const tatum = fakeTatum({
      ...empty,
      getWalletHistory: async (address) => {
        if (address === "0xbad") throw new Error("Tatum 500");
        return [];
      },
    });

    const report = await runTick(ctxWith(tatum));

    expect(stage(report, "history")).toMatchObject({ ok: true, detail: { refreshed: 2, failed: 1 } });
  });
});

describe("ensurePriceHistory", () => {
  const history = (candles: PriceHistory["candles"]): PriceHistory => ({
    marketId: "0xmarket1",
    platform: "polymarket",
    interval: "1h",
    source: "candlesticks",
    candles,
    partial: false,
    availableFrom: null,
  });
  const candle = { timestamp: new Date(NOW - 3_600_000).toISOString(), open: 0.4, high: 0.5, low: 0.4, close: 0.45, volume: 1 };

  test("stores candles as history prices", async () => {
    const tatum = fakeTatum({ getPriceHistory: async () => history([candle]) });
    await ensurePriceHistory(ctxWith(tatum), "0xmarket1");
    const rows = await db.select().from(marketPrices);
    expect(rows[0]).toMatchObject({ source: "history", ts: NOW - 3_600_000 });
    expect(rows[0].prices[0]).toBeCloseTo(0.45, 10);
  });

  test("an empty response is not fetched again within the hour", async () => {
    const tatum = fakeTatum({ getPriceHistory: async () => history([]) });
    await ensurePriceHistory(ctxWith(tatum), "0xmarket1");
    await ensurePriceHistory(ctxWith(tatum, NOW + 10 * MIN), "0xmarket1");
    expect(tatum.calls).toHaveLength(1);
    await ensurePriceHistory(ctxWith(tatum, NOW + 61 * MIN), "0xmarket1");
    expect(tatum.calls).toHaveLength(2);
  });

  test("a failed fetch can be retried on the next view", async () => {
    let fail = true;
    const tatum = fakeTatum({
      getPriceHistory: async () => {
        if (fail) throw new Error("Tatum 500");
        return history([]);
      },
    });
    await expect(ensurePriceHistory(ctxWith(tatum), "0xmarket1")).rejects.toThrow("500");
    fail = false;
    await ensurePriceHistory(ctxWith(tatum), "0xmarket1");
    expect(tatum.calls).toHaveLength(2);
  });

  test("makes no call when optional credits are spent", async () => {
    await spend(50_000);
    const tatum = fakeTatum();
    await ensurePriceHistory(ctxWith(tatum), "0xmarket1");
    expect(tatum.calls).toHaveLength(0);
  });
});
