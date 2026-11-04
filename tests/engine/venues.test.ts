import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/lib/db/client";
import { markets, venuePairs } from "@/lib/db/schema";
import { createEngineCtx, type EngineCtx } from "@/engine/ctx";
import { upsertMarkets } from "@/engine/markets";
import { getVenueQuote, syncKalshiAndPair } from "@/engine/venues";
import { createTestDb } from "../helpers/db";
import { makeMarket, NOW } from "../helpers/factories";
import { fakeTatum } from "../helpers/fakeTatum";

let db: Db;

const kalshi = (id: string, question: string, yes: number) =>
  makeMarket({
    id,
    platform: "kalshi",
    question,
    outcomes: [
      { name: "Yes", price: yes, tokenId: null },
      { name: "No", price: 1 - yes, tokenId: null },
    ],
    source: { platform: "kalshi", platformId: id, url: null },
  });

beforeEach(async () => {
  db = await createTestDb();
});

function ctxWith(pages: Array<{ data: ReturnType<typeof makeMarket>[]; cursor?: string }>): EngineCtx {
  let call = 0;
  const tatum = fakeTatum({ listMarkets: async () => pages[call++] ?? { data: [] } });
  return createEngineCtx({ db, tatum, memory: null, now: () => NOW, log: () => {} });
}

describe("venues", () => {
  test("pairs a polymarket market with its kalshi twin and quotes it in outcome-A terms", async () => {
    const ctx = ctxWith([{ data: [kalshi("KX-CEL", "Will the Celtics win vs Lakers?", 0.62)] }]);
    await upsertMarkets(ctx, [makeMarket()]);
    expect(await syncKalshiAndPair(ctx, { horizonDays: 7, overrides: [] })).toBe(1);
    const [pair] = await db.select().from(venuePairs);
    expect(pair).toMatchObject({ polyId: "0xmarket1", kalshiId: "KX-CEL", flip: true, method: "auto" });
    const quote = await getVenueQuote(ctx, "0xmarket1");
    expect(quote?.kalshiId).toBe("KX-CEL");
    expect(quote?.priceA).toBeCloseTo(0.38, 10);
  });

  test("follows the cursor for up to 5 pages", async () => {
    const pages = Array.from({ length: 7 }, (_, i) => ({ data: [kalshi(`K${i}`, `Unrelated ${i}`, 0.5)], cursor: `c${i}` }));
    const ctx = ctxWith(pages);
    await syncKalshiAndPair(ctx, { horizonDays: 7, overrides: [] });
    expect((ctx.tatum as ReturnType<typeof fakeTatum>).calls).toHaveLength(5);
    expect((await db.select().from(markets)).filter((m) => m.platform === "kalshi")).toHaveLength(5);
  });

  test("overrides win over auto match", async () => {
    const ctx = ctxWith([{ data: [kalshi("KX-CEL", "Will the Celtics win vs Lakers?", 0.62), kalshi("KX-LAL", "Totally different words", 0.4)] }]);
    await upsertMarkets(ctx, [makeMarket()]);
    await syncKalshiAndPair(ctx, { horizonDays: 7, overrides: [{ polyId: "0xmarket1", kalshiId: "KX-LAL", flip: false }] });
    const [pair] = await db.select().from(venuePairs);
    expect(pair).toMatchObject({ kalshiId: "KX-LAL", flip: false, method: "manual" });
    expect((await getVenueQuote(ctx, "0xmarket1"))?.priceA).toBeCloseTo(0.4, 10);
  });

  test("parlays are not stored", async () => {
    const ctx = ctxWith([{ data: [kalshi("KX-P", "yes India,yes Warriors Women", 0.1), kalshi("KX-S", "GenOne wins map 1", 0.5)] }]);
    await syncKalshiAndPair(ctx, { horizonDays: 7, overrides: [] });
    expect((await db.select().from(markets)).map((m) => m.id)).toEqual(["KX-S"]);
  });

  describe("with listing turned off", () => {
    const override = { polyId: "0xmarket1", kalshiId: "KX-LAL", flip: false };

    test("a manual pair fetches its Kalshi market directly", async () => {
      const tatum = fakeTatum({ getMarket: async () => kalshi("KX-LAL", "Totally different words", 0.4) });
      const ctx = createEngineCtx({ db, tatum, memory: null, now: () => NOW, log: () => {} });
      await upsertMarkets(ctx, [makeMarket()]);
      await syncKalshiAndPair(ctx, { horizonDays: 7, maxPages: 0, overrides: [override] });
      expect(tatum.calls.map((c) => c.method)).toEqual(["getMarket"]);
      expect((await getVenueQuote(ctx, "0xmarket1"))?.priceA).toBeCloseTo(0.4, 10);
    });

    test("one failed manual pair does not stop the tick", async () => {
      const tatum = fakeTatum({
        getMarket: async () => {
          throw new Error("Tatum 500");
        },
      });
      const ctx = createEngineCtx({ db, tatum, memory: null, now: () => NOW, log: () => {} });
      await expect(syncKalshiAndPair(ctx, { horizonDays: 7, maxPages: 0, overrides: [override] })).resolves.toBe(1);
    });

    test("no manual pairs means no API calls", async () => {
      const tatum = fakeTatum();
      const ctx = createEngineCtx({ db, tatum, memory: null, now: () => NOW, log: () => {} });
      await syncKalshiAndPair(ctx, { horizonDays: 7, maxPages: 0, overrides: [] });
      expect(tatum.calls).toHaveLength(0);
    });
  });

  test("no pair → no quote", async () => {
    const ctx = ctxWith([]);
    expect(await getVenueQuote(ctx, "0xmarket1")).toBeNull();
  });
});
