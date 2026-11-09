import { TatumError } from "@/lib/tatum/http";
import type { PredictionApi } from "@/lib/tatum/prediction";
import type { WalletApi } from "./dataApi";

export type WalletDataMode = "auto" | "tatum" | "polymarket";

const COOLDOWN_MS = 30 * 60_000;
const WALLET_METHODS = ["getMarketPositions", "getWalletHistory", "getTopTraders"] as const;

/** Tatum outages (5xx or no answer) trigger the fallback; bad requests and the credit cap must surface. */
const isOutage = (err: unknown) => err instanceof TatumError && (err.status >= 500 || err.status === 0);

/**
 * Tatum stays the source for markets, prices and resolutions. For wallet data, `auto` tries Tatum
 * first and, after an outage, reads Polymarket's v2 API for 30 minutes before trying Tatum again.
 */
export function withWalletFallback(
  primary: PredictionApi,
  fallback: WalletApi,
  o: { mode: WalletDataMode; now?: () => number; log?: (m: string) => void },
): PredictionApi {
  const now = o.now ?? Date.now;
  let fallbackUntil = 0;

  const wrap = <K extends (typeof WALLET_METHODS)[number]>(name: K): PredictionApi[K] =>
    (async (...args: Parameters<PredictionApi[K]>) => {
      const call = (api: WalletApi) => (api[name] as (...a: unknown[]) => Promise<unknown>)(...args);
      if (o.mode === "polymarket") return call(fallback);
      if (o.mode === "auto" && now() < fallbackUntil) return call(fallback);
      try {
        return await call(primary);
      } catch (err) {
        if (o.mode !== "auto" || !isOutage(err)) throw err;
        fallbackUntil = now() + COOLDOWN_MS;
        o.log?.(`Tatum ${name} failed (${(err as Error).message}); reading wallet data from Polymarket for 30 minutes`);
        return call(fallback);
      }
    }) as PredictionApi[K];

  return {
    ...primary,
    getMarketPositions: wrap("getMarketPositions"),
    getWalletHistory: wrap("getWalletHistory"),
    getTopTraders: wrap("getTopTraders"),
  };
}
