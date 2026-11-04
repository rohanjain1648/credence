"use client";

import { useEffect, useState } from "react";

type Hit = { blobId: string; createdAt?: string; kind: string | null; human: string };

/** Past lessons Credence remembers that resemble this market, recalled from Walrus Memory. */
export function DejaVu({ question }: { question: string }) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "off" | "error"; hits: Hit[] }>({ status: "loading", hits: [] });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/memory/recall?ns=lessons&q=${encodeURIComponent(question)}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        if (body.configured === false) setState({ status: "off", hits: [] });
        else setState({ status: body.error ? "error" : "ready", hits: body.hits ?? [] });
      })
      .catch(() => !cancelled && setState({ status: "error", hits: [] }));
    return () => {
      cancelled = true;
    };
  }, [question]);

  if (state.status === "loading") return <p className="text-sm text-muted">Recalling similar markets…</p>;
  if (state.status === "off") return <p className="text-sm text-muted">Connect Walrus Memory to recall similar past markets.</p>;
  if (state.status === "error") return <p className="text-sm text-muted">Memory recall failed. It will retry on the next visit.</p>;
  if (state.hits.length === 0) return <p className="text-sm text-muted">Nothing similar has resolved yet. Lessons appear here as markets settle.</p>;
  return (
    <ul className="space-y-3">
      {state.hits.map((h) => (
        <li key={h.blobId} className="text-sm leading-relaxed">
          <p>{h.human}</p>
          <a href={`https://walruscan.com/mainnet/blob/${h.blobId}`} target="_blank" rel="noreferrer" className="text-muted underline decoration-rule-strong hover:text-ink">
            Walrus blob {h.blobId.slice(0, 10)}…
          </a>
        </li>
      ))}
    </ul>
  );
}
