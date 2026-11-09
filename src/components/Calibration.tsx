import type { CalibrationBin } from "@/engine/picks";
import { pct } from "@/lib/format";

const SIZE = 260;
const PAD = { l: 40, r: 22, t: 12, b: 36 };

/** Your stated confidence against how often you were right. Dots below the diagonal mean overconfidence. */
export function Calibration({ bins }: { bins: CalibrationBin[] }) {
  if (bins.length === 0) return null;
  const x = (c: number) => PAD.l + ((c - 0.5) / 0.5) * (SIZE - PAD.l - PAD.r);
  const y = (r: number) => PAD.t + (1 - r) * (SIZE - PAD.t - PAD.b);

  return (
    <figure>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-auto w-full max-w-xs" role="img" aria-label="Your confidence against your hit rate">
        {[0, 0.5, 1].map((r) => (
          <g key={r}>
            <line x1={PAD.l} x2={SIZE - PAD.r} y1={y(r)} y2={y(r)} stroke="var(--rule)" />
            <text x={PAD.l - 6} y={y(r) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {pct(r)}
            </text>
          </g>
        ))}
        {[0.5, 0.75, 1].map((c) => (
          <text key={c} x={x(c)} y={SIZE - PAD.b + 16} textAnchor="middle" fontSize={11} fill="var(--muted)">
            {pct(c)}
          </text>
        ))}
        <text x={(PAD.l + SIZE - PAD.r) / 2} y={SIZE - 4} textAnchor="middle" fontSize={11} fill="var(--ink-2)">
          Your confidence
        </text>
        <line x1={x(0.5)} y1={y(0.5)} x2={x(1)} y2={y(1)} stroke="var(--rule-strong)" strokeDasharray="3 3" />
        <text x={x(0.72)} y={y(0.8)} fontSize={11} fill="var(--muted)" textAnchor="end">
          Well calibrated
        </text>
        {bins.map((b) => (
          <circle key={b.from} cx={x(b.meanConfidence)} cy={y(b.hitRate)} r={5} fill="var(--sharp)" stroke="var(--paper)" strokeWidth={2}>
            <title>{`${pct(b.from)}–${pct(b.to)} confidence: right ${pct(b.hitRate)} of ${b.n} picks`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="sr-only">
        {bins.map((b) => `${pct(b.from)} to ${pct(b.to)} confidence: right ${pct(b.hitRate)} of ${b.n} picks.`).join(" ")}
      </figcaption>
      <table className="mt-3 w-full max-w-xs text-sm">
        <thead>
          <tr className="border-b border-rule text-left text-ink-2">
            <th className="py-1 pr-3 font-normal">Confidence</th>
            <th className="py-1 pr-3 text-right font-normal">Hit rate</th>
            <th className="py-1 text-right font-normal">Picks</th>
          </tr>
        </thead>
        <tbody>
          {bins.map((b) => (
            <tr key={b.from} className="border-b border-rule">
              <td className="py-1 pr-3">
                {pct(b.from)}–{pct(b.to)}
              </td>
              <td className="py-1 pr-3 text-right">{pct(b.hitRate)}</td>
              <td className="py-1 text-right">{b.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
