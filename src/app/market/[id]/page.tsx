import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { DejaVu } from "@/components/DejaVu";
import { PickForm } from "@/components/PickForm";
import { PriceChart } from "@/components/PriceChart";
import { ProbabilityTrack, TrackLegend } from "@/components/ProbabilityTrack";
import { SharpBreakdown } from "@/components/SharpBreakdown";
import { createEngineCtx } from "@/engine/ctx";
import { pickWarnings } from "@/engine/picks";
import { ensurePriceHistory } from "@/engine/priceHistory";
import { getReadyDb } from "@/lib/db/ready";
import { closesIn, GROUP_LABEL, pct, pts } from "@/lib/format";
import { getMarketView, getMeView } from "@/lib/queries";

async function MarketBody({ params }: { params: PageProps<"/market/[id]">["params"] }) {
  await connection();
  const id = decodeURIComponent((await params).id);
  const db = await getReadyDb();
  try {
    await ensurePriceHistory(createEngineCtx({ db }), id);
  } catch {
    // The chart falls back to the prices already stored.
  }
  const view = await getMarketView(db, id);
  if (!view) notFound();
  const handle = (await cookies()).get("credence_handle")?.value;
  const record = await getMeView(db, handle ?? "");
  const priceB = view.priceA == null ? null : 1 - view.priceA;

  const [a, b] = view.market.outcomes.map((o) => o.name);
  const line = view.line?.line ?? null;
  const history = view.prices.filter((p) => p.source === "history");
  const crowd = (history.length >= 2 ? history : view.prices)
    .filter((p) => p.prices[0] != null)
    .map((p) => ({ ts: p.ts, value: p.prices[0] as number }));
  const sharp = view.lineHistory.filter((l) => l.line != null).map((l) => ({ ts: l.ts, value: l.line as number }));
  const closed = view.market.resolution != null || (view.market.closeTime ?? Infinity) <= Date.now();

  return (
    <article className="pt-8">
      <p className="text-sm text-muted">
        <Link href={`/?group=${view.group}`} className="hover:text-ink">
          {GROUP_LABEL[view.group] ?? view.group}
        </Link>
        , {view.market.resolution ? `resolved ${view.market.resolution.outcome}` : closesIn(view.market.closeTime, Date.now())}
      </p>
      <h1 className="mt-2 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{view.market.question}</h1>

      <section className="mt-8" aria-label="Where the sources stand">
        <ProbabilityTrack outcomeA={a} crowd={view.priceA} sharp={line} kalshi={view.kalshi?.priceA ?? null} size="hero" />
        <div className="mt-2 flex justify-between text-sm text-muted">
          <span>0% {a}</span>
          <span>100% {a}</span>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
          <div>
            <dt className="text-sm text-ink-2">Crowd</dt>
            <dd className="text-3xl font-bold">{pct(view.priceA)}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-2">Sharp Line</dt>
            <dd className="text-3xl font-bold text-sharp">{pct(line)}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-2">Kalshi</dt>
            <dd className="text-3xl font-bold">{pct(view.kalshi?.priceA)}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-2">Sharp vs crowd</dt>
            <dd className="text-3xl font-bold">{line != null && view.priceA != null ? pts(line - view.priceA) : "–"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-muted">All numbers are the chance of {a}.</p>
        <div className="mt-4">
          <TrackLegend />
        </div>
      </section>

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-12">
          <section>
            <h2 className="mb-4 text-xl font-semibold">Who is behind the Sharp Line</h2>
            <SharpBreakdown view={view} />
          </section>
          <section>
            <h2 className="mb-4 text-xl font-semibold">Price history</h2>
            <PriceChart outcomeA={a} crowd={crowd} sharp={sharp} />
          </section>
          <section>
            <h2 className="mb-4 text-xl font-semibold">Similar markets Credence remembers</h2>
            <DejaVu question={view.market.question} />
          </section>
        </div>
        <aside>
          <h2 className="mb-4 text-xl font-semibold">Log your pick</h2>
          {closed ? (
            <p className="text-sm text-ink-2">This market has closed. Picks are only accepted before close, so every call is on the record in advance.</p>
          ) : (
            <PickForm
              marketId={view.market.id}
              outcomes={[a, b]}
              prices={[view.priceA, priceB]}
              defaultHandle={handle}
              warnings={[pickWarnings(record.bias, view.group, view.priceA ?? 0), pickWarnings(record.bias, view.group, priceB ?? 0)]}
            />
          )}
          {view.picks[0] + view.picks[1] > 0 && (
            <p className="mt-6 text-sm text-ink-2">
              Picks logged so far: {view.picks[0]} on {a}, {view.picks[1]} on {b}.
            </p>
          )}
        </aside>
      </div>
    </article>
  );
}

export default function MarketPage(props: PageProps<"/market/[id]">) {
  return (
    <Suspense fallback={<p className="pt-10 text-muted">Loading market…</p>}>
      <MarketBody params={props.params} />
    </Suspense>
  );
}
