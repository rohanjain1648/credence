import { getMemory } from "@/lib/memory/client";
import { NS } from "@/lib/memory/namespaces";
import { recallDecoded } from "@/lib/memory/reader";

const NAMESPACES = { lessons: NS.lessons, calls: NS.calls, voices: NS.voices } as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ns = NAMESPACES[url.searchParams.get("ns") as keyof typeof NAMESPACES];
  const q = url.searchParams.get("q")?.slice(0, 300);
  if (!ns || !q) return Response.json({ error: "ns and q are required" }, { status: 400 });
  const memory = getMemory();
  if (!memory) return Response.json({ configured: false, hits: [] });
  try {
    const hits = await recallDecoded(memory, { namespace: ns, query: q, limit: 5 });
    return Response.json({ configured: true, hits: hits.map(({ blobId, createdAt, distance, kind, human }) => ({ blobId, createdAt, distance, kind, human })) });
  } catch (err) {
    return Response.json({ configured: true, hits: [], error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
