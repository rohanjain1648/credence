"use client";

import { useState } from "react";

type Props = {
  marketId: string;
  outcomes: [string, string];
  prices: [number | null, number | null];
  defaultHandle?: string;
  /** What your own record says about each outcome, because some warnings depend on the outcome's price. */
  warnings?: [string[], string[]];
};

const MESSAGES: Record<string, string> = {
  MARKET_CLOSED: "This market has closed, so new picks can't be logged.",
  BAD_CONFIDENCE: "Set your confidence between 50% and 99%.",
  BAD_HANDLE: "Use 3–20 letters, numbers or underscores for your handle.",
  NO_PRICE: "This market has no current price, so a pick can't be scored yet.",
  MARKET_NOT_FOUND: "This market is no longer tracked.",
  BAD_REQUEST: "Something in the form is missing.",
};

export function PickForm({ marketId, outcomes, prices, defaultHandle = "", warnings = [[], []] }: Props) {
  const [handle, setHandle] = useState(defaultHandle);
  const [outcomeIndex, setOutcomeIndex] = useState<0 | 1>(0);
  const [confidence, setConfidence] = useState(65);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "saving" | "done" | "error"; text?: string }>({ kind: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "saving" });
    const res = await fetch("/api/picks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle, marketId, outcomeIndex, confidence: confidence / 100, reason: reason || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setState({ kind: "done", text: `Pick logged. It is queued for Walrus Memory and will be scored when the market resolves.` });
    else setState({ kind: "error", text: MESSAGES[body.code] ?? "The pick could not be logged. Try again." });
  }

  const market = prices[outcomeIndex];
  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm text-ink-2">Your pick</legend>
        <div className="flex flex-wrap gap-2">
          {outcomes.map((name, i) => (
            <label key={name} className={`cursor-pointer rounded-md border px-4 py-2 ${outcomeIndex === i ? "border-ink bg-ink text-paper" : "border-rule-strong"}`}>
              <input type="radio" name="outcome" className="sr-only" checked={outcomeIndex === i} onChange={() => setOutcomeIndex(i as 0 | 1)} />
              {name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="text-sm text-ink-2">
          How sure are you? <span className="font-semibold text-ink">{confidence}%</span>
          {market != null && <span className="text-muted"> (market says {Math.round(market * 100)}%)</span>}
        </span>
        <input type="range" min={50} max={99} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} className="mt-2 w-full accent-[var(--sharp)]" />
      </label>
      <label className="block">
        <span className="text-sm text-ink-2">Why (optional, remembered with your pick)</span>
        <input value={reason} maxLength={280} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-md border border-rule-strong bg-surface px-3 py-2" />
      </label>
      <label className="block">
        <span className="text-sm text-ink-2">Handle</span>
        <input value={handle} required onChange={(e) => setHandle(e.target.value)} placeholder="ravi" className="mt-1 w-full rounded-md border border-rule-strong bg-surface px-3 py-2" />
      </label>
      {warnings[outcomeIndex].length > 0 && (
        <div className="rounded-md border border-rule-strong bg-surface p-3 text-sm">
          <p className="font-medium">From your record</p>
          <ul className="mt-1 space-y-1 text-ink-2">
            {warnings[outcomeIndex].map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <button type="submit" disabled={state.kind === "saving"} className="rounded-md bg-sharp px-5 py-2.5 font-semibold text-white disabled:opacity-60">
        {state.kind === "saving" ? "Logging pick…" : "Log pick"}
      </button>
      <p role="status" className={`text-sm ${state.kind === "error" ? "text-lost" : "text-ink-2"}`}>
        {state.text}
      </p>
    </form>
  );
}
