import Link from "next/link";
import { pct, shortAddress, usd } from "@/lib/format";
import type { MarketView } from "@/lib/queries";
import { holderWeight } from "@/lib/scoring/sharpLine";

/** Who holds each side, and how much each holder's record counts toward the Sharp Line. */
export function SharpBreakdown({ view }: { view: MarketView }) {
  const outcomes = view.market.outcomes.map((o) => o.name);
  const rows = view.holders.slice(0, 20).map((h) => ({ ...h, weight: h.credibility == null ? 0 : holderWeight(h.credibility, h.currentValue) }));
  if (rows.length === 0) return <p className="text-sm text-muted">No holder snapshot yet for this market.</p>;
  const maxWeight = Math.max(...rows.map((r) => r.weight), 0.0001);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">Largest holders with their remembered credibility</caption>
        <thead>
          <tr className="border-b border-rule text-left text-ink-2">
            <th className="py-2 pr-3 font-normal">Holder</th>
            <th className="py-2 pr-3 font-normal">Side</th>
            <th className="py-2 pr-3 text-right font-normal">Position</th>
            <th className="py-2 pr-3 text-right font-normal">Credibility</th>
            <th className="w-32 py-2 font-normal">Counts toward line</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={`${h.address}-${h.outcomeIndex}`} className="border-b border-rule">
              <td className="py-2 pr-3">
                <Link href={`/voices/${h.address}`} className="hover:underline">
                  {h.name ?? shortAddress(h.address)}
                </Link>
              </td>
              <td className="py-2 pr-3">{outcomes[h.outcomeIndex] ?? h.outcomeIndex}</td>
              <td className="py-2 pr-3 text-right">{usd(h.currentValue)}</td>
              <td className="py-2 pr-3 text-right">{h.credibility == null ? <span className="text-muted">unknown</span> : Math.round(h.credibility)}</td>
              <td className="py-2">
                {h.weight > 0 ? (
                  <span className="block h-2 rounded-r-sm bg-sharp" style={{ width: `${(h.weight / maxWeight) * 100}%` }} title={`weight ${h.weight.toFixed(2)}`} />
                ) : (
                  <span className="text-muted">not counted</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.line && (
        <p className="mt-3 text-sm text-ink-2">
          {view.line.consensus == null
            ? "Not enough credible money to form a line."
            : `${pct(view.line.consensus)} of credible weight is on ${outcomes[0]}. With λ ${view.line.lambda.toFixed(2)}, the line moves the crowd ${pct(view.line.priceA)} to ${pct(view.line.line)}.`}
        </p>
      )}
    </div>
  );
}
