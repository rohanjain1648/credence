import { describe, expect, test } from "vitest";
import { TatumHttp } from "@/lib/tatum/http";
import { createPredictionApi } from "@/lib/tatum/prediction";
import { MarketSchema } from "@/lib/tatum/schemas";
import { fakeFetch, type FakeFetch } from "../helpers/fakeFetch";
import market from "../fixtures/tatum/market.json";
import positions from "../fixtures/tatum/positions.json";
import walletHistory from "../fixtures/tatum/wallet-history.json";
import topTraders from "../fixtures/tatum/top-traders.json";

function api(f: FakeFetch) {
  return createPredictionApi(new TatumHttp({ apiKey: "k", fetchImpl: f, sleep: async () => {}, maxRps: 1000 }));
}

describe("prediction api", () => {
  test("schemas accept nulls for nullable fields", () => {
    expect(
      MarketSchema.parse({ ...market, description: null, category: null, resolution: null, chain: null, tags: null }),
    ).toBeTruthy();
  });

  test("numeric strings are coerced to numbers", () => {
    const parsed = MarketSchema.parse({ ...market, volume: "12.5", outcomes: [{ name: "YES", price: "0.4", tokenId: null }] });
    expect(parsed.volume).toBe(12.5);
    expect(parsed.outcomes[0].price).toBe(0.4);
  });

  test("listMarkets returns data and cursor", async () => {
    const f = fakeFetch([{ status: 200, body: { data: [market], pagination: { pageSize: 20, cursor: "c1" } } }]);
    const res = await api(f).listMarkets({ platform: "polymarket", status: "active", sort: "volume_desc" });
    expect(res.data[0].question).toBe(market.question);
    expect(res.cursor).toBe("c1");
    expect(f.calls[0].url).toBe(
      "https://api.tatum.io/v4/data/prediction/markets?platform=polymarket&status=active&sort=volume_desc",
    );
  });

  test("getMarket unwraps data envelope", async () => {
    const f = fakeFetch([{ status: 200, body: { data: market } }]);
    expect((await api(f).getMarket(market.id)).id).toBe(market.id);
    expect(f.calls[0].url).toBe(`https://api.tatum.io/v4/data/prediction/markets/${market.id}`);
  });

  test("getMarketPositions returns outcome groups with holders", async () => {
    const f = fakeFetch([{ status: 200, body: positions }]);
    const groups = await api(f).getMarketPositions(market.id, { status: "OPEN", sortBy: "TOKENS", limit: 50 });
    expect(groups).toHaveLength(2);
    expect(groups[0].positions[0]).toMatchObject({ proxyWallet: "0x56687bf447db6ffa42ffe2204a05edaa20f55839", outcomeIndex: 0, currentValue: 5250 });
    expect(groups[1].positions[0].name).toBeNull();
    expect(f.calls[0].url).toBe(
      `https://api.tatum.io/v4/data/prediction/markets/${market.id}/positions?status=OPEN&sortBy=TOKENS&limit=50`,
    );
  });

  test("getWalletHistory returns closed positions", async () => {
    const f = fakeFetch([{ status: 200, body: walletHistory }]);
    const rows = await api(f).getWalletHistory("0x56687bf447db6ffa42ffe2204a05edaa20f55839", { limit: 50, sortBy: "TIMESTAMP" });
    expect(rows[0]).toMatchObject({ avgPrice: 0.41, curPrice: 1, eventSlug: "nba-lal-bos-2025-11-01", timestamp: 1761955200 });
    expect(f.calls[0].url).toBe(
      "https://api.tatum.io/v4/data/prediction/wallets/0x56687bf447db6ffa42ffe2204a05edaa20f55839/history?limit=50&sortBy=TIMESTAMP",
    );
  });

  test("getTopTraders costs 200 credits and parses rows", async () => {
    const usage: Array<{ credits: number }> = [];
    const f = fakeFetch([{ status: 200, body: topTraders }]);
    const a = createPredictionApi(
      new TatumHttp({ apiKey: "k", fetchImpl: f, sleep: async () => {}, maxRps: 1000, onUsage: (u) => void usage.push(u) }),
    );
    const rows = await a.getTopTraders({ category: "SPORTS", timePeriod: "MONTH", limit: 50 });
    expect(rows[0]).toMatchObject({ rank: 1, userName: "JaneDoe", pnl: 281450.75 });
    expect(usage[0].credits).toBe(200);
    expect(f.calls[0].url).toBe("https://api.tatum.io/v4/data/prediction/top-traders?category=SPORTS&timePeriod=MONTH&limit=50");
  });
});
