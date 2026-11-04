export const MIN_CREDIBILITY = 55;
export const MIN_WEIGHT = 1.0;
const MAX_CONTRIBUTORS = 5;

export type SharpHolder = { address: string; outcomeIndex: 0 | 1; currentValue: number; credibility: number | null };
export type SharpContributor = { address: string; outcomeIndex: 0 | 1; weight: number; credibility: number };
export type SharpLineResult = {
  consensus: number | null;
  line: number | null;
  weight: number;
  contributors: SharpContributor[];
};

/** Only voices above MIN_CREDIBILITY count; skill matters quadratically, money logarithmically. */
export function holderWeight(credibility: number, currentValue: number): number {
  if (credibility <= MIN_CREDIBILITY || currentValue <= 0) return 0;
  return ((credibility - 50) / 50) ** 2 * Math.log1p(currentValue);
}

/**
 * Consensus S = share of credible weight on outcome A (index 0).
 * Sharp Line L = q + λ·(S − q): the crowd price pulled toward credible money.
 */
export function computeSharpLine(priceA: number, holders: SharpHolder[], lambda: number): SharpLineResult {
  const weighted: SharpContributor[] = [];
  for (const h of holders) {
    if (h.credibility === null) continue;
    const weight = holderWeight(h.credibility, h.currentValue);
    if (weight > 0) weighted.push({ address: h.address, outcomeIndex: h.outcomeIndex, weight, credibility: h.credibility });
  }

  const weight = weighted.reduce((s, c) => s + c.weight, 0);
  const contributors = weighted.sort((a, b) => b.weight - a.weight).slice(0, MAX_CONTRIBUTORS);
  if (weight < MIN_WEIGHT) return { consensus: null, line: null, weight, contributors };

  const onA = weighted.filter((c) => c.outcomeIndex === 0).reduce((s, c) => s + c.weight, 0);
  const consensus = onA / weight;
  const line = Math.min(0.99, Math.max(0.01, priceA + lambda * (consensus - priceA)));
  return { consensus, line, weight, contributors };
}
