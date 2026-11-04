import type { PredictionApi } from "@/lib/tatum/prediction";

export type FakeTatum = PredictionApi & { calls: Array<{ method: keyof PredictionApi; args: unknown[] }> };

/** Every method throws unless stubbed, so a test fails loudly when it reaches an endpoint it did not expect. */
export function fakeTatum(stubs: Partial<PredictionApi> = {}): FakeTatum {
  const calls: FakeTatum["calls"] = [];
  const method =
    <K extends keyof PredictionApi>(name: K) =>
    (...args: unknown[]) => {
      calls.push({ method: name, args });
      const stub = stubs[name] as ((...a: unknown[]) => unknown) | undefined;
      if (!stub) return Promise.reject(new Error(`fakeTatum.${name} not stubbed`));
      return stub(...args);
    };
  return {
    calls,
    listMarkets: method("listMarkets"),
    getMarket: method("getMarket"),
    getPriceHistory: method("getPriceHistory"),
    getMarketPositions: method("getMarketPositions"),
    getWalletHistory: method("getWalletHistory"),
    getTopTraders: method("getTopTraders"),
  } as FakeTatum;
}
