import { createHash } from "node:crypto";
import { and, asc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { monotonicFactory } from "ulid";
import type { Db } from "@/lib/db/client";
import { memories } from "@/lib/db/schema";
import { POINTS_PER_REMEMBER, pointsAvailable } from "./budget";
import type { MemWalLike } from "./client";
import { encodeMemory, type MemoryKind } from "./format";

export const MAX_ATTEMPTS = 5;
const nextId = monotonicFactory();
const MAX_BULK = 20;

export type MemoryDraft = {
  namespace: string;
  kind: MemoryKind;
  human: string;
  data: unknown;
  refType?: string;
  refId?: string;
  effect?: unknown;
};

export type FlushReport = { sent: number; stored: number; failed: number; requeued: number };

export async function enqueueMemory(db: Db, d: MemoryDraft): Promise<string> {
  const id = nextId();
  await db.insert(memories).values({
    id,
    namespace: d.namespace,
    kind: d.kind,
    text: encodeMemory(d.kind, d.human, d.data),
    refType: d.refType ?? null,
    refId: d.refId ?? null,
    effect: d.effect ?? null,
    status: "queued",
    createdAt: Date.now(),
  });
  return id;
}

/**
 * Moves the queue forward by one step: settles jobs the relayer finished, then
 * sends as many queued memories as the rate budget allows. Rows are never dropped;
 * a row only leaves the queue as `stored` or, after MAX_ATTEMPTS, `failed`.
 */
export async function flushMemoryQueue(db: Db, mem: MemWalLike, now: number): Promise<FlushReport> {
  const report: FlushReport = { sent: 0, stored: 0, failed: 0, requeued: 0 };
  await settleSent(db, mem, now, report);
  await sendQueued(db, mem, now, report);
  return report;
}

async function settleSent(db: Db, mem: MemWalLike, now: number, report: FlushReport) {
  const sent = await db.select().from(memories).where(eq(memories.status, "sent"));
  const withJobs = sent.filter((r) => r.jobId);
  if (withJobs.length === 0) return;

  let results;
  try {
    ({ results } = await mem.getRememberBulkStatus(withJobs.map((r) => r.jobId!)));
  } catch {
    return; // relayer unreachable; try again next flush
  }
  const byJob = new Map(results.map((r) => [r.job_id, r]));

  for (const row of withJobs) {
    const status = byJob.get(row.jobId!);
    if (!status) continue;
    if (status.status === "done" && status.blob_id) {
      await db
        .update(memories)
        .set({ status: "stored", blobId: status.blob_id, storedAt: now, error: null })
        .where(eq(memories.id, row.id));
      report.stored++;
    } else if (status.status === "failed" || status.status === "not_found") {
      await recordFailure(db, row.id, row.attempts + 1, status.error ?? status.status, report);
    }
  }
}

async function sendQueued(db: Db, mem: MemWalLike, now: number, report: FlushReport) {
  const recent = await db
    .select({ sentAt: memories.sentAt })
    .from(memories)
    .where(and(isNotNull(memories.sentAt), gt(memories.sentAt, now - 3_600_000)));
  const capacity = Math.min(MAX_BULK, Math.floor(pointsAvailable(recent.map((r) => r.sentAt!), now) / POINTS_PER_REMEMBER));
  if (capacity <= 0) return;

  const batch = await db
    .select()
    .from(memories)
    .where(eq(memories.status, "queued"))
    .orderBy(asc(memories.createdAt), asc(memories.id))
    .limit(capacity);
  if (batch.length === 0) return;

  const ids = batch.map((r) => r.id);
  const idempotencyKey = createHash("sha256").update([...ids].sort().join(",")).digest("hex");

  let accepted;
  try {
    accepted = await mem.rememberBulkAsync(
      batch.map((r) => ({ text: r.text, namespace: r.namespace })),
      { idempotencyKey },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    for (const row of batch) await recordFailure(db, row.id, row.attempts + 1, message, report);
    return;
  }

  for (const [i, row] of batch.entries()) {
    const jobId = accepted.job_ids[i];
    if (!jobId) continue;
    await db.update(memories).set({ status: "sent", jobId, sentAt: now }).where(eq(memories.id, row.id));
    report.sent++;
  }
  if (accepted.job_ids.length < batch.length) {
    const missing = ids.slice(accepted.job_ids.length);
    await db.update(memories).set({ status: "queued" }).where(inArray(memories.id, missing));
  }
}

async function recordFailure(db: Db, id: string, attempts: number, error: string, report: FlushReport) {
  const failed = attempts >= MAX_ATTEMPTS;
  await db
    .update(memories)
    .set({ status: failed ? "failed" : "queued", attempts, error, jobId: null })
    .where(eq(memories.id, id));
  if (failed) report.failed++;
  else report.requeued++;
}
