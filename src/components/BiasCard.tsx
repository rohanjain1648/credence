import type { BiasReport } from "@/engine/picks";
import { GROUP_LABEL, pct, pts } from "@/lib/format";

/** What your settled picks say about how you forecast, in plain terms. */
export function BiasCard({ bias }: { bias: BiasReport }) {
  if (bias.n === 0) return null;
  const groups = Object.entries(bias.byGroup) as Array<[string, { n: number; edge: number }]>;
  const over = Math.round(bias.overconfidence * 100);

  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-ink-2">Hit rate</dt>
          <dd className="text-2xl font-bold">{pct(bias.hitRate)}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-2">{over >= 0 ? "Overconfidence" : "Underconfidence"}</dt>
          <dd className="text-2xl font-bold">{Math.abs(over)} pts</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-2">Average market price of your picks</dt>
          <dd className="text-2xl font-bold">{pct(bias.favoriteLean)}</dd>
        </div>
      </dl>
      <table className="mt-5 w-full max-w-md text-sm">
        <caption className="sr-only">Your edge against the market by category</caption>
        <thead>
          <tr className="border-b border-rule text-left text-ink-2">
            <th className="py-1 pr-3 font-normal">Category</th>
            <th className="py-1 pr-3 text-right font-normal">Picks</th>
            <th className="py-1 text-right font-normal">Edge vs market</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([group, g]) => (
            <tr key={group} className="border-b border-rule">
              <td className="py-1 pr-3">{GROUP_LABEL[group] ?? group}</td>
              <td className="py-1 pr-3 text-right">{g.n}</td>
              <td className="py-1 text-right">{pts(g.edge)} pts</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
