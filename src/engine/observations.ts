import { and, desc, eq, isNotNull, lt } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { markets, sharpLines } from "@/lib/db/schema";
import type { Group } from "@/lib/scoring/categorize";
import type { Observation } from "@/lib/scoring/learning";

type MarketRow = typeof markets.$inferSelect;

/** Index of the outcome that won; Kalshi-style YES/NO maps YES to 0. */
export function winningIndex(market: Pick<MarketRow, "outcomes" | "resolution">): 0 | 1 | null {
  const winner = market.resolution?.outcome?.trim().toLowerCase();
  if (!winner || market.outcomes.length !== 2) return null;
  const i = market.outcomes.findIndex((o) => o.name.trim().toLowerCase() === winner);
  if (i === 0 || i === 1) return i;
  if (winner === "yes") return 0;
  if (winner === "no") return 1;
  return null;
}

/** The last Sharp Line computed strictly before the market closed. */
export async function finalLineBeforeClose(db: Db, market: Pick<MarketRow, "id" | "closeTime">) {
  if (market.closeTime === null) return null;
  const [line] = await db
    .select()
    .from(sharpLines)
    .where(and(eq(sharpLines.marketId, market.id), lt(sharpLines.ts, market.closeTime)))
    .orderBy(desc(sharpLines.ts), desc(sharpLines.id))
    .limit(1);
  return line ?? null;
}

/** One (crowd, credible consensus, outcome) triple per resolved market that had a pre-close Sharp Line. */
export async function observationsFor(db: Db): Promise<Observation[]> {
  const resolved = await db.select().from(markets).where(isNotNull(markets.resolution));
  const out: Observation[] = [];
  for (const m of resolved) {
    const w = winningIndex(m);
    if (w === null) continue;
    const line = await finalLineBeforeClose(db, m);
    if (!line || line.consensus === null) continue;
    const resolvedAt = m.resolution?.resolvedAt ? Date.parse(m.resolution.resolvedAt) : m.updatedAt;
    out.push({ q: line.priceA, s: line.consensus, y: w === 0 ? 1 : 0, group: m.group as Group, resolvedAt });
  }
  return out;
}
