import type { Group } from "./categorize";

export type Observation = { q: number; s: number; y: number; group: Group; resolvedAt: number };

export const LAMBDA_PRIOR = 0.25;
export const LAMBDA_KAPPA = 0.5;
export const LAMBDA_MAX = 0.6;

/**
 * Least-squares trust in sharp money, shrunk toward the prior:
 * λ = (Σ(s−q)(y−q) + κ·λ₀) / (Σ(s−q)² + κ), clamped to [0, LAMBDA_MAX].
 */
export function fitLambda(obs: Observation[]): number {
  let num = LAMBDA_KAPPA * LAMBDA_PRIOR;
  let den = LAMBDA_KAPPA;
  for (const o of obs) {
    num += (o.s - o.q) * (o.y - o.q);
    den += (o.s - o.q) ** 2;
  }
  return Math.min(LAMBDA_MAX, Math.max(0, num / den));
}

export function brier(p: number, y: number): number {
  return (p - y) ** 2;
}

/**
 * Prequential evaluation: each market is scored with the λ learned only from
 * markets in its group that resolved before it, so the curve never peeks ahead.
 */
export function learningCurve(
  obs: Observation[],
): Array<{ i: number; resolvedAt: number; lambda: number; brierMarket: number; brierCredence: number }> {
  const sorted = [...obs].sort((a, b) => a.resolvedAt - b.resolvedAt);
  let sumMarket = 0;
  let sumCredence = 0;
  return sorted.map((o, i) => {
    const lambda = fitLambda(sorted.slice(0, i).filter((p) => p.group === o.group));
    const line = Math.min(0.99, Math.max(0.01, o.q + lambda * (o.s - o.q)));
    sumMarket += brier(o.q, o.y);
    sumCredence += brier(line, o.y);
    return { i, resolvedAt: o.resolvedAt, lambda, brierMarket: sumMarket / (i + 1), brierCredence: sumCredence / (i + 1) };
  });
}
