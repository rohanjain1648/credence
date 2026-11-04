export type MemoryKind = "dossier" | "call" | "lesson" | "checkpoint" | "pick" | "scorecard" | "preference";

const MARKER = "\n§credence/v1 ";
export const MAX_MEMORY_CHARS = 12_000;

/**
 * A memory is a human sentence (what semantic recall embeds) followed by a
 * machine-readable payload, so one Walrus blob serves both the reader and the app.
 */
export function encodeMemory(kind: MemoryKind, human: string, data: unknown): string {
  const text = `${human}${MARKER}${JSON.stringify({ kind, data })}`;
  if (text.length > MAX_MEMORY_CHARS) {
    throw new Error(`Memory too long (${text.length} > ${MAX_MEMORY_CHARS} chars)`);
  }
  return text;
}

export function decodeMemory(text: string): { kind: MemoryKind; human: string; data: unknown } | null {
  const at = text.lastIndexOf(MARKER);
  if (at < 0) return null;
  try {
    const payload = JSON.parse(text.slice(at + MARKER.length)) as { kind?: MemoryKind; data?: unknown };
    if (!payload.kind) return null;
    return { kind: payload.kind, human: text.slice(0, at), data: payload.data ?? null };
  } catch {
    return null;
  }
}
