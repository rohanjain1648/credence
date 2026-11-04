import { markets, marketPrices } from "@/lib/db/schema";
import { categorize } from "@/lib/scoring/categorize";
import type { Market } from "@/lib/tatum/prediction";
import type { EngineCtx } from "./ctx";

const DAY_MS = 86_400_000;
const ELECTION_SEARCHES = ["Senate", "House", "Governor", "midterm", "2026 election"];
const ELECTION_QUESTION = /2026|midterm|senate|house|governor/i;
const ELECTION_CUTOFF = Date.parse("2027-01-01T00:00:00Z");

const parseTime = (iso: string | null | undefined) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** Polymarket URLs end in the event slug, which carries the league prefix for sports. */
const slugFromUrl = (url: string | null | undefined) => (url ? (url.split("?")[0].split("/").filter(Boolean).pop() ?? null) : null);

export function toMarketRow(m: Market, now: number): typeof markets.$inferInsert {
  const url = m.source?.url ?? null;
  return {
    id: m.id,
    platform: m.platform,
    eventId: m.eventId ?? null,
    question: m.question,
    apiCategory: m.category ?? null,
    group: categorize({ title: m.question, apiCategory: m.category, tags: m.tags, eventSlug: slugFromUrl(url) }),
    tags: m.tags ?? [],
    status: m.status ?? null,
    closeTime: parseTime(m.closeTime),
    outcomes: m.outcomes.map((o) => ({ name: o.name, price: o.price ?? null, tokenId: o.tokenId ?? null })),
    volume: m.volume ?? null,
    liquidity: m.liquidity ?? null,
    resolution: m.resolution
      ? {
          outcome: m.resolution.outcome ?? null,
          resolvedAt: m.resolution.resolvedAt ?? null,
          txHash: m.resolution.txHash ?? null,
          source: m.resolution.source ?? null,
        }
      : null,
    url,
    updatedAt: now,
  };
}

export async function upsertMarkets(ctx: EngineCtx, list: Market[]): Promise<number> {
  const now = ctx.now();
  for (const m of list) {
    const row = toMarketRow(m, now);
    const { id: _id, ...update } = row;
    await ctx.db.insert(markets).values(row).onConflictDoUpdate({ target: markets.id, set: update });
    await ctx.db.insert(marketPrices).values({ marketId: m.id, ts: now, prices: row.outcomes.map((o) => o.price), source: "list" });
  }
  return list.length;
}

/**
 * Finds tradable markets closing soon. Against the live API, `category` and `tag` filters return
 * nothing, and sorting by volume or end date fills the page with markets past their close time
 * that are still listed as active. Newest-first with a volume floor returns real upcoming markets,
 * and `categorize` then files each one locally.
 */
export async function syncMarkets(
  ctx: EngineCtx,
  o: { horizonDays: number; minVolume: number; limit: number; maxPages: number },
): Promise<{ upserted: number }> {
  if (!ctx.tatum) return { upserted: 0 };
  const now = ctx.now();
  const endingBefore = new Date(now + o.horizonDays * DAY_MS).toISOString();
  const open: Market[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < o.maxPages; page++) {
    const res = await ctx.tatum.listMarkets({
      platform: "polymarket",
      status: "active",
      endingBefore,
      minVolume: o.minVolume,
      sort: "newest",
      limit: o.limit,
      cursor,
    });
    open.push(...res.data.filter((m) => (parseTime(m.closeTime) ?? 0) > now));
    cursor = res.cursor;
    if (!cursor) break;
  }
  return { upserted: await upsertMarkets(ctx, open) };
}

export async function findElectionMarkets(ctx: EngineCtx, o: { limit: number }): Promise<Market[]> {
  if (!ctx.tatum) return [];
  const byId = new Map<string, Market>();
  for (const search of ELECTION_SEARCHES) {
    const { data } = await ctx.tatum.listMarkets({ platform: "polymarket", status: "active", search, sort: "volume_desc", limit: 50 });
    for (const m of data) byId.set(m.id, m);
  }
  return [...byId.values()]
    .filter((m) => {
      const close = parseTime(m.closeTime);
      return ELECTION_QUESTION.test(m.question) && close !== null && close < ELECTION_CUTOFF;
    })
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, o.limit);
}
