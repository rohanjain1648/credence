import { connection } from "next/server";
import { Suspense } from "react";
import { FilterPills } from "@/components/FilterPills";
import { MarketRow } from "@/components/MarketRow";
import { TrackLegend } from "@/components/ProbabilityTrack";
import { getReadyDb } from "@/lib/db/ready";
import { getRadar } from "@/lib/queries";
import type { Group } from "@/lib/scoring/categorize";

const FILTERS: Array<{ group?: Group; label: string }> = [
  { label: "All" },
  { group: "SPORTS", label: "Sports" },
  { group: "POLITICS", label: "Politics" },
  { group: "CULTURE", label: "Culture" },
  { group: "CRYPTO", label: "Crypto" },
];

async function RadarList({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  const raw = (await searchParams).group;
  const group = FILTERS.find((f) => f.group === raw)?.group;
  const now = Date.now();
  const rows = await getRadar(await getReadyDb(), { group, limit: 40, now });

  return (
    <>
      <div className="mt-8">
        <FilterPills label="Category" pills={FILTERS.map((f) => ({ href: f.group ? `/?group=${f.group}` : "/", label: f.label, active: f.group === group }))} />
      </div>
      {rows.length === 0 ? (
        <p className="mt-10 max-w-prose text-ink-2">
          No open markets yet. Run <code className="text-ink">npm run worker</code> to pull live markets from Tatum, or
          load the demo database.
        </p>
      ) : (
        <ul className="mt-4 border-t border-rule">
          {rows.map((r) => (
            <MarketRow key={r.market.id} row={r} now={now} />
          ))}
        </ul>
      )}
    </>
  );
}

export default function RadarPage(props: PageProps<"/">) {
  return (
    <div className="pt-10">
      <h1 className="max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
        Where the traders who are usually right disagree with the crowd
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-2">
        Credence remembers every Polymarket trader&apos;s record and weighs open positions by how often each one beat the
        price they paid. The Sharp Line is the crowd price pulled toward that credible money.
      </p>
      <div className="mt-6">
        <TrackLegend />
      </div>
      <Suspense fallback={<p className="mt-10 text-muted">Loading markets…</p>}>
        <RadarList searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
