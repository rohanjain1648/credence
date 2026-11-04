import type { MemWalLike } from "./client";
import { decodeMemory, type MemoryKind } from "./format";

export type RecalledMemory = {
  blobId: string;
  createdAt?: string;
  distance: number;
  kind: MemoryKind | null;
  human: string;
  data: unknown;
};

export async function recallDecoded(
  mem: MemWalLike,
  q: { namespace: string; query: string; limit?: number; sort?: "relevance" | "recent" },
): Promise<RecalledMemory[]> {
  const res = await mem.recall({ query: q.query, namespace: q.namespace, limit: q.limit, sort: q.sort });
  return res.results.map((r) => {
    const decoded = decodeMemory(r.text);
    return {
      blobId: r.blob_id,
      createdAt: r.created_at,
      distance: r.distance,
      kind: decoded?.kind ?? null,
      human: decoded?.human ?? r.text,
      data: decoded?.data ?? null,
    };
  });
}
