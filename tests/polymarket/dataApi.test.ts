import { describe, expect, test } from "vitest";
import { createPolymarketWalletApi, PolymarketError } from "@/lib/polymarket/dataApi";
import { fakeFetch } from "../helpers/fakeFetch";

const COND = "0x5db999fad322cea2914535aae5517060c3f80ad6d8c0231cde2124a434d16846";
const USER = "0xf0318c32136c2db7fec88b84869aee6a1106c80c";
const api = (f: ReturnType<typeof fakeFetch>) => createPolymarketWalletApi({ fetchImpl: f, sleep: async () => {}, maxRps: 1000 });

const holder = (o: Record<string, unknown>) => ({
  proxy_wallet: "0xABC",
  name: "",
  pseudonym: "Murky-Sleepiness",
  profile_image: "",
  verified: false,
  token_id: "t0",
  amount: 1000,
  avg_price: 0.4,
  current_price: 0.5,
  current_value: 500,
  entry_cost_usdc: 400,
  realized_pnl: 0,
  unrealized_pnl: 100,
  total_pnl: 100,
  outcome_index: 0,
  ...o,
});

const position = (o: Record<string, unknown>) => ({
  proxy_wallet: USER,
  condition_id: "0xc1",
  token_id: "t0",
  status: "CLOSED",
  avg_price: 0.3347,
  current_price: 1,
  realized_pnl: 1409061.7,
  total_cost_usdc: 0,
  total_size: 2118089.25,
  current_size: 0,
  last_event_at: 1784501745,
  title: "Will Spain vs. Argentina end in a draw?",
  slug: "fifwc-esp-arg-2026-07-19-draw",
  event_slug: "fifwc-esp-arg-2026-07-19",
  outcome: "Yes",
  outcome_index: 0,
  opposite_outcome: "No",
  opposite_token_id: "t1",
  end_date: "2026-07-19",
  ...o,
});

const page = (data: unknown[], next: string | null = null) => ({ data, pagination: { limit: data.length, offset: 0, has_more: next !== null, next_cursor: next } });

describe("polymarket v2 wallet data", () => {
  test("holders map to the Tatum holder shape, one group per outcome token", async () => {
    const f = fakeFetch([
      {
        status: 200,
        body: page([
          { token_id: "t0", holders: [holder({ name: "Ann" })] },
          { token_id: "t1", holders: [holder({ proxy_wallet: "0xdef", token_id: "t1", outcome_index: 1, current_value: null, current_price: 0.6, amount: 10 })] },
        ]),
      },
    ]);
    const groups = await api(f).getMarketPositions(COND, { status: "OPEN", sortBy: "TOKENS", limit: 50 });
    expect(f.calls[0].url).toBe(`https://data-api.polymarket.com/v2/holders?condition=${COND}&limit=50&include_pnl=true`);
    expect(groups[0]).toEqual({
      token: "t0",
      positions: [
        expect.objectContaining({ proxyWallet: "0xabc", name: "Ann", asset: "t0", conditionId: COND, size: 1000, avgPrice: 0.4, currentValue: 500, totalBought: 400, outcomeIndex: 0 }),
      ],
    });
    expect(groups[1].positions[0]).toMatchObject({ proxyWallet: "0xdef", name: "Murky-Sleepiness", outcomeIndex: 1, currentValue: 6 });
  });

  test("holder limit is capped at 100, the most v2 allows with economics", async () => {
    const f = fakeFetch([{ status: 200, body: page([]) }]);
    await api(f).getMarketPositions(COND, { limit: 500 });
    expect(f.calls[0].url).toContain("limit=100");
  });

  test("wallet history reads settled positions newest first, with stake and timestamp derived", async () => {
    const f = fakeFetch([
      { status: 200, body: page([position({})], "c1") },
      { status: 200, body: page([position({ condition_id: "0xc2", status: "REDEEMABLE", current_price: 0, realized_pnl: 0, total_cost_usdc: 120, total_size: 300, current_size: 300, avg_price: 0.4 })]) },
    ]);
    const rows = await api(f).getWalletHistory(USER, { limit: 50, offset: 0, sortBy: "TIMESTAMP", sortDirection: "DESC" });
    expect(f.calls.map((c) => c.url)).toEqual([
      `https://data-api.polymarket.com/v2/positions?user=${USER}&status=CLOSED&sort_by=TIMESTAMP&sort_direction=DESC&limit=50`,
      `https://data-api.polymarket.com/v2/positions?user=${USER}&status=REDEEMABLE&sort_by=TIMESTAMP&sort_direction=DESC&limit=50`,
    ]);
    expect(rows[0]).toMatchObject({
      proxyWallet: USER,
      conditionId: "0xc1",
      avgPrice: 0.3347,
      curPrice: 1,
      timestamp: 1784501745,
      eventSlug: "fifwc-esp-arg-2026-07-19",
      outcomeIndex: 0,
    });
    expect(rows[0].totalBought).toBeCloseTo(0.3347 * 2118089.25, 2);
    expect(rows[1]).toMatchObject({ conditionId: "0xc2", curPrice: 0, totalBought: 120 });
  });

  test("the next page of wallet history follows the cursor from the previous one", async () => {
    const f = fakeFetch([
      { status: 200, body: page([position({})], "c1") },
      { status: 200, body: page([]) },
      { status: 200, body: page([position({ condition_id: "0xc3" })]) },
    ]);
    const a = api(f);
    await a.getWalletHistory(USER, { limit: 50, offset: 0 });
    const second = await a.getWalletHistory(USER, { limit: 50, offset: 50 });
    expect(f.calls[2].url).toBe(`https://data-api.polymarket.com/v2/positions?user=${USER}&cursor=c1`);
    expect(second.map((r) => r.conditionId)).toEqual(["0xc3"]);
  });

  test("a later page with no cursor known returns nothing instead of repeating page one", async () => {
    const f = fakeFetch([]);
    expect(await api(f).getWalletHistory(USER, { limit: 50, offset: 50 })).toEqual([]);
    expect(f.calls).toHaveLength(0);
  });

  test("leaderboard maps fields and lowercases period and category", async () => {
    const f = fakeFetch([
      { status: 200, body: page([{ rank: 1, user_id: "0xF03", pnl: 6041374.8, volume: 101686611.5, user_name: "BreakTheBank", profile_image: "", x_username: "", verified: false }]) },
    ]);
    const rows = await api(f).getTopTraders({ category: "SPORTS", timePeriod: "MONTH", orderBy: "PNL", limit: 50 });
    expect(f.calls[0].url).toBe("https://data-api.polymarket.com/v2/leaderboard?time_period=month&category=sports&sort_by=PNL&limit=50");
    expect(rows[0]).toEqual({ rank: 1, proxyWallet: "0xF03", userName: "BreakTheBank", xUsername: null, verifiedBadge: false, vol: 101686611.5, pnl: 6041374.8, profileImage: null });
  });

  test("retries 429 and 5xx, then throws a typed error", async () => {
    const f = fakeFetch([{ status: 429 }, { status: 503 }, { status: 503 }]);
    const err = await api(f).getTopTraders({}).catch((e) => e);
    expect(err).toBeInstanceOf(PolymarketError);
    expect(err.status).toBe(503);
    expect(f.calls).toHaveLength(3);
  });

  test("400 fails at once", async () => {
    const f = fakeFetch([{ status: 400, body: { error: "bad", code: "invalid_request" } }]);
    await expect(api(f).getTopTraders({})).rejects.toMatchObject({ status: 400 });
    expect(f.calls).toHaveLength(1);
  });
});
