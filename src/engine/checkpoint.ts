import { desc, eq, isNotNull, max } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { ulid } from "ulid";
import { checkpoints, lambdas, memories, voiceScores } from "@/lib/db/schema";
import type { MemWalLike } from "@/lib/memory/client";
import { encodeMemory } from "@/lib/memory/format";
import { NS } from "@/lib/memory/namespaces";
import { recallDecoded } from "@/lib/memory/reader";
import { enqueueMemory } from "@/lib/memory/writer";
import type { Group } from "@/lib/scoring/categorize";
import { learningCurve } from "@/lib/scoring/learning";
import type { EngineCtx } from "./ctx";
import { observationsFor } from "./observations";

export type CheckpointVoice = [address: string, group: string, credibility: number, n: number];
export type CheckpointPayload = {
  seq: number;
  prevBlobId: string | null;
  asOf: number;
  reason: string;
  lambda: Partial<Record<Group, number>>;
  stats: { resolved: number; brierMarket: number | null; brierCredence: number | null };
  voices: CheckpointVoice[];
};

const MAX_VOICES = 100;
const MIN_N = 20;
const MAX_COUNT_PAGES = 50;

export async function latestLambdas(ctx: EngineCtx): Promise<Partial<Record<Group, number>>> {
  const rows = await ctx.db.select().from(lambdas).orderBy(desc(lambdas.asOf));
  const out: Partial<Record<Group, number>> = {};
  for (const r of rows) if (!(r.group in out)) out[r.group as Group] = r.lambda;
  return out;
}

async function strongestVoices(ctx: EngineCtx): Promise<CheckpointVoice[]> {
  const rows = await ctx.db.select().from(voiceScores).orderBy(desc(voiceScores.asOf));
  const latest = new Map<string, CheckpointVoice>();
  for (const r of rows) {
    const key = `${r.voiceId}|${r.group}`;
    if (!latest.has(key)) latest.set(key, [r.voiceId, r.group, Math.round(r.credibility * 10) / 10, r.n]);
  }
  return [...latest.values()]
    .filter((v) => v[3] >= MIN_N)
    .sort((a, b) => b[2] - a[2])
    .slice(0, MAX_VOICES);
}

/** The newest checkpoint whose memory already landed on Walrus, so the chain only links real blobs. */
async function lastStoredBlobId(ctx: EngineCtx): Promise<string | null> {
  const [row] = await ctx.db
    .select({ blobId: memories.blobId })
    .from(checkpoints)
    .innerJoin(memories, eq(memories.id, checkpoints.memoryId))
    .where(isNotNull(memories.blobId))
    .orderBy(desc(checkpoints.seq))
    .limit(1);
  return row?.blobId ?? null;
}

/**
 * Snapshots the whole trust model (λ per category + strongest voices) into one memory.
 * Each checkpoint names the previous checkpoint's blob, forming an audit chain on Walrus.
 */
export async function writeCheckpoint(ctx: EngineCtx, reason: string): Promise<number> {
  const [{ last }] = await ctx.db.select({ last: max(checkpoints.seq) }).from(checkpoints);
  const seq = (last ?? 0) + 1;
  const curve = learningCurve(await observationsFor(ctx.db));
  const end = curve.at(-1);
  const payload: CheckpointPayload = {
    seq,
    prevBlobId: await lastStoredBlobId(ctx),
    asOf: ctx.now(),
    reason,
    lambda: await latestLambdas(ctx),
    stats: { resolved: curve.length, brierMarket: end?.brierMarket ?? null, brierCredence: end?.brierCredence ?? null },
    voices: await strongestVoices(ctx),
  };

  const lambdaText = Object.entries(payload.lambda)
    .map(([g, l]) => `${g} ${l!.toFixed(2)}`)
    .join(", ");
  const human =
    `Credence trust model — Checkpoint #${seq} (${reason}): λ ${lambdaText || "prior 0.25 everywhere"}; ` +
    `${payload.voices.length} credible voices; learned from ${payload.stats.resolved} resolved markets; ` +
    `previous checkpoint blob ${payload.prevBlobId ?? "none"}.`;

  const memoryId = await enqueueMemory(ctx.db, {
    namespace: NS.checkpoints,
    kind: "checkpoint",
    human,
    data: payload,
    refType: "checkpoint",
    refId: String(seq),
    effect: { type: "checkpoint", seq },
  });
  await ctx.db.insert(checkpoints).values({ seq, ts: payload.asOf, memoryId, prevBlobId: payload.prevBlobId, payload });
  return seq;
}

export class NoCheckpointError extends Error {
  constructor() {
    super("No trust-model checkpoint found on Walrus");
    this.name = "NoCheckpointError";
  }
}

export type RestoreReport = {
  checkpointSeq: number;
  blobId: string;
  voicesRestored: number;
  lambdas: Partial<Record<Group, number>>;
  memoriesOnWalrus: number;
  ms: number;
};

const isCheckpointPayload = (data: unknown): data is CheckpointPayload => {
  const d = data as Partial<CheckpointPayload> | null;
  return typeof d?.seq === "number" && Array.isArray(d.voices);
};

export async function countMemories(memory: MemWalLike): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_COUNT_PAGES; page++) {
    const res = await memory.listMemories({ limit: 100, cursor });
    total += res.memories.length;
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return total;
}

/**
 * Rebuilds the local trust model from the newest checkpoint on Walrus. Everything needed is read
 * first, and the wipe and rebuild are one atomic batch, so a failure leaves the local model untouched.
 */
export async function restoreFromWalrus(ctx: EngineCtx): Promise<RestoreReport> {
  if (!ctx.memory) throw new Error("Walrus Memory is not configured");
  const started = Date.now();

  const hits = await recallDecoded(ctx.memory, { namespace: NS.checkpoints, query: "Credence trust model checkpoint", sort: "recent", limit: 5 });
  const latest = hits
    .flatMap((hit) => (hit.kind === "checkpoint" && isCheckpointPayload(hit.data) ? [{ hit, payload: hit.data }] : []))
    .sort((a, b) => b.payload.seq - a.payload.seq)[0];
  if (!latest) throw new NoCheckpointError();
  const { hit, payload } = latest;
  const memoriesOnWalrus = await countMemories(ctx.memory);

  const [indexed] = await ctx.db.select({ id: memories.id }).from(memories).where(eq(memories.blobId, hit.blobId));
  const memoryId = indexed?.id ?? ulid();
  const lambdaRows = Object.entries(payload.lambda).map(([group, lambda]) => ({ group, asOf: payload.asOf, lambda: lambda as number, n: 0 }));
  const voiceRows = payload.voices.map(([voiceId, group, credibility, n]) => ({
    voiceId,
    group,
    asOf: payload.asOf,
    credibility,
    n,
    // A checkpoint keeps only what the Sharp Line needs; the rest returns at the next rescore.
    wins: 0,
    edge: 0,
    z: 0,
    pnl: 0,
    volume: 0,
  }));

  const statements: BatchItem<"sqlite">[] = [ctx.db.delete(voiceScores), ctx.db.delete(lambdas), ctx.db.delete(checkpoints)];
  if (!indexed) {
    statements.push(
      ctx.db.insert(memories).values({
        id: memoryId,
        namespace: NS.checkpoints,
        kind: "checkpoint",
        text: encodeMemory("checkpoint", hit.human, payload),
        refType: "checkpoint",
        refId: String(payload.seq),
        status: "stored",
        blobId: hit.blobId,
        effect: { type: "checkpoint", seq: payload.seq },
        createdAt: payload.asOf,
        storedAt: payload.asOf,
      }),
    );
  }
  statements.push(ctx.db.insert(checkpoints).values({ seq: payload.seq, ts: payload.asOf, memoryId, prevBlobId: payload.prevBlobId, payload }));
  if (lambdaRows.length) statements.push(ctx.db.insert(lambdas).values(lambdaRows));
  if (voiceRows.length) statements.push(ctx.db.insert(voiceScores).values(voiceRows));
  await ctx.db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

  return {
    checkpointSeq: payload.seq,
    blobId: hit.blobId,
    voicesRestored: voiceRows.length,
    lambdas: payload.lambda,
    memoriesOnWalrus,
    ms: Date.now() - started,
  };
}
