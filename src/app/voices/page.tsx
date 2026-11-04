import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CredibilityTrack } from "@/components/CredibilityTrack";
import { FilterPills } from "@/components/FilterPills";
import { SkillVsProfit } from "@/components/SkillVsProfit";
import { getReadyDb } from "@/lib/db/ready";
import { GROUP_LABEL, pts, shortAddress, signedUsd, usd } from "@/lib/format";
import { getVoicesBoard } from "@/lib/queries";
import type { Group } from "@/lib/scoring/categorize";
import { MIN_CREDIBILITY } from "@/lib/scoring/sharpLine";

type BoardGroup = Group | "OVERALL";
const GROUPS: BoardGroup[] = ["OVERALL", "SPORTS", "POLITICS", "CULTURE", "CRYPTO", "ECONOMICS", "TECH", "FINANCE"];

async function Board({ searchParams }: { searchParams: PageProps<"/voices">["searchParams"] }) {
  await connection();
  const raw = (await searchParams).group;
  const group = GROUPS.find((g) => g === raw) ?? "OVERALL";
  const rows = await getVoicesBoard(await getReadyDb(), { group, limit: 50 });
  const label = (r: (typeof rows)[number]) => r.name ?? shortAddress(r.address);
  // Rows rebuilt from a checkpoint carry credibility only, until the next rescore fills in the rest.
  const chartable = rows.filter((r) => r.volume > 0).map((r) => ({ address: r.address, label: label(r), credibility: r.credibility, pnl: r.pnl, counts: r.credibility > MIN_CREDIBILITY }));

  return (
    <>
      <div className="mt-8">
        <FilterPills
          label="Category"
          pills={GROUPS.map((g) => ({ href: g === "OVERALL" ? "/voices" : `/voices?group=${g}`, label: GROUP_LABEL[g], active: g === group }))}
        />
      </div>
      {rows.length === 0 ? (
        <p className="mt-10 max-w-prose text-ink-2">
          No wallets have 20 or more settled bets in {GROUP_LABEL[group].toLowerCase()} yet. Wallets appear here once the engine has read their history. Try another
          category, or run <code className="text-ink">npm run worker</code> to keep learning.
        </p>
      ) : (
        <>
          <div className="mt-8">
            <SkillVsProfit voices={chartable} />
          </div>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[38rem] text-sm">
              <caption className="sr-only">Wallets ranked by credibility in {GROUP_LABEL[group]}</caption>
              <thead>
                <tr className="border-b border-rule text-left text-ink-2">
                  <th className="py-2 pr-4 font-normal">Voice</th>
                  <th className="w-40 py-2 pr-4 font-normal">Credibility</th>
                  <th className="py-2 pr-4 text-right font-normal">Settled bets</th>
                  <th className="py-2 pr-4 text-right font-normal">Edge per bet</th>
                  <th className="py-2 pr-4 text-right font-normal">Profit</th>
                  <th className="py-2 text-right font-normal">Volume</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.address} className="border-b border-rule">
                    <td className="py-2 pr-4">
                      <Link href={`/voices/${r.address}`} className="font-medium hover:underline">
                        {label(r)}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-3">
                        <span className="w-6 text-right font-semibold">{Math.round(r.credibility)}</span>
                        <CredibilityTrack value={r.credibility} />
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-right">{r.n}</td>
                    <td className="py-2 pr-4 text-right">{r.volume > 0 ? `${pts(r.edge)} pts` : "–"}</td>
                    <td className="py-2 pr-4 text-right">{r.volume > 0 ? signedUsd(r.pnl) : "–"}</td>
                    <td className="py-2 text-right">{r.volume > 0 ? usd(r.volume) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export default function VoicesPage(props: PageProps<"/voices">) {
  return (
    <div className="pt-10">
      <h1 className="max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">Profit isn&apos;t skill</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-2">
        A big win can come from size or luck. Credence scores each Polymarket wallet on whether it keeps buying at prices that later prove too cheap. Credibility runs from 0
        to 100, and 50 means no evidence yet.
      </p>
      <Suspense fallback={<p className="mt-10 text-muted">Loading voices…</p>}>
        <Board searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
