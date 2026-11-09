import Link from "next/link";
import { GROUP_LABEL, pts } from "@/lib/format";
import type { RadarRow } from "@/lib/queries";
import { ProbabilityTrack } from "./ProbabilityTrack";

const cents = (p: number | null) => (p == null ? "–" : `${Math.round(p * 100)}¢`);

function timeLeft(closeTime: number | null, now: number): { value: string; unit: string } {
  if (closeTime == null) return { value: "–", unit: "" };
  const h = (closeTime - now) / 3_600_000;
  if (h < 1) return { value: String(Math.max(1, Math.round(h * 60))), unit: "min" };
  if (h < 48) return { value: String(Math.round(h)), unit: "hrs" };
  return { value: String(Math.round(h / 24)), unit: "days" };
}

function Price({ name, price, accent }: { name: string; price: number | null; accent?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-1 flex-col items-center justify-center rounded-md border px-2 py-1.5 sm:w-24 sm:flex-none ${accent ? "border-sharp bg-sharp-wash" : "border-rule-strong bg-surface"}`}>
      <span className={`max-w-full truncate text-xs ${accent ? "text-sharp" : "text-muted"}`}>{name}</span>
      <span className={`font-numeric text-2xl font-semibold leading-none tabular-nums ${accent ? "text-sharp" : "text-ink"}`}>{cents(price)}</span>
    </div>
  );
}

/** One market as an odds board line: time left, the question, and each outcome's price in cents. */
export function MarketRow({ row, now }: { row: RadarRow; now: number }) {
  const [a, b] = row.market.outcomes;
  const left = timeLeft(row.closeTime, now);
  const priceB = row.priceA == null ? (b?.price ?? null) : 1 - row.priceA;
  const hasSignal = row.line != null || row.kalshiA != null;
  const meta = [GROUP_LABEL[row.group] && row.group !== "OTHER" ? GROUP_LABEL[row.group] : null, row.siblings > 0 ? `+${row.siblings} more in this event` : null].filter(Boolean);

  return (
    <li className="border-b border-rule">
      <Link
        href={`/market/${encodeURIComponent(row.market.id)}`}
        className="group grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 py-4 hover:bg-surface/60 sm:grid-cols-[4rem_minmax(0,1fr)_auto] sm:items-center"
      >
        <div className="row-span-2 text-center sm:row-span-1" aria-label={`Closes in ${left.value} ${left.unit}`}>
          <div className="font-numeric text-3xl font-semibold leading-none tabular-nums text-ink">{left.value}</div>
          <div className="mt-0.5 text-xs text-muted">{left.unit}</div>
        </div>

        <div className="min-w-0">
          <p className="font-medium leading-snug text-ink group-hover:underline">{row.market.question}</p>
          {meta.length > 0 && <p className="mt-1 text-sm text-muted">{meta.join(" · ")}</p>}
          {hasSignal && (
            <div className="mt-3 flex max-w-sm items-center gap-3">
              <div className="flex-1">
                <ProbabilityTrack outcomeA={a?.name ?? "Yes"} crowd={row.priceA} sharp={row.line} kalshi={row.kalshiA} />
              </div>
              {row.sharpGap != null && <span className="text-sm font-semibold text-sharp tabular-nums">{pts(row.sharpGap)} pts</span>}
            </div>
          )}
        </div>

        <div className="col-start-2 flex gap-2 sm:col-start-auto">
          <Price name={a?.name ?? "Yes"} price={row.priceA} />
          <Price name={b?.name ?? "No"} price={priceB} />
          {row.line != null && <Price name="Sharp" price={row.line} accent />}
        </div>
      </Link>
    </li>
  );
}
