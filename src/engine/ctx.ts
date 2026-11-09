import { gte, sum } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db/client";
import { apiUsage } from "@/lib/db/schema";
import { features, getEnv } from "@/lib/env";
import { getMemory, type MemWalLike } from "@/lib/memory/client";
import { createPolymarketWalletApi } from "@/lib/polymarket/dataApi";
import { withWalletFallback } from "@/lib/polymarket/fallback";
import { TatumHttp } from "@/lib/tatum/http";
import { createPredictionApi, type PredictionApi } from "@/lib/tatum/prediction";

export type EngineCtx = {
  db: Db;
  tatum: PredictionApi | null;
  memory: MemWalLike | null;
  now: () => number;
  log: (m: string) => void;
  /** Tatum credits allowed per UTC day; the HTTP client refuses every call beyond this. */
  creditCap: number;
};

const DAY_MS = 86_400_000;

/** Optional work may use this share of the daily cap. The rest stays free for resolutions and final snapshots. */
export const OPTIONAL_CREDIT_SHARE = 0.7;

export function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export async function creditsUsedSince(db: Db, since: number): Promise<number> {
  const [row] = await db.select({ total: sum(apiUsage.credits) }).from(apiUsage).where(gte(apiUsage.ts, since));
  return Number(row?.total ?? 0);
}

/**
 * Credits optional work (market sync, routine snapshots, wallet history, charts) may spend right now.
 * Its share of the cap is released evenly through the UTC day, so it can't all go in the first hours.
 */
export async function optionalCreditsAvailable(ctx: Pick<EngineCtx, "db" | "now" | "creditCap">): Promise<number> {
  const now = ctx.now();
  const dayStart = startOfUtcDay(now);
  const released = ctx.creditCap * OPTIONAL_CREDIT_SHARE * ((now - dayStart) / DAY_MS);
  return Math.max(0, released - (await creditsUsedSince(ctx.db, dayStart)));
}

function createTatum(db: Db, now: () => number): PredictionApi | null {
  const env = getEnv();
  if (!features(env).tatum) return null;
  const http = new TatumHttp({
    apiKey: env.TATUM_API_KEY!,
    dailyCreditCap: env.TATUM_DAILY_CREDIT_CAP,
    creditsUsedToday: () => creditsUsedSince(db, startOfUtcDay(now())),
    onUsage: async (u) => {
      await db.insert(apiUsage).values({ provider: "tatum", endpoint: u.endpoint, credits: u.credits, status: u.status, ts: u.ts });
    },
  });
  return withWalletFallback(createPredictionApi(http), createPolymarketWalletApi(), {
    mode: env.WALLET_DATA_SOURCE,
    now,
    log: (m) => console.log(m),
  });
}

/** Wires live dependencies; any field passed in `over` (even `null`) replaces the default. */
export function createEngineCtx(over: Partial<EngineCtx> = {}): EngineCtx {
  const db = over.db ?? getDb();
  const now = over.now ?? Date.now;
  return {
    db,
    now,
    tatum: "tatum" in over ? (over.tatum ?? null) : createTatum(db, now),
    memory: "memory" in over ? (over.memory ?? null) : getMemory(),
    log: over.log ?? ((m) => console.log(m)),
    creditCap: over.creditCap ?? getEnv().TATUM_DAILY_CREDIT_CAP,
  };
}
