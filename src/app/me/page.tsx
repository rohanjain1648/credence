import { cookies } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { BiasCard } from "@/components/BiasCard";
import { Calibration } from "@/components/Calibration";
import { getReadyDb } from "@/lib/db/ready";
import { closesIn, pct, pts, shortDate, walrusBlobUrl } from "@/lib/format";
import { getMeView, type MeView } from "@/lib/queries";

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function HandleForm({ value = "" }: { value?: string }) {
  return (
    <form action="/me" method="get" className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="text-sm text-ink-2">Your handle</span>
        <input name="handle" defaultValue={value} required placeholder="ravi" className="mt-1 block w-56 rounded-md border border-rule-strong bg-surface px-3 py-2" />
      </label>
      <button type="submit" className="rounded-md border border-ink px-4 py-2 font-medium">
        Show picks
      </button>
    </form>
  );
}

function MemoryLink({ pick }: { pick: MeView["open"][number] }) {
  if (pick.blobId) {
    return (
      <a href={walrusBlobUrl(pick.blobId)} target="_blank" rel="noreferrer" className="underline decoration-rule-strong hover:text-ink">
        Walrus blob {pick.blobId.slice(0, 10)}…
      </a>
    );
  }
  return <>on its way to Walrus</>;
}

async function Journal({ searchParams }: { searchParams: PageProps<"/me">["searchParams"] }) {
  await connection();
  const fromUrl = (await searchParams).handle;
  const handle = (typeof fromUrl === "string" ? fromUrl : undefined) ?? (await cookies()).get("credence_handle")?.value;

  if (!handle) {
    return (
      <div className="pt-10">
        <h1 className="text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">My picks</h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-2">Enter your handle to see your picks, or log your first one from any open market on the Radar.</p>
        <div className="mt-6">
          <HandleForm />
        </div>
      </div>
    );
  }

  const view = await getMeView(await getReadyDb(), handle);
  const now = Date.now();
  const empty = view.open.length === 0 && view.settled.length === 0;

  return (
    <div className="pt-10">
      <h1 className="break-words text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">@{view.handle}</h1>
      {empty ? (
        <div className="mt-4 max-w-2xl">
          <p className="text-lg text-ink-2">
            No picks logged under this handle yet. Open any market on the{" "}
            <Link href="/" className="underline decoration-rule-strong hover:text-ink">
              Radar
            </Link>{" "}
            and log your first one before it closes.
          </p>
          <div className="mt-6">
            <HandleForm value={view.handle} />
          </div>
        </div>
      ) : (
        <>
          <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
            <div>
              <dt className="text-sm text-ink-2">Open picks</dt>
              <dd className="text-3xl font-bold">{view.open.length}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-2">Settled picks</dt>
              <dd className="text-3xl font-bold">{view.settled.length}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-2">Your credibility</dt>
              <dd className="text-3xl font-bold text-sharp">{view.score ? Math.round(view.score.credibility) : "–"}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-2">Your Brier vs the market&apos;s</dt>
              <dd className="text-3xl font-bold">
                {view.settled.length
                  ? `${mean(view.settled.map((p) => p.brierUser ?? 0)).toFixed(2)} vs ${mean(view.settled.map((p) => p.brierMarket ?? 0)).toFixed(2)}`
                  : "–"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 max-w-prose text-sm text-muted">Credibility uses the same formula as the wallets, and 50 means no evidence yet. A lower Brier score means better forecasts.</p>

          <section className="mt-12">
            <h2 className="mb-4 text-xl font-semibold">Open</h2>
            {view.open.length === 0 ? (
              <p className="text-sm text-ink-2">Nothing open right now.</p>
            ) : (
              <ul className="border-t border-rule">
                {view.open.map((p) => (
                  <li key={p.id} className="border-b border-rule py-3">
                    <Link href={`/market/${encodeURIComponent(p.marketId)}`} className="font-medium hover:underline">
                      {p.question}
                    </Link>
                    <p className="mt-1 text-sm text-ink-2">
                      You picked {p.outcomeName} at {pct(p.confidence)}, when the market said {pct(p.priceAtPick)}. {closesIn(p.closeTime, now)}.
                    </p>
                    {p.reason && <p className="mt-1 text-sm text-ink-2">Why: {p.reason}</p>}
                    <p className="mt-1 text-sm text-muted">
                      Logged {shortDate(p.createdAt)}, <MemoryLink pick={p} />
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-12">
            <h2 className="mb-4 text-xl font-semibold">Settled</h2>
            {view.settled.length === 0 ? (
              <p className="text-sm text-ink-2">Your scorecard starts when your first pick resolves.</p>
            ) : (
              <ul className="border-t border-rule">
                {view.settled.map((p) => (
                  <li key={p.id} className="border-b border-rule py-3">
                    <Link href={`/market/${encodeURIComponent(p.marketId)}`} className="font-medium hover:underline">
                      {p.question}
                    </Link>
                    <p className="mt-1 text-sm text-ink-2">
                      <span className={`font-semibold ${p.status === "won" ? "text-won" : "text-lost"}`}>{p.status === "won" ? "Won" : "Lost"}</span>. You picked {p.outcomeName} at{" "}
                      {pct(p.confidence)}, when the market said {pct(p.priceAtPick)}. Edge {pts(p.edge)} pts.
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      Logged {shortDate(p.createdAt)}, <MemoryLink pick={p} />
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {view.settled.length > 0 && (
            <section className="mt-12 grid gap-12 lg:grid-cols-[1fr_20rem]">
              <div>
                <h2 className="mb-4 text-xl font-semibold">How you forecast</h2>
                <BiasCard bias={view.bias} />
                <p className="mt-4 max-w-prose text-sm text-muted">After 5 settled picks, Credence warns you when a new pick matches a pattern in your record.</p>
              </div>
              <div>
                <h2 className="mb-4 text-xl font-semibold">Calibration</h2>
                <Calibration bins={view.calibration} />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default function MePage(props: PageProps<"/me">) {
  return (
    <Suspense fallback={<p className="pt-10 text-muted">Loading your picks…</p>}>
      <Journal searchParams={props.searchParams} />
    </Suspense>
  );
}
