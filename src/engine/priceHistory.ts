import { and, eq } from "drizzle-orm";
import { kv, marketPrices } from "@/lib/db/schema";
import { CREDITS } from "@/lib/tatum/prediction";
import { optionalCreditsAvailable, type EngineCtx } from "./ctx";

const FRESH_MS = 3_600_000;
const RANGE_MS = 7 * 86_400_000;

/**
 * Fills hourly crowd prices for the chart from Tatum, at most once an hour per market, while
 * optional credits remain. The fetch time is recorded separately from the prices, because Tatum
 * can return no candles and that answer must not trigger a paid refetch on every page view.
 */
export async function ensurePriceHistory(ctx: EngineCtx, marketId: string): Promise<void> {
  if (!ctx.tatum) return;
  const now = ctx.now();
  const key = `priceHistory:${marketId}`;
  const [last] = await ctx.db.select().from(kv).where(eq(kv.key, key));
  if (last && now - Number(last.value) < FRESH_MS) return;
  if ((await optionalCreditsAvailable(ctx)) < CREDITS.priceHistory) return;

  const res = await ctx.tatum.getPriceHistory(marketId, {
    interval: "1h",
    start: new Date(now - RANGE_MS).toISOString(),
    end: new Date(now).toISOString(),
  });
  const value = String(now);
  await ctx.db.insert(kv).values({ key, value }).onConflictDoUpdate({ target: kv.key, set: { value } });

  const rows = res.candles.map((c) => ({ marketId, ts: Date.parse(c.timestamp), prices: [c.close, 1 - c.close], source: "history" }));
  if (rows.length === 0) return;
  await ctx.db.delete(marketPrices).where(and(eq(marketPrices.marketId, marketId), eq(marketPrices.source, "history")));
  await ctx.db.insert(marketPrices).values(rows);
}
