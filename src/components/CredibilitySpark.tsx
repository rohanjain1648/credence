import { shortDate } from "@/lib/format";

type Point = { asOf: number; credibility: number };

const W = 320;
const H = 72;
const PAD = 6;

/** How one voice's credibility moved over time. The dashed line is 50, which means no evidence. */
export function CredibilitySpark({ label, points }: { label: string; points: Point[] }) {
  if (points.length < 2) return null;
  const t0 = points[0].asOf;
  const t1 = points.at(-1)!.asOf;
  const x = (t: number) => PAD + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * PAD);
  const y = (c: number) => PAD + (1 - c / 100) * (H - 2 * PAD);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.asOf).toFixed(1)},${y(p.credibility).toFixed(1)}`).join(" ");
  const last = points.at(-1)!;

  return (
    <figure>
      <figcaption className="text-sm text-ink-2">
        Credibility on {label}: {Math.round(points[0].credibility)} on {shortDate(t0)}, {Math.round(last.credibility)} on {shortDate(t1)}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full max-w-md" role="img" aria-label={`Credibility on ${label} over time`}>
        <line x1={PAD} x2={W - PAD} y1={y(50)} y2={y(50)} stroke="var(--rule-strong)" strokeDasharray="3 3" />
        <path d={path} fill="none" stroke="var(--sharp)" strokeWidth={2} strokeLinejoin="round" />
        <circle cx={x(last.asOf)} cy={y(last.credibility)} r={4} fill="var(--sharp)" stroke="var(--paper)" strokeWidth={2} />
      </svg>
    </figure>
  );
}
