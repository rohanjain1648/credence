export type MarketLite = { id: string; question: string; closeTime: number | null; outcomes: string[] };
export type VenuePair = { polyId: string; kalshiId: string; score: number; flip: boolean };

const STOPWORDS = new Set([
  "a", "an", "the", "will", "be", "is", "are", "was", "of", "in", "on", "at", "to", "by", "for", "and", "or",
  "this", "that", "vs", "v", "versus", "who", "which", "what", "win", "wins", "winner", "does", "do", "game", "match",
]);

export function normalizeQuestion(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t));
}

export function similarity(a: string, b: string): number {
  const sa = new Set(normalizeQuestion(a));
  const sb = new Set(normalizeQuestion(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared++;
  return shared / (sa.size + sb.size - shared);
}

/**
 * Kalshi asks one yes/no question per side ("Will the Celtics win vs Lakers?"); Polymarket
 * often names both sides as outcomes. YES maps to whichever Polymarket outcome the Kalshi
 * question mentions first.
 */
function isFlipped(poly: MarketLite, kalshi: MarketLite): boolean {
  const [a, b] = poly.outcomes.map((o) => o.toLowerCase());
  if (!a || !b || a === "yes") return false;
  const text = ` ${normalizeQuestion(kalshi.question).join(" ")} `;
  const firstAt = (name: string) => {
    const tokens = normalizeQuestion(name);
    const hits = tokens.map((t) => text.indexOf(` ${t} `)).filter((i) => i >= 0);
    return hits.length ? Math.min(...hits) : Infinity;
  };
  return firstAt(b) < firstAt(a);
}

export function matchVenues(
  poly: MarketLite[],
  kalshi: MarketLite[],
  o: { minScore?: number; maxCloseGapMs?: number } = {},
): VenuePair[] {
  const minScore = o.minScore ?? 0.55;
  const maxGap = o.maxCloseGapMs ?? 3 * 86_400_000;
  const pairs: VenuePair[] = [];
  for (const p of poly) {
    let best: { k: MarketLite; score: number } | null = null;
    for (const k of kalshi) {
      if (p.closeTime === null || k.closeTime === null || Math.abs(p.closeTime - k.closeTime) > maxGap) continue;
      const score = similarity(p.question, k.question);
      if (score >= minScore && (!best || score > best.score)) best = { k, score };
    }
    if (best) pairs.push({ polyId: p.id, kalshiId: best.k.id, score: best.score, flip: isFlipped(p, best.k) });
  }
  return pairs;
}
