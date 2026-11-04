import { MIN_CREDIBILITY } from "@/lib/scoring/sharpLine";

/** Credibility on a 0–100 track, with a tick at 50 (no evidence). Blue means it counts toward Sharp Lines. */
export function CredibilityTrack({ value }: { value: number }) {
  return (
    <div role="img" aria-label={`Credibility ${Math.round(value)} out of 100`} className="relative h-5 w-full min-w-20">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-rule-strong" />
      <div className="absolute left-1/2 top-1/2 h-3 w-px -translate-y-1/2 bg-rule-strong" />
      <div
        className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-paper ${value > MIN_CREDIBILITY ? "bg-sharp" : "bg-muted"}`}
        style={{ left: `${Math.min(99, Math.max(1, value))}%` }}
      />
    </div>
  );
}
