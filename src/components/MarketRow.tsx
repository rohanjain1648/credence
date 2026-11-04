import Link from "next/link";
import { closesIn, GROUP_LABEL, pct, pts } from "@/lib/format";
import type { RadarRow } from "@/lib/queries";
import { ProbabilityTrack } from "./ProbabilityTrack";

export function MarketRow({ row, now }: { row: RadarRow; now: number }) {
  const a = row.market.outcomes[0]?.name ?? "Yes";
  const biggest =
    row.sharpGap != null && (row.venueGap == null || Math.abs(row.sharpGap) >= Math.abs(row.venueGap))
      ? { text: `Sharp Line ${pts(row.sharpGap)}`, cls: "text-sharp" }
      : row.venueGap != null
        ? { text: `Kalshi ${pts(row.venueGap)}`, cls: "text-kalshi" }
        : null;

  return (
    <li className="border-b border-rule">
      <Link href={`/market/${encodeURIComponent(row.market.id)}`} className="group grid gap-x-6 gap-y-2 py-4 sm:grid-cols-[1fr_16rem_5.5rem]">
        <div className="min-w-0">
          <p className="font-medium leading-snug group-hover:underline">{row.market.question}</p>
          <p className="mt-1 text-sm text-muted">
            {GROUP_LABEL[row.group] ?? row.group}, {closesIn(row.closeTime, now)}. {a} {pct(row.priceA)} on Polymarket
          </p>
        </div>
        <div className="self-center">
          <ProbabilityTrack outcomeA={a} crowd={row.priceA} sharp={row.line} kalshi={row.kalshiA} />
        </div>
        <p className={`self-center text-sm font-semibold sm:text-right ${biggest?.cls ?? "text-muted"}`}>
          {biggest?.text ?? "in step"}
        </p>
      </Link>
    </li>
  );
}
