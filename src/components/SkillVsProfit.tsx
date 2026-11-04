"use client";

import Link from "next/link";
import { useState } from "react";
import { signedUsd } from "@/lib/format";

type Voice = { address: string; label: string; credibility: number; pnl: number; counts: boolean };

const W = 640;
const H = 280;
const PAD = { l: 44, r: 16, t: 12, b: 36 };
const TICKS = [-1e6, -1e5, -1e4, -1e3, 0, 1e3, 1e4, 1e5, 1e6, 1e7];

/** Profit spans several orders of magnitude and can be negative, so the x axis is a symmetric log scale. */
const symlog = (v: number) => Math.sign(v) * Math.log10(1 + Math.abs(v) / 100);

/** Each dot is a wallet. Dots high on the chart have skill, dots far right have profit, and those aren't the same wallets. */
export function SkillVsProfit({ voices }: { voices: Voice[] }) {
  const [active, setActive] = useState<Voice | null>(null);
  if (voices.length < 3) return null;

  const scaled = voices.map((v) => symlog(v.pnl));
  const min = Math.min(0, ...scaled);
  const max = Math.max(0, ...scaled);
  const span = Math.max(1, max - min);
  const x = (pnl: number) => PAD.l + ((symlog(pnl) - min) / span) * (W - PAD.l - PAD.r);
  const y = (c: number) => PAD.t + (1 - c / 100) * (H - PAD.t - PAD.b);
  const ticks = TICKS.filter((t) => symlog(t) >= min && symlog(t) <= max);

  return (
    <figure>
      <figcaption className="text-sm text-ink-2">
        Each dot is a wallet. Blue dots have credibility above 55, so they count toward Sharp Lines.
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="group" aria-label="Credibility against realized profit for each wallet">
        {[0, 50, 100].map((c) => (
          <g key={c}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(c)} y2={y(c)} stroke={c === 50 ? "var(--rule-strong)" : "var(--rule)"} strokeWidth={1} />
            <text x={PAD.l - 6} y={y(c) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {c}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={H - PAD.b} y2={H - PAD.b + 4} stroke="var(--rule-strong)" />
            <text x={x(t)} y={H - PAD.b + 16} textAnchor="middle" fontSize={11} fill="var(--muted)">
              {t === 0 ? "$0" : signedUsd(t).replace(".0", "")}
            </text>
          </g>
        ))}
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="var(--ink-2)">
          Realized profit
        </text>
        <text transform={`translate(11 ${(PAD.t + H - PAD.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="var(--ink-2)">
          Credibility
        </text>
        {voices.map((v) => (
          <Link key={v.address} href={`/voices/${v.address}`} aria-label={`${v.label}: credibility ${Math.round(v.credibility)}, profit ${signedUsd(v.pnl)}`}>
            <g onPointerEnter={() => setActive(v)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(v)} onBlur={() => setActive(null)}>
              <circle cx={x(v.pnl)} cy={y(v.credibility)} r={11} fill="transparent" />
              <circle
                cx={x(v.pnl)}
                cy={y(v.credibility)}
                r={active?.address === v.address ? 6 : 4.5}
                fill={v.counts ? "var(--sharp)" : "var(--muted)"}
                stroke="var(--paper)"
                strokeWidth={2}
              />
            </g>
          </Link>
        ))}
      </svg>
      <p className="mt-1 h-5 text-sm text-ink-2" aria-live="polite">
        {active ? `${active.label}: credibility ${Math.round(active.credibility)}, profit ${signedUsd(active.pnl)}` : ""}
      </p>
    </figure>
  );
}
