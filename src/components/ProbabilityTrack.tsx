import { pct } from "@/lib/format";

type Props = {
  outcomeA: string;
  crowd: number | null;
  sharp: number | null;
  kalshi: number | null;
  size?: "row" | "hero";
};

const at = (p: number) => `${Math.min(99.5, Math.max(0.5, p * 100))}%`;

/**
 * One 0–100% track for outcome A with three markers: the crowd (tick), the Sharp Line
 * (dot) and Kalshi (diamond). Distance between markers is the disagreement.
 */
export function ProbabilityTrack({ outcomeA, crowd, sharp, kalshi, size = "row" }: Props) {
  const hero = size === "hero";
  const label = [
    `Chance of ${outcomeA}.`,
    crowd != null && `Crowd ${pct(crowd)}.`,
    sharp != null && `Sharp Line ${pct(sharp)}.`,
    kalshi != null && `Kalshi ${pct(kalshi)}.`,
  ]
    .filter(Boolean)
    .join(" ");
  const lo = crowd != null && sharp != null ? Math.min(crowd, sharp) : null;
  const hi = crowd != null && sharp != null ? Math.max(crowd, sharp) : null;

  return (
    <div role="img" aria-label={label} className={`relative w-full ${hero ? "h-14" : "h-7"}`}>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-rule-strong" />
      {[0.25, 0.5, 0.75].map((t) => (
        <div key={t} className={`absolute top-1/2 w-px -translate-y-1/2 bg-rule ${t === 0.5 ? "h-4" : "h-2"}`} style={{ left: at(t) }} />
      ))}
      {lo != null && hi != null && (
        <div
          className={`absolute top-1/2 -translate-y-1/2 rounded-sm bg-sharp-wash ${hero ? "h-5" : "h-3"}`}
          style={{ left: at(lo), width: `${(hi - lo) * 100}%` }}
        />
      )}
      {crowd != null && (
        <div
          title={`Crowd ${pct(crowd)}`}
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-crowd ${hero ? "h-9 w-[3px]" : "h-5 w-[3px]"}`}
          style={{ left: at(crowd) }}
        />
      )}
      {kalshi != null && (
        <div
          title={`Kalshi ${pct(kalshi)}`}
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-kalshi bg-surface ${hero ? "h-3.5 w-3.5" : "h-2.5 w-2.5"}`}
          style={{ left: at(kalshi) }}
        />
      )}
      {sharp != null && (
        <div
          title={`Sharp Line ${pct(sharp)}`}
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sharp ring-2 ring-paper ${hero ? "h-4 w-4" : "h-3 w-3"}`}
          style={{ left: at(sharp) }}
        />
      )}
    </div>
  );
}

export function TrackLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-2">
      <span className="flex items-center gap-2">
        <span className="inline-block h-4 w-[3px] rounded-full bg-crowd" /> Crowd (Polymarket price)
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full bg-sharp" /> Sharp Line (credible money)
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rotate-45 border-2 border-kalshi" /> Kalshi
      </span>
    </div>
  );
}
