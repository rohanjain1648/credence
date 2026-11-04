export const pct = (p: number | null | undefined) => (p == null ? "–" : `${Math.round(p * 100)}%`);

/** Signed difference in percentage points, e.g. "+9". */
export const pts = (d: number | null | undefined) => {
  if (d == null) return "–";
  const v = Math.round(d * 100);
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)}`;
};

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function closesIn(closeTime: number | null, now: number): string {
  if (closeTime == null) return "no close time";
  const ms = closeTime - now;
  if (ms <= 0) return "closed";
  const h = ms / 3_600_000;
  if (h < 1) return `closes in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 48) return `closes in ${Math.round(h)} h`;
  return `closes in ${Math.round(h / 24)} days`;
}

export const usd = (v: number | null | undefined) =>
  v == null ? "–" : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : `$${Math.round(v)}`;

export const walrusBlobUrl = (blobId: string) => `https://walruscan.com/mainnet/blob/${blobId}`;
export const suiObjectUrl = (id: string) => `https://suiscan.xyz/mainnet/object/${id}`;

export const signedUsd =(v: number | null | undefined) => (v == null ? "–" : `${v < 0 ? "−" : ""}${usd(Math.abs(v))}`);

export const shortDate = (ts: number) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The product change a memory caused, in words. Unknown or missing effects have no description. */
export function describeEffect(effect: unknown): string | null {
  const e = effect as { type?: string; group?: string; before?: number | null; after?: number; priceA?: number; line?: number | null; seq?: number } | null;
  switch (e?.type) {
    case "lambda":
      return `λ ${e.group} ${e.before?.toFixed(2)} to ${e.after?.toFixed(2)}`;
    case "credibility":
      return e.before == null
        ? `Credibility on ${e.group} set to ${Math.round(e.after ?? 0)}`
        : `Credibility on ${e.group} ${Math.round(e.before)} to ${Math.round(e.after ?? 0)}`;
    case "call":
      return e.line == null ? `Crowd at ${pct(e.priceA)}, no Sharp Line` : `Sharp Line ${pct(e.line)} against a crowd at ${pct(e.priceA)}`;
    case "checkpoint":
      return `Checkpoint #${e.seq}`;
    default:
      return null;
  }
}

export const GROUP_LABEL: Record<string, string> = {
  SPORTS: "Sports",
  POLITICS: "Politics",
  CRYPTO: "Crypto",
  CULTURE: "Culture",
  MENTIONS: "Mentions",
  WEATHER: "Weather",
  ECONOMICS: "Economy",
  TECH: "Tech",
  FINANCE: "Finance",
  OTHER: "Other",
  OVERALL: "Overall",
};
