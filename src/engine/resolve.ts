import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { holderSnapshots, lambdas, markets, picks, sharpLines, wallets } from "@/lib/db/schema";
import { NS } from "@/lib/memory/namespaces";
import { enqueueMemory, type MemoryDraft } from "@/lib/memory/writer";
import type { Group } from "@/lib/scoring/categorize";
import { fitLambda, learningCurve } from "@/lib/scoring/learning";
import { CreditCapError } from "@/lib/tatum/http";
import { pct } from "./calls";
import { writeCheckpoint } from "./checkpoint";
import type { EngineCtx } from "./ctx";
import { upsertMarkets } from "./markets";
import { finalLineBeforeClose, observationsFor, winningIndex } from "./observations";
import { settlePicksForMarket } from "./picks";
import { getLambda } from "./sharp";
import { shortAddress } from "./voices";

export { observationsFor } from "./observations";

export type ResolveReport = {
  checked: number;
  resolved: number;
  lessons: number;
  lambdas: Partial<Record<Group, number>>;
};

type MarketRow = typeof markets.$inferSelect;
type LineRow = typeof sharpLines.$inferSelect;

const RECHECK_BASE_MS = 30 * 60_000;
const RECHECK_MAX_MS = 24 * 3_600_000;

/** Markets can stay unresolved for days after closing, so each check waits twice as long, up to a day. */
const recheckDelayMs = (checks: number) => Math.min(RECHECK_MAX_MS, RECHECK_BASE_MS * 2 ** checks);

function lessonText(market: MarketRow, winner: string, y: number, line: LineRow, right: string[], wrong: string[]): string {
  const a = market.outcomes[0].name;
  const head = `"${market.question}" resolved ${winner}.`;
  if (line.line === null) {
    return `${head} The crowd had ${a} at ${pct(line.priceA)}; there was not enough credible money for a Sharp Line.`;
  }
  const sharpMiss = Math.abs(line.line - y);
  const crowdMiss = Math.abs(line.priceA - y);
  const verdict =
    sharpMiss < crowdMiss
      ? `The Sharp Line (${pct(line.line)}) beat the crowd (${pct(line.priceA)}) on ${a}.`
      : sharpMiss > crowdMiss
        ? `The crowd was closer: crowd ${pct(line.priceA)} vs Sharp Line ${pct(line.line)} on ${a}.`
        : `The Sharp Line matched the crowd at ${pct(line.priceA)} on ${a}.`;
  const list = (xs: string[]) => (xs.length ? xs.map(shortAddress).join(", ") : "none");
  return `${head} ${verdict} Credible voices right: ${list(right)}; wrong: ${list(wrong)}.`;
}

/**
 * Checks tracked markets that have closed, records outcomes, and turns each one into a
 * lesson memory. Then refits how much to trust sharp money per category and checkpoints.
 */
export async function processResolutions(ctx: EngineCtx, o: { maxMarkets: number }): Promise<ResolveReport> {
  const report: ResolveReport = { checked: 0, resolved: 0, lessons: 0, lambdas: {} };
  if (!ctx.tatum) return report;

  const now = ctx.now();
  const withLine = ctx.db.selectDistinct({ id: sharpLines.marketId }).from(sharpLines);
  const withOpenPick = ctx.db.selectDistinct({ id: picks.marketId }).from(picks).where(eq(picks.status, "open"));
  const due = await ctx.db
    .select()
    .from(markets)
    .where(
      and(
        isNull(markets.resolution),
        lt(markets.closeTime, now),
        or(inArray(markets.id, withLine), inArray(markets.id, withOpenPick)),
        or(isNull(markets.nextResolveCheckAt), lte(markets.nextResolveCheckAt, now)),
      ),
    )
    .orderBy(asc(markets.closeTime))
    .limit(o.maxMarkets);

  const lessons: Array<{ group: Group; draft: MemoryDraft }> = [];
  for (const stale of due) {
    report.checked++;
    let fresh;
    try {
      fresh = await ctx.tatum.getMarket(stale.id);
    } catch (err) {
      ctx.log(`resolve: ${stale.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof CreditCapError) break;
      continue;
    }
    if (!fresh.resolution?.outcome) {
      await ctx.db
        .update(markets)
        .set({ resolveChecks: stale.resolveChecks + 1, nextResolveCheckAt: now + recheckDelayMs(stale.resolveChecks) })
        .where(eq(markets.id, stale.id));
      continue;
    }
    await upsertMarkets(ctx, [fresh]);
    const [market] = await ctx.db.select().from(markets).where(eq(markets.id, stale.id));
    const w = winningIndex(market);
    if (w === null) continue;
    report.resolved++;
    await settlePicksForMarket(ctx, market.id, w);

    const line = await finalLineBeforeClose(ctx.db, market);
    if (!line) continue;

    const holders = await ctx.db.select().from(holderSnapshots).where(eq(holderSnapshots.snapshotId, line.snapshotId));
    for (const address of new Set(holders.map((h) => h.address))) {
      await ctx.db
        .insert(wallets)
        .values({ address, historyStale: true })
        .onConflictDoUpdate({ target: wallets.address, set: { historyStale: true } });
    }

    const y = w === 0 ? 1 : 0;
    const winner = market.outcomes[w].name;
    const right = line.contributors.filter((c) => c.outcomeIndex === w).map((c) => c.address);
    const wrong = line.contributors.filter((c) => c.outcomeIndex !== w).map((c) => c.address);
    lessons.push({
      group: market.group as Group,
      draft: {
        namespace: NS.lessons,
        kind: "lesson",
        human: lessonText(market, winner, y, line, right, wrong),
        data: {
          marketId: market.id,
          question: market.question,
          outcomes: market.outcomes.map((x) => x.name),
          winner,
          y,
          priceA: line.priceA,
          consensus: line.consensus,
          line: line.line,
          lambda: line.lambda,
          right,
          wrong,
          group: market.group,
        },
        refType: "market",
        refId: market.id,
      },
    });
  }

  const touched = [...new Set(lessons.map((l) => l.group))];
  const effects = new Map<Group, unknown>();
  if (touched.length) {
    const all = await observationsFor(ctx.db);
    for (const group of touched) {
      const obs = all.filter((x) => x.group === group);
      if (obs.length === 0) continue;
      const before = await getLambda(ctx, group);
      const after = fitLambda(obs);
      const end = learningCurve(obs).at(-1);
      await ctx.db
        .insert(lambdas)
        .values({ group, asOf: ctx.now(), lambda: after, n: obs.length, brierMarket: end?.brierMarket ?? null, brierCredence: end?.brierCredence ?? null })
        .onConflictDoUpdate({ target: [lambdas.group, lambdas.asOf], set: { lambda: after, n: obs.length } });
      report.lambdas[group] = after;
      effects.set(group, { type: "lambda", group, before, after, n: obs.length });
    }
  }

  for (const { group, draft } of lessons) {
    await enqueueMemory(ctx.db, { ...draft, effect: effects.get(group) ?? null });
    report.lessons++;
  }
  if (report.lessons > 0) await writeCheckpoint(ctx, "resolutions");
  return report;
}
