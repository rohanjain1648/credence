import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { kv } from "@/lib/db/schema";
import { latestCheckpoint } from "./client";

export type MemoryProof = {
  accountId: string;
  type: string;
  owner: string;
  delegateKeyCount: number;
  active: boolean;
  createdAtMs: number | null;
  checkpoint: string;
  verifiedAt: number;
  memoriesOnWalrus?: number;
};

const CACHE_KEY = "suiMemoryProof";
const CACHE_MS = 10 * 60_000;

export function parseMemWalAccount(content: unknown): Pick<MemoryProof, "owner" | "delegateKeyCount" | "active" | "createdAtMs"> {
  const c = content as { owner?: unknown; active?: unknown; delegate_keys?: unknown; created_at?: unknown } | null;
  if (typeof c?.owner !== "string" || typeof c.active !== "boolean") throw new Error("Not a Walrus Memory account object");
  const created = c.created_at == null ? NaN : Number(c.created_at);
  return {
    owner: c.owner,
    delegateKeyCount: Array.isArray(c.delegate_keys) ? c.delegate_keys.length : 0,
    active: c.active,
    createdAtMs: Number.isFinite(created) ? created : null,
  };
}

/** Reads the memory account directly from Sui, through Tatum's gateway, at a named checkpoint. */
export async function getMemoryAccountProof(client: SuiGraphQLClient, accountId: string, now: () => number = Date.now): Promise<MemoryProof> {
  const [{ object }, checkpoint] = await Promise.all([client.core.getObject({ objectId: accountId, include: { json: true } }), latestCheckpoint(client)]);
  return { accountId, type: object.type, ...parseMemWalAccount(object.json), checkpoint: String(checkpoint), verifiedAt: now() };
}

/** Page views reuse a recent read, so a busy page can't exhaust Tatum's request limit. */
export async function cachedMemoryProof(db: Db, now: number, fetchProof: () => Promise<MemoryProof>): Promise<MemoryProof> {
  const [row] = await db.select().from(kv).where(eq(kv.key, CACHE_KEY));
  if (row) {
    const cached = JSON.parse(row.value) as { at: number; proof: MemoryProof };
    if (now - cached.at < CACHE_MS) return cached.proof;
  }
  const proof = await fetchProof();
  const value = JSON.stringify({ at: now, proof });
  await db.insert(kv).values({ key: CACHE_KEY, value }).onConflictDoUpdate({ target: kv.key, set: { value } });
  return proof;
}
