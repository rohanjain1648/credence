import { shortDate, walrusBlobUrl } from "@/lib/format";
import type { BrainView } from "@/lib/queries";

const NAMESPACE_LABEL: Record<string, string> = {
  "credence-voices": "Voice dossier",
  "credence-calls": "Call",
  "credence-lessons": "Lesson",
  "credence-checkpoints": "Checkpoint",
};

const kindLabel = (namespace: string, kind: string) => NAMESPACE_LABEL[namespace] ?? (kind === "scorecard" ? "Pick scorecard" : "Pick");

function Where({ memory }: { memory: BrainView["feed"][number] }) {
  if (memory.blobId) {
    return (
      <a href={walrusBlobUrl(memory.blobId)} target="_blank" rel="noreferrer" className="underline decoration-rule-strong hover:text-ink">
        Walrus blob {memory.blobId.slice(0, 10)}…
      </a>
    );
  }
  if (memory.status === "failed") return <span className="text-lost">Not stored: {memory.error ?? "upload failed"}</span>;
  return <>{memory.status === "sent" ? "Uploading to Walrus" : "Waiting to send"}</>;
}

export function MemoryFeed({ feed }: { feed: BrainView["feed"] }) {
  return (
    <ul className="border-t border-rule">
      {feed.map((m) => (
        <li key={m.id} className="grid gap-x-6 gap-y-1 border-b border-rule py-3 sm:grid-cols-[8rem_1fr]">
          <p className="text-sm text-muted">
            {kindLabel(m.namespace, m.kind)}
            <br className="hidden sm:block" /> <span className="sm:hidden">, </span>
            {shortDate(m.createdAt)}
          </p>
          <div className="min-w-0 text-sm leading-relaxed">
            <p className="max-w-prose break-words">{m.human}</p>
            {m.effect && <p className="font-medium text-sharp">{m.effect}</p>}
            <p className="break-words text-muted">
              <Where memory={m} />
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
