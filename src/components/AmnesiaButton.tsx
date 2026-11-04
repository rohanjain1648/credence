"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RestoreReport } from "@/engine/checkpoint";
import { walrusBlobUrl } from "@/lib/format";

const MESSAGES: Record<string, string> = {
  NO_CHECKPOINT: "There's no checkpoint on Walrus yet, so nothing was wiped. Checkpoints are written after markets resolve.",
  NO_MEMORY: "Walrus Memory isn't connected, so nothing was wiped. Add its keys to .env.local.",
  DISABLED: "This demo is turned off. Set AMNESIA_ENABLED=true to turn it on.",
  RECALL_FAILED: "Walrus didn't answer, so nothing was wiped. Try again in a moment.",
};

export function AmnesiaButton({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<{ kind: "idle" | "running" | "done" | "error"; report?: RestoreReport; error?: string }>({ kind: "idle" });

  async function run() {
    setState({ kind: "running" });
    const res = await fetch("/api/brain/amnesia", { method: "POST" }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (res?.ok) {
      setState({ kind: "done", report: body });
      router.refresh();
    } else {
      setState({ kind: "error", error: MESSAGES[body?.code] ?? MESSAGES.RECALL_FAILED });
    }
  }

  if (!enabled) return <p className="text-sm text-muted">This demo is turned off here.</p>;

  const { report } = state;
  return (
    <div>
      <button type="button" onClick={run} disabled={state.kind === "running"} className="rounded-md bg-sharp px-5 py-2.5 font-semibold text-white disabled:opacity-60">
        {state.kind === "running" ? "Wiping and restoring…" : "Wipe and restore from Walrus"}
      </button>
      <div role="status" className="mt-4 max-w-prose">
        {state.kind === "error" && <p className="text-sm text-lost">{state.error}</p>}
        {report && (
          <p className="text-sm leading-relaxed">
            Restored checkpoint #{report.checkpointSeq} in {(report.ms / 1000).toFixed(1)} s: {report.voicesRestored} voices and λ for {Object.keys(report.lambdas).length}{" "}
            {Object.keys(report.lambdas).length === 1 ? "category" : "categories"}, from{" "}
            <a href={walrusBlobUrl(report.blobId)} target="_blank" rel="noreferrer" className="underline decoration-rule-strong hover:text-ink">
              Walrus blob {report.blobId.slice(0, 10)}…
            </a>
            . The account holds {report.memoriesOnWalrus} memories.
          </p>
        )}
      </div>
    </div>
  );
}
