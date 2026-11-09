import { and, asc, count, desc, eq, gt, gte, inArray, isNull, max } from "drizzle-orm";
import type { CheckpointPayload } from "@/engine/checkpoint";
import { creditsUsedSince, startOfUtcDay } from "@/engine/ctx";
import { observationsFor } from "@/engine/observations";
import { biasReport, calibrationBins, userScore, type SettledPick } from "@/engine/picks";
import { credibilityFromDb } from "@/engine/voices";
import { venueQuoteFromDb } from "@/engine/venues";
import type { Db } from "@/lib/db/client";
import {
  checkpoints,
  closedPositions,
  holderSnapshots,
  lambdas,
  marketPrices,
  markets,
  memories,
  picks,
  sharpLines,
  snapshots,
  voiceScores,
  wallets,
} from "@/lib/db/schema";
import { describeEffect } from "@/lib/format";
import { decodeMemory } from "@/lib/memory/format";
import type { Group } from "@/lib/scoring/categorize";
import { LAMBDA_PRIOR, learningCurve } from "@/lib/scoring/learning";
import { computeSharpLine } from "@/lib/scoring/sharpLine";

type MarketRow = typeof markets.$inferSelect;
type LineRow = typeof sharpLines.$inferSelect;

export type RadarRow = {
  market: MarketRow;
  group: Group;
  closeTime: number | null;
  priceA: number | null;
  line: number | null;
  weight: number | null;
  kalshiA: number | null;
  sharpGap: number | null;
  venueGap: number | null;
  /** Other open markets in the same event (e.g. other brackets), folded into this row. */
  siblings: number;
};

const CANDIDATES = 300;
/** Below 3% or above 97% a market is all but decided and crowds out the ones worth reading. */
const LONG_SHOT = 0.03;
const isLongShot = (p: number | null) => p !== null && (p < LONG_SHOT || p > 1 - LONG_SHOT);

async function latestLine(db: Db, marketId: string): Promise<LineRow | null> {
  const [row] = await db.select().from(sharpLines).where(eq(sharpLines.marketId, marketId)).orderBy(desc(sharpLines.ts), desc(sharpLines.id)).limit(1);
  return row ?? null;
}

const gapOf = (r: RadarRow) => Math.max(Math.abs(r.sharpGap ?? 0), Math.abs(r.venueGap ?? 0));
const hasGap = (r: RadarRow) => r.sharpGap !== null || r.venueGap !== null;

/** Open Polymarket markets, biggest disagreement (credible money or Kalshi vs the crowd) first. */
export async function getRadar(db: Db, o: { group?: Group; limit: number; now?: number; includeLongShots?: boolean }): Promise<RadarRow[]> {
  const now = o.now ?? Date.now();
  const filters = [eq(markets.platform, "polymarket"), isNull(markets.resolution), gt(markets.closeTime, now)];
  if (o.group) filters.push(eq(markets.group, o.group));
  const open = await db.select().from(markets).where(and(...filters)).orderBy(desc(markets.volume)).limit(CANDIDATES);

  // Markets arrive biggest first, so the first one seen per event becomes that event's row.
  const shown = new Map<string, number>();
  const rows: RadarRow[] = [];
  for (const market of open) {
    const priceA = market.outcomes.length === 2 ? market.outcomes[0].price : null;
    if (!o.includeLongShots && isLongShot(priceA)) continue;
    if (market.eventId) {
      const at = shown.get(market.eventId);
      if (at !== undefined) {
        rows[at].siblings++;
        continue;
      }
      shown.set(market.eventId, rows.length);
    }
    const line = await latestLine(db, market.id);
    const quote = await venueQuoteFromDb(db, market.id);
    rows.push({
      market,
      group: market.group as Group,
      closeTime: market.closeTime,
      priceA,
      line: line?.line ?? null,
      weight: line?.weight ?? null,
      kalshiA: quote?.priceA ?? null,
      sharpGap: priceA !== null && line?.line != null ? line.line - priceA : null,
      venueGap: priceA !== null && quote ? quote.priceA - priceA : null,
      siblings: 0,
    });
  }
  return rows
    .sort((a, b) => Number(hasGap(b)) - Number(hasGap(a)) || gapOf(b) - gapOf(a) || (b.market.volume ?? 0) - (a.market.volume ?? 0))
    .slice(0, o.limit);
}

export type MarketView = NonNullable<Awaited<ReturnType<typeof getMarketView>>>;

export async function getMarketView(db: Db, id: string) {
  const [market] = await db.select().from(markets).where(eq(markets.id, id));
  if (!market) return null;
  const group = market.group as Group;

  const [snapshot] = await db.select().from(snapshots).where(eq(snapshots.marketId, id)).orderBy(desc(snapshots.ts)).limit(1);
  const rawHolders = snapshot
    ? await db
        .select({
          address: holderSnapshots.address,
          outcomeIndex: holderSnapshots.outcomeIndex,
          currentValue: holderSnapshots.currentValue,
          avgPrice: holderSnapshots.avgPrice,
          name: wallets.name,
        })
        .from(holderSnapshots)
        .leftJoin(wallets, eq(wallets.address, holderSnapshots.address))
        .where(eq(holderSnapshots.snapshotId, snapshot.id))
        .orderBy(desc(holderSnapshots.currentValue))
    : [];
  const holders = await Promise.all(rawHolders.map(async (h) => ({ ...h, credibility: await credibilityFromDb(db, h.address, group) })));

  const lineHistory = await db
    .select({ ts: sharpLines.ts, priceA: sharpLines.priceA, line: sharpLines.line })
    .from(sharpLines)
    .where(eq(sharpLines.marketId, id))
    .orderBy(sharpLines.ts);
  const prices = await db
    .select({ ts: marketPrices.ts, prices: marketPrices.prices, source: marketPrices.source })
    .from(marketPrices)
    .where(eq(marketPrices.marketId, id))
    .orderBy(marketPrices.ts);
  const pickCounts = await db
    .select({ outcomeIndex: picks.outcomeIndex, n: count() })
    .from(picks)
    .where(eq(picks.marketId, id))
    .groupBy(picks.outcomeIndex);

  return {
    market,
    group,
    priceA: market.outcomes.length === 2 ? market.outcomes[0].price : null,
    line: await latestLine(db, id),
    lineHistory,
    prices,
    kalshi: await venueQuoteFromDb(db, id),
    snapshot: snapshot ?? null,
    holders,
    picks: [0, 1].map((i) => pickCounts.find((p) => p.outcomeIndex === i)?.n ?? 0),
  };
}

const MIN_BOARD_BETS = 20;

/** The strongest voices in a category: each wallet's latest score, with enough bets behind it to mean something. */
export async function getVoicesBoard(db: Db, o: { group: Group | "OVERALL"; limit: number }) {
  const latest = db
    .select({ voiceId: voiceScores.voiceId, asOf: max(voiceScores.asOf).as("latest_as_of") })
    .from(voiceScores)
    .where(eq(voiceScores.group, o.group))
    .groupBy(voiceScores.voiceId)
    .as("latest");
  return db
    .select({
      address: voiceScores.voiceId,
      name: wallets.name,
      verified: wallets.verified,
      credibility: voiceScores.credibility,
      n: voiceScores.n,
      wins: voiceScores.wins,
      edge: voiceScores.edge,
      pnl: voiceScores.pnl,
      volume: voiceScores.volume,
    })
    .from(voiceScores)
    .innerJoin(latest, and(eq(voiceScores.voiceId, latest.voiceId), eq(voiceScores.asOf, latest.asOf)))
    .leftJoin(wallets, eq(wallets.address, voiceScores.voiceId))
    .where(and(eq(voiceScores.group, o.group), gte(voiceScores.n, MIN_BOARD_BETS)))
    .orderBy(desc(voiceScores.credibility))
    .limit(o.limit);
}

export type VoicesBoardRow = Awaited<ReturnType<typeof getVoicesBoard>>[number];

const decodedText = (text: string) => decodeMemory(text)?.human ?? text;

export async function getVoiceView(db: Db, rawAddress: string) {
  const address = rawAddress.toLowerCase();
  const [wallet] = await db.select().from(wallets).where(eq(wallets.address, address));
  const rows = await db.select().from(voiceScores).where(eq(voiceScores.voiceId, address)).orderBy(asc(voiceScores.asOf));
  if (!wallet && rows.length === 0) return null;

  const latestByGroup = new Map(rows.map((r) => [r.group, r]));
  const bets = await db.select().from(closedPositions).where(eq(closedPositions.address, address)).orderBy(desc(closedPositions.settledAt)).limit(20);
  const [betCount] = await db.select({ n: count() }).from(closedPositions).where(eq(closedPositions.address, address));
  const receipts = await db
    .select()
    .from(memories)
    .where(and(eq(memories.refType, "wallet"), eq(memories.refId, address)))
    .orderBy(desc(memories.createdAt))
    .limit(20);

  return {
    address,
    name: wallet?.name ?? null,
    xUsername: wallet?.xUsername ?? null,
    verified: wallet?.verified ?? false,
    lastHistoryAt: wallet?.lastHistoryAt ?? null,
    scores: [...latestByGroup.values()].sort((a, b) => b.credibility - a.credibility),
    history: rows.map((r) => ({ group: r.group, asOf: r.asOf, credibility: r.credibility })),
    bets,
    betCount: betCount?.n ?? 0,
    receipts: receipts.map((m) => ({
      id: m.id,
      human: decodedText(m.text),
      status: m.status,
      blobId: m.blobId,
      createdAt: m.createdAt,
      effect: describeEffect(m.effect),
    })),
  };
}

export type VoiceView = NonNullable<Awaited<ReturnType<typeof getVoiceView>>>;

export async function getMeView(db: Db, rawHandle: string) {
  const handle = rawHandle.trim().toLowerCase();
  const rows = await db
    .select({ pick: picks, question: markets.question, group: markets.group, closeTime: markets.closeTime, blobId: memories.blobId, memoryStatus: memories.status })
    .from(picks)
    .leftJoin(markets, eq(markets.id, picks.marketId))
    .leftJoin(memories, eq(memories.id, picks.memoryId))
    .where(eq(picks.handle, handle))
    .orderBy(desc(picks.createdAt));

  const items = rows.map(({ pick, ...rest }) => ({ ...pick, ...rest, question: rest.question ?? pick.marketId, group: (rest.group ?? "OTHER") as Group }));
  const open = items.filter((p) => p.status === "open");
  const settled = items.filter((p) => p.status !== "open");
  const scored: SettledPick[] = settled.map((p) => ({ confidence: p.confidence, priceAtPick: p.priceAtPick, y: p.y ?? 0, edge: p.edge ?? 0, group: p.group }));

  return {
    handle,
    open,
    settled,
    score: scored.length > 0 ? userScore(scored) : null,
    bias: biasReport(scored),
    calibration: calibrationBins(scored),
  };
}

export type MeView = Awaited<ReturnType<typeof getMeView>>;

export async function getBrainView(db: Db, now: number = Date.now()) {
  const recent = await db.select().from(memories).orderBy(desc(memories.createdAt), desc(memories.id)).limit(100);
  const tally = await db.select({ namespace: memories.namespace, status: memories.status, n: count() }).from(memories).groupBy(memories.namespace, memories.status);
  const sumWhere = (statuses: string[]) => tally.filter((t) => statuses.includes(t.status)).reduce((a, t) => a + t.n, 0);

  const namespaces = new Map<string, number>();
  for (const t of tally) {
    const namespace = t.namespace.startsWith("credence-user-") ? "credence-user" : t.namespace;
    namespaces.set(namespace, (namespaces.get(namespace) ?? 0) + t.n);
  }

  const lambdaRows = await db.select().from(lambdas).orderBy(desc(lambdas.asOf));
  const latestLambda = new Map<string, { group: string; lambda: number; n: number }>();
  for (const r of lambdaRows) if (!latestLambda.has(r.group)) latestLambda.set(r.group, { group: r.group, lambda: r.lambda, n: r.n });

  const checkpointRows = await db
    .select({ seq: checkpoints.seq, ts: checkpoints.ts, payload: checkpoints.payload, blobId: memories.blobId })
    .from(checkpoints)
    .leftJoin(memories, eq(memories.id, checkpoints.memoryId))
    .orderBy(asc(checkpoints.seq));

  return {
    feed: recent.map((m) => ({
      id: m.id,
      namespace: m.namespace,
      kind: m.kind,
      human: decodedText(m.text),
      status: m.status,
      blobId: m.blobId,
      effect: describeEffect(m.effect),
      error: m.error,
      createdAt: m.createdAt,
      storedAt: m.storedAt,
    })),
    counts: {
      stored: sumWhere(["stored"]),
      onTheWay: sumWhere(["queued", "sent"]),
      failed: sumWhere(["failed"]),
      total: tally.reduce((a, t) => a + t.n, 0),
      byNamespace: [...namespaces].map(([namespace, n]) => ({ namespace, n })).sort((a, b) => b.n - a.n || a.namespace.localeCompare(b.namespace)),
    },
    creditsToday: await creditsUsedSince(db, startOfUtcDay(now)),
    curve: learningCurve(await observationsFor(db)),
    lambdas: [...latestLambda.values()],
    checkpoints: checkpointRows.map((c) => ({ seq: c.seq, ts: c.ts, reason: (c.payload as CheckpointPayload).reason, blobId: c.blobId })),
  };
}

export type BrainView = Awaited<ReturnType<typeof getBrainView>>;

const TIME_MACHINE_LINES = 20;
const TIME_MACHINE_VOICES = 10;

/**
 * What Credence believed at a checkpoint: its λ and strongest voices, and today's open markets
 * re-priced with that older memory, using the same fallback rules as the live engine.
 */
export async function getTimeMachine(db: Db, seq: number, now: number = Date.now()) {
  const [checkpoint] = await db.select().from(checkpoints).where(eq(checkpoints.seq, seq));
  if (!checkpoint) return null;
  const payload = checkpoint.payload as CheckpointPayload;
  const credibility = new Map(payload.voices.map(([address, group, value]) => [`${address}|${group}`, value]));

  const open = await db
    .select()
    .from(markets)
    .where(and(eq(markets.platform, "polymarket"), isNull(markets.resolution), gt(markets.closeTime, now)));

  const lines: Array<{ marketId: string; question: string; outcomeA: string; priceA: number; lineThen: number | null; lineNow: number | null }> = [];
  for (const market of open) {
    if (market.outcomes.length !== 2) continue;
    const line = await latestLine(db, market.id);
    if (!line) continue;
    const group = market.group as Group;
    const holders = await db.select().from(holderSnapshots).where(eq(holderSnapshots.snapshotId, line.snapshotId));
    const then = computeSharpLine(
      line.priceA,
      holders.map((h) => ({
        address: h.address,
        outcomeIndex: h.outcomeIndex as 0 | 1,
        currentValue: h.currentValue,
        credibility: credibility.get(`${h.address}|${group}`) ?? credibility.get(`${h.address}|OVERALL`) ?? null,
      })),
      payload.lambda[group] ?? LAMBDA_PRIOR,
    );
    lines.push({ marketId: market.id, question: market.question, outcomeA: market.outcomes[0].name, priceA: line.priceA, lineThen: then.line, lineNow: line.line });
  }
  const moved = (l: (typeof lines)[number]) => Math.abs((l.lineThen ?? l.priceA) - (l.lineNow ?? l.priceA));
  lines.sort((a, b) => moved(b) - moved(a));

  const top = payload.voices.slice(0, TIME_MACHINE_VOICES);
  const names = top.length ? await db.select({ address: wallets.address, name: wallets.name }).from(wallets).where(inArray(wallets.address, top.map((v) => v[0]))) : [];
  const nameOf = new Map(names.map((w) => [w.address, w.name]));

  return {
    seq: payload.seq,
    ts: checkpoint.ts,
    reason: payload.reason,
    lambda: payload.lambda,
    stats: payload.stats,
    voiceCount: payload.voices.length,
    voices: top.map(([address, group, value, n]) => ({ address, name: nameOf.get(address) ?? null, group, credibility: value, n })),
    lines: lines.slice(0, TIME_MACHINE_LINES),
  };
}

export type TimeMachineView = NonNullable<Awaited<ReturnType<typeof getTimeMachine>>>;

export async function getHeaderStats(db: Db) {
  const byStatus = await db.select({ status: memories.status, n: count() }).from(memories).groupBy(memories.status);
  const n = (...statuses: string[]) => byStatus.filter((s) => statuses.includes(s.status)).reduce((a, s) => a + s.n, 0);
  const voices = await db.selectDistinct({ voiceId: voiceScores.voiceId }).from(voiceScores).where(gte(voiceScores.n, 20));
  const lambdaRows = await db.select().from(lambdas).orderBy(desc(lambdas.asOf));
  const latest: Partial<Record<Group, number>> = {};
  for (const r of lambdaRows) if (!(r.group in latest)) latest[r.group as Group] = r.lambda;
  return { memoriesStored: n("stored"), memoriesQueued: n("queued", "sent"), memoriesFailed: n("failed"), voices: voices.length, lambdas: latest };
}

