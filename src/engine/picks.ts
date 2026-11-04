import { and, desc, eq } from "drizzle-orm";
import { monotonicFactory } from "ulid";
import { marketPrices, markets, picks, sharpLines } from "@/lib/db/schema";
import { NS } from "@/lib/memory/namespaces";
import { enqueueMemory } from "@/lib/memory/writer";
import type { Group } from "@/lib/scoring/categorize";
import { scoreBets, type VoiceScore } from "@/lib/scoring/credibility";
import { pct } from "./calls";
import type { EngineCtx } from "./ctx";
import { getVenueQuote } from "./venues";

export type PickRow = typeof picks.$inferSelect;
export type SettledPick = { confidence: number; priceAtPick: number; y: number; edge: number; group: Group };
export type PickErrorCode = "MARKET_NOT_FOUND" | "MARKET_CLOSED" | "BAD_CONFIDENCE" | "BAD_HANDLE" | "BAD_OUTCOME" | "NO_PRICE";

export class PickError extends Error {
  constructor(readonly code: PickErrorCode) {
    super(code);
    this.name = "PickError";
  }
}

const HANDLE = /^[a-z0-9_]{3,20}$/;
const MAX_REASON = 280;
const nextId = monotonicFactory();

/** A probability quoted for outcome A, restated for the outcome the user picked. */
const forOutcome = (priceA: number | null | undefined, outcomeIndex: 0 | 1) =>
  priceA == null ? null : outcomeIndex === 0 ? priceA : 1 - priceA;

export async function createPick(
  ctx: EngineCtx,
  i: { handle: string; marketId: string; outcomeIndex: 0 | 1; confidence: number; reason?: string },
): Promise<PickRow> {
  const handle = i.handle.trim().toLowerCase();
  if (!HANDLE.test(handle)) throw new PickError("BAD_HANDLE");
  if (!(i.confidence >= 0.5 && i.confidence <= 0.99)) throw new PickError("BAD_CONFIDENCE");
  if (i.outcomeIndex !== 0 && i.outcomeIndex !== 1) throw new PickError("BAD_OUTCOME");

  const [market] = await ctx.db.select().from(markets).where(eq(markets.id, i.marketId));
  if (!market) throw new PickError("MARKET_NOT_FOUND");
  if (market.outcomes.length !== 2) throw new PickError("BAD_OUTCOME");
  const now = ctx.now();
  if (market.resolution || (market.closeTime !== null && now >= market.closeTime)) throw new PickError("MARKET_CLOSED");

  const [latest] = await ctx.db.select().from(marketPrices).where(eq(marketPrices.marketId, market.id)).orderBy(desc(marketPrices.ts)).limit(1);
  const priceAtPick = latest?.prices[i.outcomeIndex] ?? market.outcomes[i.outcomeIndex].price;
  if (priceAtPick == null) throw new PickError("NO_PRICE");

  const quote = await getVenueQuote(ctx, market.id);
  const [line] = await ctx.db.select().from(sharpLines).where(eq(sharpLines.marketId, market.id)).orderBy(desc(sharpLines.ts)).limit(1);
  const reason = i.reason?.trim().slice(0, MAX_REASON) || null;
  const outcomeName = market.outcomes[i.outcomeIndex].name;

  const row: typeof picks.$inferInsert = {
    id: nextId(),
    handle,
    marketId: market.id,
    outcomeIndex: i.outcomeIndex,
    outcomeName,
    confidence: i.confidence,
    reason,
    priceAtPick,
    kalshiAtPick: forOutcome(quote?.priceA, i.outcomeIndex),
    lineAtPick: forOutcome(line?.line, i.outcomeIndex),
    createdAt: now,
    status: "open",
  };

  const extras = [
    row.lineAtPick != null ? `Sharp Line ${pct(row.lineAtPick)}` : null,
    row.kalshiAtPick != null ? `Kalshi ${pct(row.kalshiAtPick)}` : null,
  ].filter(Boolean);
  const human =
    `@${handle} picked ${outcomeName} on "${market.question}" at ${pct(i.confidence)} confidence ` +
    `when the market said ${pct(priceAtPick)}${extras.length ? ` (${extras.join(", ")})` : ""}.` +
    (reason ? ` Reason: ${reason}` : "");

  row.memoryId = await enqueueMemory(ctx.db, {
    namespace: NS.user(handle),
    kind: "pick",
    human,
    data: { ...row, question: market.question, group: market.group, closeTime: market.closeTime },
    refType: "pick",
    refId: row.id,
  });
  const [stored] = await ctx.db.insert(picks).values(row).returning();
  return stored;
}

export function scorePick(p: { confidence: number; priceAtPick: number }, y: number) {
  return { edge: y - p.priceAtPick, brierUser: (p.confidence - y) ** 2, brierMarket: (p.priceAtPick - y) ** 2 };
}

export async function settlePicksForMarket(ctx: EngineCtx, marketId: string, winningIndex: 0 | 1): Promise<number> {
  const open = await ctx.db.select().from(picks).where(and(eq(picks.marketId, marketId), eq(picks.status, "open")));
  if (open.length === 0) return 0;
  const [market] = await ctx.db.select().from(markets).where(eq(markets.id, marketId));
  const now = ctx.now();

  for (const p of open) {
    const y = p.outcomeIndex === winningIndex ? 1 : 0;
    const s = scorePick(p, y);
    await ctx.db
      .update(picks)
      .set({ status: y === 1 ? "won" : "lost", settledAt: now, y, ...s })
      .where(eq(picks.id, p.id));
    const edgePts = Math.round(s.edge * 100);
    await enqueueMemory(ctx.db, {
      namespace: NS.user(p.handle),
      kind: "scorecard",
      human:
        `Scorecard for @${p.handle}: picked ${p.outcomeName} on "${market?.question ?? marketId}" at ${pct(p.confidence)} ` +
        `(market ${pct(p.priceAtPick)}) — ${y === 1 ? "WON" : "LOST"}. Edge ${edgePts >= 0 ? "+" : ""}${edgePts} pts vs the market; ` +
        `Brier ${s.brierUser.toFixed(3)} vs market ${s.brierMarket.toFixed(3)}.`,
      data: { pickId: p.id, marketId, y, ...s, group: market?.group ?? null },
      refType: "pick",
      refId: p.id,
    });
  }
  return open.length;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function biasReport(settled: SettledPick[]) {
  const byGroup: Partial<Record<Group, { n: number; edge: number }>> = {};
  for (const g of new Set(settled.map((p) => p.group))) {
    const list = settled.filter((p) => p.group === g);
    byGroup[g] = { n: list.length, edge: mean(list.map((p) => p.edge)) };
  }
  const hitRate = mean(settled.map((p) => p.y));
  return {
    n: settled.length,
    hitRate,
    overconfidence: settled.length ? mean(settled.map((p) => p.confidence)) - hitRate : 0,
    favoriteLean: mean(settled.map((p) => p.priceAtPick)),
    byGroup,
  };
}

export type BiasReport = ReturnType<typeof biasReport>;

const MIN_PICKS_FOR_WARNINGS = 5;
const OVERCONFIDENCE_WARNING = 0.1;
const FAVORITE_PRICE = 0.7;

/** What your own record says about the pick you're about to make. Says nothing until the record is big enough. */
export function pickWarnings(report: BiasReport, group: Group, priceOfPick: number): string[] {
  if (report.n < MIN_PICKS_FOR_WARNINGS) return [];
  const warnings: string[] = [];
  const inGroup = report.byGroup[group];
  if (inGroup && inGroup.n >= MIN_PICKS_FOR_WARNINGS && inGroup.edge < 0) {
    warnings.push(`You've averaged ${Math.round(inGroup.edge * 100)} pts against the market on ${group} over ${inGroup.n} picks.`);
  }
  if (report.overconfidence >= OVERCONFIDENCE_WARNING) {
    warnings.push(`You've been overconfident: your confidence runs ${Math.round(report.overconfidence * 100)} pts above your hit rate.`);
  }
  if (report.favoriteLean >= FAVORITE_PRICE && priceOfPick >= FAVORITE_PRICE) {
    warnings.push(`You lean toward favorites: your picks average a market price of ${pct(report.favoriteLean)}, and this one is at ${pct(priceOfPick)}.`);
  }
  return warnings;
}

export type CalibrationBin = { from: number; to: number; n: number; hitRate: number; meanConfidence: number };

/** Groups settled picks by confidence band. A well-calibrated forecaster's hit rate matches each band. */
export function calibrationBins(settled: SettledPick[]): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  for (let band = 0; band < 5; band++) {
    const inBand = settled.filter((p) => Math.min(4, Math.floor((p.confidence - 0.5) * 10 + 1e-9)) === band);
    if (inBand.length === 0) continue;
    bins.push({
      from: (5 + band) / 10,
      to: (6 + band) / 10,
      n: inBand.length,
      hitRate: mean(inBand.map((p) => p.y)),
      meanConfidence: mean(inBand.map((p) => p.confidence)),
    });
  }
  return bins;
}

/** The same skill score wallets get, with the price at pick time standing in for the entry price. */
export function userScore(settled: SettledPick[]): VoiceScore {
  return scoreBets(settled.map((p) => ({ avgPrice: p.priceAtPick, resolution: p.y, totalBought: 100, settledAt: 0, group: p.group })));
}
