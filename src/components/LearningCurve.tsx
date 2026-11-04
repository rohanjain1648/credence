"use client";

import { useState } from "react";

type Point = { i: number; resolvedAt: number; lambda: number; brierMarket: number; brierCredence: number };

const W = 640;
const H = 240;
const PAD = { l: 44, r: 92, t: 12, b: 32 };

/** Running forecast error for the Sharp Line and the crowd. Each market only uses what was learned before it. */
export function LearningCurve({ points }: { points: Point[] }) {
  const [active, setActive] = useState<Point | null>(null);
  if (points.length < 2) {
    return <p className="text-sm text-ink-2">The curve starts once two markets with a Sharp Line have resolved. So far: {points.length}.</p>;
  }

  const top = Math.max(...points.flatMap((p) => [p.brierMarket, p.brierCredence])) * 1.1;
  const x = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const path = (key: "brierMarket" | "brierCredence") => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const last = points.at(-1)!;

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left) / box.width) * (points.length - 1));
    setActive(points[Math.min(points.length - 1, Math.max(0, i))]);
  }

  return (
    <figure>
      <figcaption className="text-sm text-ink-2">Running Brier score after each resolved market. Lower is better.</figcaption>
      <div className="mt-2 flex flex-wrap gap-x-5 text-sm text-ink-2">
        <span className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-4 bg-sharp" /> Sharp Line
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-4 bg-crowd" /> Crowd
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label={`Running Brier score over ${points.length} markets. Sharp Line ${last.brierCredence.toFixed(3)}, crowd ${last.brierMarket.toFixed(3)}.`}>
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--rule)" />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 8} fontSize={11} fill="var(--muted)">
          1st market
        </text>
        <text x={W - PAD.r} y={H - 8} fontSize={11} fill="var(--muted)" textAnchor="end">
          {points.length} markets
        </text>
        <path d={path("brierMarket")} fill="none" stroke="var(--crowd)" strokeWidth={2} strokeLinejoin="round" />
        <path d={path("brierCredence")} fill="none" stroke="var(--sharp)" strokeWidth={2} strokeLinejoin="round" />
        <text x={W - PAD.r + 6} y={y(last.brierCredence) + (last.brierCredence <= last.brierMarket ? 12 : -4)} fontSize={11} fill="var(--ink-2)">
          Sharp {last.brierCredence.toFixed(3)}
        </text>
        <text x={W - PAD.r + 6} y={y(last.brierMarket) + (last.brierCredence <= last.brierMarket ? -4 : 12)} fontSize={11} fill="var(--ink-2)">
          Crowd {last.brierMarket.toFixed(3)}
        </text>
        {active && (
          <g pointerEvents="none">
            <line x1={x(active.i)} x2={x(active.i)} y1={PAD.t} y2={H - PAD.b} stroke="var(--rule-strong)" />
            <circle cx={x(active.i)} cy={y(active.brierMarket)} r={4} fill="var(--crowd)" stroke="var(--paper)" strokeWidth={2} />
            <circle cx={x(active.i)} cy={y(active.brierCredence)} r={4} fill="var(--sharp)" stroke="var(--paper)" strokeWidth={2} />
          </g>
        )}
        <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setActive(null)} />
      </svg>
      <p className="mt-1 h-5 text-sm text-ink-2" aria-live="polite">
        {active ? `After market ${active.i + 1}: Sharp Line ${active.brierCredence.toFixed(3)}, crowd ${active.brierMarket.toFixed(3)}, λ ${active.lambda.toFixed(2)}` : ""}
      </p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-ink-2">Show as a table</summary>
        <table className="mt-2 w-full max-w-md">
          <thead>
            <tr className="border-b border-rule text-left text-ink-2">
              <th className="py-1 pr-3 font-normal">After market</th>
              <th className="py-1 pr-3 text-right font-normal">Sharp Line</th>
              <th className="py-1 pr-3 text-right font-normal">Crowd</th>
              <th className="py-1 text-right font-normal">λ used</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.i} className="border-b border-rule">
                <td className="py-1 pr-3">{p.i + 1}</td>
                <td className="py-1 pr-3 text-right">{p.brierCredence.toFixed(3)}</td>
                <td className="py-1 pr-3 text-right">{p.brierMarket.toFixed(3)}</td>
                <td className="py-1 text-right">{p.lambda.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
