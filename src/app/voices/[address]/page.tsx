import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CredibilitySpark } from "@/components/CredibilitySpark";
import { CredibilityTrack } from "@/components/CredibilityTrack";
import { getReadyDb } from "@/lib/db/ready";
import { GROUP_LABEL, pct, pts, shortAddress, shortDate, signedUsd, usd, walrusBlobUrl } from "@/lib/format";
import { getVoiceView } from "@/lib/queries";

function betResult(curPrice: number) {
  if (curPrice >= 0.99) return { text: "Won", cls: "text-won" };
  if (curPrice <= 0.01) return { text: "Lost", cls: "text-lost" };
  return { text: "Split", cls: "text-ink-2" };
}

async function Voice({ params }: { params: PageProps<"/voices/[address]">["params"] }) {
  await connection();
  const view = await getVoiceView(await getReadyDb(), decodeURIComponent((await params).address));
  if (!view) notFound();

  const top = view.scores.find((s) => s.group !== "OVERALL") ?? view.scores[0];
  const spark = top ? view.history.filter((h) => h.group === top.group) : [];

  return (
    <article className="pt-8">
      <p className="text-sm text-muted">
        <Link href="/voices" className="hover:text-ink">
          Voices
        </Link>
      </p>
      <h1 className="mt-2 break-words text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{view.name ?? shortAddress(view.address)}</h1>
      <p className="mt-2 break-all text-sm text-ink-2">
        <a href={`https://polymarket.com/profile/${view.address}`} target="_blank" rel="noreferrer" className="underline decoration-rule-strong hover:text-ink">
          {view.address}
        </a>
      </p>

      <section className="mt-10">
        <h2 className="mb-4 text-xl font-semibold">Credibility by category</h2>
        {view.scores.length === 0 ? (
          <p className="max-w-prose text-sm text-ink-2">Credence knows this wallet holds positions, but hasn&apos;t scored its history yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <caption className="sr-only">Credibility for each category</caption>
              <thead>
                <tr className="border-b border-rule text-left text-ink-2">
                  <th className="py-2 pr-4 font-normal">Category</th>
                  <th className="w-48 py-2 pr-4 font-normal">Credibility</th>
                  <th className="py-2 pr-4 text-right font-normal">Settled bets</th>
                  <th className="py-2 pr-4 text-right font-normal">Edge per bet</th>
                  <th className="py-2 text-right font-normal">Profit</th>
                </tr>
              </thead>
              <tbody>
                {view.scores.map((s) => (
                  <tr key={s.group} className="border-b border-rule">
                    <td className="py-2 pr-4 font-medium">{GROUP_LABEL[s.group] ?? s.group}</td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-3">
                        <span className="w-6 text-right font-semibold">{Math.round(s.credibility)}</span>
                        <CredibilityTrack value={s.credibility} />
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-right">{s.n}</td>
                    <td className="py-2 pr-4 text-right">{s.volume > 0 ? `${pts(s.edge)} pts` : "–"}</td>
                    <td className="py-2 text-right">{s.volume > 0 ? signedUsd(s.pnl) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {top && (
          <div className="mt-6">
            <CredibilitySpark label={GROUP_LABEL[top.group] ?? top.group} points={spark} />
          </div>
        )}
      </section>

      <section className="mt-12">
        <h2 className="mb-1 text-xl font-semibold">What Credence remembers about this wallet</h2>
        <p className="mb-4 text-sm text-muted">Each entry is a memory written to Walrus when this wallet&apos;s record changed.</p>
        {view.receipts.length === 0 ? (
          <p className="text-sm text-ink-2">Nothing yet. A memory is written when a wallet proves itself in a category, or when its credibility moves by 5 points or more.</p>
        ) : (
          <ul className="space-y-4">
            {view.receipts.map((m) => (
              <li key={m.id} className="max-w-prose text-sm leading-relaxed">
                <p>{m.human}</p>
                <p className="text-muted">
                  {shortDate(m.createdAt)},{" "}
                  {m.blobId ? (
                    <a href={walrusBlobUrl(m.blobId)} target="_blank" rel="noreferrer" className="underline decoration-rule-strong hover:text-ink">
                      Walrus blob {m.blobId.slice(0, 10)}…
                    </a>
                  ) : (
                    "on its way to Walrus"
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <h2 className="mb-1 text-xl font-semibold">Recent settled bets</h2>
        <p className="mb-4 text-sm text-muted">
          Showing {view.bets.length} of {view.betCount}. Credibility compares the price paid with how the bet resolved.
        </p>
        {view.bets.length === 0 ? (
          <p className="text-sm text-ink-2">No settled bets read yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-sm">
              <caption className="sr-only">Recent settled bets</caption>
              <thead>
                <tr className="border-b border-rule text-left text-ink-2">
                  <th className="py-2 pr-4 font-normal">Market</th>
                  <th className="py-2 pr-4 font-normal">Bought</th>
                  <th className="py-2 pr-4 text-right font-normal">Paid</th>
                  <th className="py-2 pr-4 font-normal">Result</th>
                  <th className="py-2 pr-4 text-right font-normal">Staked</th>
                  <th className="py-2 pr-4 text-right font-normal">Profit</th>
                  <th className="py-2 text-right font-normal">Settled</th>
                </tr>
              </thead>
              <tbody>
                {view.bets.map((b) => {
                  const result = betResult(b.curPrice);
                  return (
                    <tr key={`${b.conditionId}-${b.outcomeIndex}`} className="border-b border-rule">
                      <td className="py-2 pr-4">{b.title ?? b.conditionId}</td>
                      <td className="py-2 pr-4">{b.outcome ?? "–"}</td>
                      <td className="py-2 pr-4 text-right">{pct(b.avgPrice)}</td>
                      <td className={`py-2 pr-4 font-medium ${result.cls}`}>{result.text}</td>
                      <td className="py-2 pr-4 text-right">{usd(b.totalBought)}</td>
                      <td className="py-2 pr-4 text-right">{signedUsd(b.realizedPnl)}</td>
                      <td className="whitespace-nowrap py-2 text-right">{shortDate(b.settledAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </article>
  );
}

export default function VoicePage(props: PageProps<"/voices/[address]">) {
  return (
    <Suspense fallback={<p className="pt-10 text-muted">Loading voice…</p>}>
      <Voice params={props.params} />
    </Suspense>
  );
}
