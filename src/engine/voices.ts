import { and, desc, eq, gte, lt, max, sql } from "drizzle-orm";
import { closedPositions, holderSnapshots, snapshots, voiceScores, wallets } from "@/lib/db/schema";
import { NS } from "@/lib/memory/namespaces";
import { enqueueMemory } from "@/lib/memory/writer";
import { categorize, type Group } from "@/lib/scoring/categorize";
import { scoreByGroup, type ResolvedBet, type VoiceScore } from "@/lib/scoring/credibility";
import type { LeaderboardCategory } from "@/lib/tatum/prediction";
import type { Db } from "@/lib/db/client";
import type { EngineCtx } from "./ctx";

const PAGE_SIZE = 50;
const CANDIDATE_MIN_VALUE = 500;
const CANDIDATE_WINDOW_MS = 48 * 3_600_000;
const HISTORY_FRESH_MS = 24 * 3_600_000;
const DOSSIER_MIN_N = 20;
const DOSSIER_MOVE = 5;
const FALLBACK_MIN_N = 5;

export type VoiceDelta = { address: string; group: Group | "OVERALL"; before: number | null; after: number; n: number };

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export async function seedVoicesFromLeaderboards(
  ctx: EngineCtx,
  o: { categories: LeaderboardCategory[]; periods: Array<"MONTH" | "ALL">; perBoard: number },
): Promise<number> {
  if (!ctx.tatum) return 0;
  const seen = new Set<string>();
  for (const category of o.categories) {
    for (const timePeriod of o.periods) {
      const rows = await ctx.tatum.getTopTraders({ category, timePeriod, orderBy: "PNL", limit: o.perBoard });
      for (const r of rows) {
        const address = r.proxyWallet.toLowerCase();
        seen.add(address);
        await ctx.db
          .insert(wallets)
          .values({
            address,
            name: r.userName ?? null,
            xUsername: r.xUsername ?? null,
            verified: Boolean(r.verifiedBadge),
            profileImage: r.profileImage ?? null,
          })
          .onConflictDoUpdate({
            target: wallets.address,
            set: {
              name: sql`coalesce(excluded.name, ${wallets.name})`,
              xUsername: sql`coalesce(excluded.x_username, ${wallets.xUsername})`,
              verified: sql`excluded.verified`,
              profileImage: sql`coalesce(excluded.profile_image, ${wallets.profileImage})`,
            },
          });
      }
    }
  }
  return seen.size;
}

/** Pulls a wallet's settled bets (newest first) and files each under a category. */
export async function refreshVoiceHistory(ctx: EngineCtx, address: string, o: { maxPages: number }): Promise<number> {
  if (!ctx.tatum) return 0;
  const addr = address.toLowerCase();
  let count = 0;
  for (let page = 0; page < o.maxPages; page++) {
    const rows = await ctx.tatum.getWalletHistory(addr, {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      sortBy: "TIMESTAMP",
      sortDirection: "DESC",
    });
    for (const r of rows) {
      const settledAt = r.timestamp > 1e12 ? r.timestamp : r.timestamp * 1000;
      const values = {
        address: addr,
        conditionId: r.conditionId,
        outcomeIndex: r.outcomeIndex,
        title: r.title ?? null,
        slug: r.slug ?? null,
        eventSlug: r.eventSlug ?? null,
        outcome: r.outcome ?? null,
        avgPrice: r.avgPrice,
        curPrice: r.curPrice,
        realizedPnl: r.realizedPnl,
        totalBought: r.totalBought,
        settledAt,
        group: categorize({ title: r.title, slug: r.slug, eventSlug: r.eventSlug }),
      };
      const { address: _a, conditionId: _c, outcomeIndex: _o, ...update } = values;
      await ctx.db
        .insert(closedPositions)
        .values(values)
        .onConflictDoUpdate({ target: [closedPositions.address, closedPositions.conditionId, closedPositions.outcomeIndex], set: update });
    }
    count += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }
  await ctx.db
    .insert(wallets)
    .values({ address: addr, lastHistoryAt: ctx.now(), historyStale: false })
    .onConflictDoUpdate({ target: wallets.address, set: { lastHistoryAt: ctx.now(), historyStale: false } });
  return count;
}

/** Big recent holders whose track record is missing or out of date, biggest first. */
export async function pickHistoryCandidates(ctx: EngineCtx, limit: number): Promise<string[]> {
  const now = ctx.now();
  const rows = await ctx.db
    .select({
      address: holderSnapshots.address,
      value: max(holderSnapshots.currentValue),
      lastHistoryAt: wallets.lastHistoryAt,
      stale: wallets.historyStale,
    })
    .from(holderSnapshots)
    .innerJoin(snapshots, eq(snapshots.id, holderSnapshots.snapshotId))
    .leftJoin(wallets, eq(wallets.address, holderSnapshots.address))
    .where(and(gte(snapshots.ts, now - CANDIDATE_WINDOW_MS), gte(holderSnapshots.currentValue, CANDIDATE_MIN_VALUE)))
    .groupBy(holderSnapshots.address)
    .orderBy(desc(max(holderSnapshots.currentValue)));
  return rows
    .filter((r) => r.lastHistoryAt == null || r.stale || r.lastHistoryAt < now - HISTORY_FRESH_MS)
    .slice(0, limit)
    .map((r) => r.address);
}

function dossierLabel(credibility: number): string {
  if (credibility >= 65) return "sharp";
  if (credibility <= 35) return "a reliable fade";
  return "neutral";
}

function dossierText(address: string, name: string | null, group: Group, s: VoiceScore, before: number | null): string {
  const who = `Wallet ${shortAddress(address)}${name ? ` (${name})` : ""}`;
  const edgePts = s.edge * 100;
  const was = before === null ? "" : ` (was ${Math.round(before)})`;
  return `${who} is ${dossierLabel(s.credibility)} on ${group}: credibility ${Math.round(s.credibility)}${was} over ${s.n} resolved bets, average edge ${edgePts >= 0 ? "+" : ""}${edgePts.toFixed(1)} pts.`;
}

const isDossierWorthy = (before: number | null, s: VoiceScore) =>
  before === null
    ? s.n >= DOSSIER_MIN_N && (s.credibility >= 65 || s.credibility <= 35)
    : Math.abs(s.credibility - before) >= DOSSIER_MOVE;

/**
 * Recomputes credibility from stored bets and records it as of `asOf`.
 * A dossier memory is written when a voice first proves itself (or proves to be
 * a reliable fade) in a category, or when its credibility moves by DOSSIER_MOVE.
 */
export async function rescoreVoices(ctx: EngineCtx, addresses: string[], asOf: number): Promise<VoiceDelta[]> {
  const deltas: VoiceDelta[] = [];
  for (const raw of addresses) {
    const address = raw.toLowerCase();
    const bets: ResolvedBet[] = (await ctx.db.select().from(closedPositions).where(eq(closedPositions.address, address))).map((p) => ({
      avgPrice: p.avgPrice,
      resolution: p.curPrice,
      totalBought: p.totalBought,
      settledAt: p.settledAt,
      group: p.group as Group,
      realizedPnl: p.realizedPnl,
    }));
    const scores = scoreByGroup(bets, asOf);
    const [wallet] = await ctx.db.select({ name: wallets.name }).from(wallets).where(eq(wallets.address, address));
    const previous = await ctx.db
      .select()
      .from(voiceScores)
      .where(and(eq(voiceScores.voiceId, address), lt(voiceScores.asOf, asOf)))
      .orderBy(desc(voiceScores.asOf));

    for (const [group, s] of Object.entries(scores) as Array<[Group | "OVERALL", VoiceScore]>) {
      const before = previous.find((p) => p.group === group)?.credibility ?? null;
      const row = { voiceId: address, group, asOf, ...s };
      const { voiceId: _v, group: _g, asOf: _a, ...update } = row;
      await ctx.db
        .insert(voiceScores)
        .values(row)
        .onConflictDoUpdate({ target: [voiceScores.voiceId, voiceScores.group, voiceScores.asOf], set: update });
      deltas.push({ address, group, before, after: s.credibility, n: s.n });

      if (group !== "OVERALL" && isDossierWorthy(before, s)) {
        await enqueueMemory(ctx.db, {
          namespace: NS.voices,
          kind: "dossier",
          human: dossierText(address, wallet?.name ?? null, group, s, before),
          data: { address, name: wallet?.name ?? null, group, before, asOf, ...s },
          refType: "wallet",
          refId: address,
          effect: { type: "credibility", address, group, before, after: s.credibility },
        });
      }
    }
  }
  return deltas;
}

/** Category credibility when the sample is big enough, else overall, else unknown. */
export async function latestCredibility(ctx: EngineCtx, address: string, group: Group): Promise<number | null> {
  return credibilityFromDb(ctx.db, address, group);
}

export async function credibilityFromDb(db: Db, address: string, group: Group): Promise<number | null> {
  const addr = address.toLowerCase();
  for (const g of [group, "OVERALL"]) {
    const [row] = await db
      .select()
      .from(voiceScores)
      .where(and(eq(voiceScores.voiceId, addr), eq(voiceScores.group, g)))
      .orderBy(desc(voiceScores.asOf))
      .limit(1);
    if (row && row.n >= FALLBACK_MIN_N) return row.credibility;
  }
  return null;
}
