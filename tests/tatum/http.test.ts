import { describe, expect, test } from "vitest";
import { CreditCapError, TatumError, TatumHttp } from "@/lib/tatum/http";
import { createPredictionApi } from "@/lib/tatum/prediction";
import { fakeFetch, type FakeFetch } from "../helpers/fakeFetch";

const noSleep = async () => {};
const page = { data: [], pagination: { pageSize: 20 } };

function api(f: FakeFetch, over: Partial<ConstructorParameters<typeof TatumHttp>[0]> = {}) {
  return createPredictionApi(new TatumHttp({ apiKey: "k", fetchImpl: f, sleep: noSleep, maxRps: 1000, ...over }));
}

describe("TatumHttp", () => {
  test("sends x-api-key and drops undefined query params", async () => {
    const f = fakeFetch([{ status: 200, body: page }]);
    await api(f).listMarkets({ platform: "polymarket", search: undefined, limit: 5 });
    expect(f.calls[0].url).toBe("https://api.tatum.io/v4/data/prediction/markets?platform=polymarket&limit=5");
    expect(f.calls[0].headers["x-api-key"]).toBe("k");
  });

  test("retries 429 then succeeds", async () => {
    const f = fakeFetch([{ status: 429 }, { status: 429 }, { status: 200, body: page }]);
    await expect(api(f).listMarkets({})).resolves.toEqual({ data: [], cursor: undefined });
    expect(f.calls.length).toBe(3);
  });

  test("retries network errors", async () => {
    const f = fakeFetch([new TypeError("fetch failed"), { status: 200, body: page }]);
    await expect(api(f).listMarkets({})).resolves.toBeTruthy();
    expect(f.calls.length).toBe(2);
  });

  test("5xx gives up after 3 attempts with TatumError status 503", async () => {
    const f = fakeFetch([{ status: 503 }, { status: 503 }, { status: 503 }]);
    const err = await api(f).listMarkets({}).catch((e) => e);
    expect(err).toBeInstanceOf(TatumError);
    expect(err.status).toBe(503);
    expect(f.calls.length).toBe(3);
  });

  test("400 throws TatumError immediately without retry", async () => {
    const f = fakeFetch([{ status: 400, body: { message: "bad" } }]);
    const err = await api(f).listMarkets({}).catch((e) => e);
    expect(err).toBeInstanceOf(TatumError);
    expect(err.status).toBe(400);
    expect(err.body).toEqual({ message: "bad" });
    expect(f.calls.length).toBe(1);
  });

  test("reports usage credits per call with ids collapsed in the endpoint", async () => {
    const usage: unknown[] = [];
    const f = fakeFetch([{ status: 200, body: page }, { status: 200, body: { data: [], pagination: {} } }]);
    const a = api(f, { onUsage: (u) => void usage.push(u) });
    await a.listMarkets({});
    await a.getWalletHistory("0x56687bf447db6ffa42ffe2204a05edaa20f55839", {});
    expect(usage[0]).toMatchObject({ endpoint: "/markets", credits: 100, status: 200 });
    expect(usage[1]).toMatchObject({ endpoint: "/wallets/:id/history", credits: 100, status: 200 });
  });

  test("throws CreditCapError before calling when used + cost > cap", async () => {
    const f = fakeFetch([{ status: 200, body: page }]);
    const a = api(f, { dailyCreditCap: 150, creditsUsedToday: async () => 100 });
    await expect(a.listMarkets({})).rejects.toBeInstanceOf(CreditCapError);
    expect(f.calls.length).toBe(0);
  });

  test("by default stays under Tatum's free plan limit of 3 requests per second", async () => {
    let t = 0;
    const f = fakeFetch(Array.from({ length: 7 }, () => ({ status: 200, body: page })));
    const a = createPredictionApi(
      new TatumHttp({
        apiKey: "k",
        fetchImpl: f,
        now: () => t,
        sleep: async (ms: number) => {
          t += ms;
        },
      }),
    );
    for (let i = 0; i < 7; i++) await a.listMarkets({});
    expect(t).toBeGreaterThan(2000); // 6 gaps; exactly 2000 ms would be 3 per second with no margin
  });

  test("rate limiter spaces 8 calls over >= 1 second at 4 rps", async () => {
    let t = 0;
    const f = fakeFetch(Array.from({ length: 8 }, () => ({ status: 200, body: page })));
    const a = api(f, {
      maxRps: 4,
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    });
    for (let i = 0; i < 8; i++) await a.listMarkets({});
    expect(t).toBeGreaterThanOrEqual(1000);
  });
});
