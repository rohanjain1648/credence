import type { Group } from "./categorize";

export type ResolvedBet = {
  avgPrice: number;
  /** Resolution price of the held outcome: 1 = won, 0 = lost, 0.5 = split. */
  resolution: number;
  totalBought: number;
  settledAt: number;
  group: Group;
  realizedPnl?: number;
};

export type VoiceScore = { n: number; wins: number; edge: number; z: number; credibility: number; pnl: number; volume: number };

/** Prior strength in pseudo-bets: keeps lucky small samples near neutral. */
export const PRIOR_K = 10;
const MIN_PRICE = 0.005;
const MAX_PRICE = 0.995;
const MIN_STAKE_USD = 5;

export function credibilityFromZ(z: number): number {
  return 50 + 50 * Math.tanh(z / 3);
}

/**
 * Skill against the price paid: a bet bought at p that resolves to y earns y − p.
 * Shrunk z-score of those edges → credibility 0..100 (50 = no evidence).
 */
export function scoreBets(bets: ResolvedBet[], asOf?: number): VoiceScore {
  let n = 0;
  let wins = 0;
  let sumEdge = 0;
  let sumVar = 0;
  let pnl = 0;
  let volume = 0;

  for (const b of bets) {
    if (b.avgPrice <= MIN_PRICE || b.avgPrice >= MAX_PRICE) continue;
    if (b.totalBought < MIN_STAKE_USD) continue;
    if (asOf !== undefined && b.settledAt > asOf) continue;
    n++;
    if (b.resolution >= 0.99) wins++;
    sumEdge += b.resolution - b.avgPrice;
    sumVar += b.avgPrice * (1 - b.avgPrice);
    pnl += b.realizedPnl ?? 0;
    volume += b.totalBought;
  }

  const z = sumEdge / Math.sqrt(sumVar + 0.25 * PRIOR_K);
  return { n, wins, edge: sumEdge / (n + PRIOR_K), z, credibility: credibilityFromZ(z), pnl, volume };
}

export function scoreByGroup(bets: ResolvedBet[], asOf?: number): Partial<Record<Group | "OVERALL", VoiceScore>> {
  const byGroup = new Map<Group, ResolvedBet[]>();
  for (const b of bets) {
    const list = byGroup.get(b.group) ?? [];
    list.push(b);
    byGroup.set(b.group, list);
  }
  const out: Partial<Record<Group | "OVERALL", VoiceScore>> = { OVERALL: scoreBets(bets, asOf) };
  for (const [group, list] of byGroup) out[group] = scoreBets(list, asOf);
  return out;
}
