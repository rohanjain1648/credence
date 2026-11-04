import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { markets, venuePairs } from "@/lib/db/schema";
import { matchVenues } from "@/lib/scoring/matching";
import type { Market } from "@/lib/tatum/prediction";
import type { Db } from "@/lib/db/client";
import type { EngineCtx } from "./ctx";
import { upsertMarkets } from "./markets";

export type VenueOverride = { polyId: string; kalshiId: string; flip: boolean };

const MAX_PAGES = 5;

/** Kalshi lists multi-leg parlays as markets ("yes India,yes Warriors Women"); they have no twin to pair with. */
const isParlay = (question: string) => /^(yes|no) .+,(yes|no) /i.test(question);

export function loadVenueOverrides(): VenueOverride[] {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), "data", "venue-overrides.json"), "utf8")) as VenueOverride[];
  } catch {
    return [];
  }
}

/** Pulls Kalshi markets closing within the horizon and pairs them with tracked Polymarket markets. */
export async function syncKalshiAndPair(
  ctx: EngineCtx,
  o: { horizonDays: number; overrides?: VenueOverride[]; maxPages?: number },
): Promise<number> {
  if (!ctx.tatum) return 0;
  const now = ctx.now();
  const endingBefore = new Date(now + o.horizonDays * 86_400_000).toISOString();

  const kalshi: Market[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < (o.maxPages ?? MAX_PAGES); page++) {
    const res = await ctx.tatum.listMarkets({ platform: "kalshi", endingBefore, sort: "endingSoon", limit: 100, cursor });
    kalshi.push(...res.data.filter((m) => !isParlay(m.question)));
    cursor = res.cursor;
    if (!cursor) break;
  }
  await upsertMarkets(ctx, kalshi);

  const overrides = o.overrides ?? loadVenueOverrides();
  const listed = new Set(kalshi.map((m) => m.id));
  for (const { kalshiId } of overrides) {
    if (listed.has(kalshiId)) continue;
    try {
      await upsertMarkets(ctx, [await ctx.tatum.getMarket(kalshiId)]);
    } catch (err) {
      ctx.log(`kalshi ${kalshiId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const poly = await ctx.db
    .select()
    .from(markets)
    .where(
      and(
        eq(markets.platform, "polymarket"),
        isNull(markets.resolution),
        gt(markets.closeTime, now),
        lt(markets.closeTime, now + o.horizonDays * 86_400_000),
      ),
    );
  const lite = (m: { id: string; question: string; closeTime: number | null; outcomes: Array<{ name: string }> }) => ({
    id: m.id,
    question: m.question,
    closeTime: m.closeTime,
    outcomes: m.outcomes.map((x) => x.name),
  });
  const kalshiRows = await ctx.db.select().from(markets).where(eq(markets.platform, "kalshi"));
  const pairs = matchVenues(poly.map(lite), kalshiRows.map(lite));

  const rows = [
    ...pairs.map((p) => ({ ...p, method: "auto" })),
    ...overrides.map((p) => ({ ...p, score: 1, method: "manual" })),
  ];
  for (const r of rows) {
    const { polyId: _p, ...update } = r;
    await ctx.db.insert(venuePairs).values(r).onConflictDoUpdate({ target: venuePairs.polyId, set: update });
  }
  return rows.length;
}

/** The Kalshi price for the Polymarket market's first outcome, or null when unpaired or unpriced. */
export async function getVenueQuote(
  ctx: EngineCtx,
  polyId: string,
): Promise<{ kalshiId: string; priceA: number; score: number } | null> {
  return venueQuoteFromDb(ctx.db, polyId);
}

export async function venueQuoteFromDb(db: Db, polyId: string): Promise<{ kalshiId: string; priceA: number; score: number } | null> {
  const [pair] = await db.select().from(venuePairs).where(eq(venuePairs.polyId, polyId));
  if (!pair) return null;
  const [k] = await db.select().from(markets).where(eq(markets.id, pair.kalshiId));
  if (!k) return null;
  const yes = (k.outcomes.find((o) => /^yes$/i.test(o.name)) ?? k.outcomes[0])?.price;
  if (yes == null) return null;
  return { kalshiId: pair.kalshiId, priceA: pair.flip ? 1 - yes : yes, score: pair.score };
}
