import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { FilterPills } from "@/components/FilterPills";
import { MarketRow } from "@/components/MarketRow";
import { TrackLegend } from "@/components/ProbabilityTrack";
import { getReadyDb } from "@/lib/db/ready";
import { getHeaderStats, getRadar, type RadarRow } from "@/lib/queries";
import type { Group } from "@/lib/scoring/categorize";

const FILTERS: Array<{ group?: Group; label: string }> = [
  { label: "All" },
  { group: "SPORTS", label: "Sports" },
  { group: "POLITICS", label: "Politics" },
  { group: "CULTURE", label: "Culture" },
  { group: "CRYPTO", label: "Crypto" },
];

const DAY = 86_400_000;

function Section({ title, rows, now }: { title: string; rows: RadarRow[]; now: number }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="flex items-baseline gap-3 border-b border-rule-strong pb-2 text-sm font-semibold text-ink">
        {title}
        <span className="font-normal text-muted">{rows.length}</span>
      </h2>
      <ul>
        {rows.map((r) => (
          <MarketRow key={r.market.id} row={r} now={now} />
        ))}
      </ul>
    </section>
  );
}

async function RadarList({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  const params = await searchParams;
  const group = FILTERS.find((f) => f.group === params.group)?.group;
  const includeLongShots = params.all === "1";
  const now = Date.now();
  const db = await getReadyDb();
  const [rows, stats] = await Promise.all([getRadar(db, { group, limit: 60, now, includeLongShots }), getHeaderStats(db)]);

  const withLine = rows.filter((r) => r.line != null).length;
  const withSignal = rows.some((r) => r.line != null || r.kalshiA != null);
  const disagreeing = rows.filter((r) => r.sharpGap != null || r.venueGap != null);
  const rest = rows.filter((r) => r.sharpGap == null && r.venueGap == null);
  const soon = rest.filter((r) => (r.closeTime ?? Infinity) - now < DAY);
  const later = rest.filter((r) => (r.closeTime ?? Infinity) - now >= DAY);

  const href = (g: Group | undefined, all: boolean) => {
    const q = new URLSearchParams();
    if (g) q.set("group", g);
    if (all) q.set("all", "1");
    return q.size ? `/?${q}` : "/";
  };

  return (
    <>
      <p className="mt-6 max-w-2xl border-l-2 border-sharp pl-3 text-sm text-ink-2">
        {withLine > 0
          ? `${withLine} of ${rows.length} markets have a Sharp Line, built from ${stats.voices} scored traders.`
          : `Watching ${rows.length} markets. Sharp Lines appear once traders' records are scored, and wallet data is unavailable right now, so these show the crowd's prices only.`}
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <FilterPills label="Category" pills={FILTERS.map((f) => ({ href: href(f.group, includeLongShots), label: f.label, active: f.group === group }))} />
        <Link href={href(group, !includeLongShots)} className="text-sm text-ink-2 underline decoration-rule-strong underline-offset-4 hover:text-ink">
          {includeLongShots ? "Hide long shots" : "Include long shots"}
        </Link>
      </div>

      {withSignal && (
        <div className="mt-6">
          <TrackLegend />
        </div>
      )}

      {rows.length === 0 ? (
        <p className="mt-10 max-w-prose text-ink-2">
          No open markets here. Try another category, or run <code className="text-ink">npm run worker</code> to pull the latest markets from Tatum.
        </p>
      ) : (
        <>
          <Section title="Where credible money disagrees" rows={disagreeing} now={now} />
          <Section title="Closing in the next 24 hours" rows={soon} now={now} />
          <Section title="Closing in 1 to 3 days" rows={later} now={now} />
        </>
      )}
    </>
  );
}

export default function RadarPage(props: PageProps<"/">) {
  return (
    <div className="pt-10">
      <h1 className="max-w-2xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">Prices, checked against the traders who are usually right</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-2">
        Credence scores every Polymarket trader on whether they beat the price they paid. The Sharp Line is the crowd&apos;s price, pulled toward where those traders have their money.
      </p>
      <Suspense fallback={<p className="mt-10 text-muted">Loading markets…</p>}>
        <RadarList searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
