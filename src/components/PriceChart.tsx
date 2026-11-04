"use client";

import { useState } from "react";

type Point = { ts: number; value: number };
type Props = { outcomeA: string; crowd: Point[]; sharp: Point[] };

const W = 640;
const H = 200;
const PAD = { l: 36, r: 12, t: 12, b: 24 };

/** Crowd price for outcome A over time, with each Sharp Line Credence computed marked on top. */
export function PriceChart({ outcomeA, crowd, sharp }: Props) {
  const [hover, setHover] = useState<Point | null>(null);
  if (crowd.length < 2) return <p className="text-sm text-muted">Not enough price history yet.</p>;

  const t0 = Math.min(crowd[0].ts, sharp[0]?.ts ?? Infinity);
  const t1 = Math.max(crowd.at(-1)!.ts, sharp.at(-1)?.ts ?? -Infinity);
  const x = (ts: number) => PAD.l + ((ts - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v) * (H - PAD.t - PAD.b);
  const path = crowd.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const day = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const ts = t0 + ((e.clientX - box.left) / box.width) * (t1 - t0);
    let best = crowd[0];
    for (const p of crowd) if (Math.abs(p.ts - ts) < Math.abs(best.ts - ts)) best = p;
    setHover(best);
  }

  return (
    <figure>
      <figcaption className="mb-2 text-sm text-ink-2">Chance of {outcomeA}, last 7 days</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Crowd price of ${outcomeA} over time with Sharp Line points`}>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--rule)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {v * 100}%
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 6} fontSize={11} fill="var(--muted)">
          {day(t0)}
        </text>
        <text x={W - PAD.r} y={H - 6} fontSize={11} fill="var(--muted)" textAnchor="end">
          {day(t1)}
        </text>
        <path d={path} fill="none" stroke="var(--crowd)" strokeWidth={2} strokeLinejoin="round" />
        {sharp.map((p) => (
          <circle key={p.ts} cx={x(p.ts)} cy={y(p.value)} r={4.5} fill="var(--sharp)" stroke="var(--paper)" strokeWidth={2}>
            <title>{`Sharp Line ${Math.round(p.value * 100)}%, ${new Date(p.ts).toLocaleString()}`}</title>
          </circle>
        ))}
        {hover && (
          <g pointerEvents="none">
            <line x1={x(hover.ts)} x2={x(hover.ts)} y1={PAD.t} y2={H - PAD.b} stroke="var(--rule-strong)" />
            <circle cx={x(hover.ts)} cy={y(hover.value)} r={4} fill="var(--crowd)" stroke="var(--paper)" strokeWidth={2} />
          </g>
        )}
        <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      <p className="mt-1 h-5 text-sm text-ink-2" aria-live="polite">
        {hover ? `${new Date(hover.ts).toLocaleString()}: crowd ${Math.round(hover.value * 100)}%` : ""}
      </p>
    </figure>
  );
}
