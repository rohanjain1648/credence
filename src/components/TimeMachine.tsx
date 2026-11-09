"use client";

import Link from "next/link";
import { useState } from "react";
import { GROUP_LABEL, pct, shortAddress, shortDate } from "@/lib/format";
import type { TimeMachineView } from "@/lib/queries";

/** Drag back through checkpoints to see what Credence believed then, and how today's markets would be priced with it. */
export function TimeMachine({ checkpoints, initial }: { checkpoints: Array<{ seq: number; ts: number }>; initial: TimeMachineView }) {
  const [view, setView] = useState(initial);
  const [position, setPosition] = useState(checkpoints.length - 1);
  const [failed, setFailed] = useState(false);

  async function load(index: number) {
    setPosition(index);
    const res = await fetch(`/api/brain/time-machine?seq=${checkpoints[index].seq}`).catch(() => null);
    if (res?.ok) {
      setView(await res.json());
      setFailed(false);
    } else {
      setFailed(true);
    }
  }

  const lambdas = Object.entries(view.lambda) as Array<[string, number]>;
  return (
    <div>
      {checkpoints.length > 1 && (
        <label className="block max-w-xl">
          <span className="text-sm text-ink-2">
            Checkpoint #{checkpoints[position].seq} of {checkpoints.at(-1)!.seq}, {shortDate(checkpoints[position].ts)}
          </span>
          <input
            type="range"
            min={0}
            max={checkpoints.length - 1}
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
            onPointerUp={(e) => load(Number(e.currentTarget.value))}
            onKeyUp={(e) => load(Number(e.currentTarget.value))}
            className="mt-2 w-full accent-[var(--sharp)]"
          />
        </label>
      )}
      {failed && <p className="mt-2 text-sm text-lost">That checkpoint couldn&apos;t be loaded. Move the slider to try again.</p>}

      <p className="mt-4 max-w-prose text-sm text-ink-2">
        At checkpoint #{view.seq}, Credence had learned from {view.stats.resolved} resolved {view.stats.resolved === 1 ? "market" : "markets"} and remembered {view.voiceCount}{" "}
        {view.voiceCount === 1 ? "voice" : "voices"}.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <div>
          <h3 className="mb-2 font-semibold">Trust in sharp money</h3>
          {lambdas.length === 0 ? (
            <p className="text-sm text-ink-2">Every category was still at the starting 0.25.</p>
          ) : (
            <dl className="text-sm">
              {lambdas.map(([group, lambda]) => (
                <div key={group} className="flex justify-between border-b border-rule py-1">
                  <dt>{GROUP_LABEL[group] ?? group}</dt>
                  <dd className="font-semibold">{lambda.toFixed(2)}</dd>
                </div>
              ))}
            </dl>
          )}
          <h3 className="mb-2 mt-6 font-semibold">Strongest voices</h3>
          {view.voices.length === 0 ? (
            <p className="text-sm text-ink-2">No voices had proved themselves yet.</p>
          ) : (
            <ul className="text-sm">
              {view.voices.map((v) => (
                <li key={`${v.address}-${v.group}`} className="flex justify-between gap-3 border-b border-rule py-1">
                  <Link href={`/voices/${v.address}`} className="truncate hover:underline">
                    {v.name ?? shortAddress(v.address)}
                  </Link>
                  <span className="font-semibold">{Math.round(v.credibility)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 font-semibold">Today&apos;s markets with that memory</h3>
          {view.lines.length === 0 ? (
            <p className="text-sm text-ink-2">No open markets have a Sharp Line right now.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="border-b border-rule text-left text-ink-2">
                    <th className="py-1 pr-3 font-normal">Market</th>
                    <th className="py-1 pr-3 text-right font-normal">Crowd</th>
                    <th className="py-1 pr-3 text-right font-normal">Sharp Line then</th>
                    <th className="py-1 text-right font-normal">Sharp Line now</th>
                  </tr>
                </thead>
                <tbody>
                  {view.lines.map((l) => (
                    <tr key={l.marketId} className="border-b border-rule">
                      <td className="py-1 pr-3">
                        <Link href={`/market/${encodeURIComponent(l.marketId)}`} className="hover:underline">
                          {l.question}
                        </Link>
                      </td>
                      <td className="py-1 pr-3 text-right">{pct(l.priceA)}</td>
                      <td className="py-1 pr-3 text-right font-semibold text-sharp">{pct(l.lineThen)}</td>
                      <td className="py-1 text-right">{pct(l.lineNow)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
