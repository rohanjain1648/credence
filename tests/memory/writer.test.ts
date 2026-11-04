import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/lib/db/client";
import { memories } from "@/lib/db/schema";
import { decodeMemory } from "@/lib/memory/format";
import { recallDecoded } from "@/lib/memory/reader";
import { enqueueMemory, flushMemoryQueue } from "@/lib/memory/writer";
import { createTestDb } from "../helpers/db";
import { fakeMemory } from "../helpers/fakeMemory";

const NOW = 1_800_000_000_000;
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

const rows = () => db.select().from(memories).orderBy(asc(memories.createdAt), asc(memories.id));

async function enqueue3() {
  await enqueueMemory(db, { namespace: "credence-lessons", kind: "lesson", human: "A won.", data: { a: 1 } });
  await enqueueMemory(db, { namespace: "credence-lessons", kind: "lesson", human: "B won.", data: { b: 1 } });
  await enqueueMemory(db, {
    namespace: "credence-voices",
    kind: "dossier",
    human: "Wallet sharp.",
    data: {},
    refType: "wallet",
    refId: "0xabc",
    effect: { type: "credibility", before: null, after: 81 },
  });
}

describe("memory writer", () => {
  test("enqueue stores encoded text with status queued", async () => {
    await enqueue3();
    const r = await rows();
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.status === "queued" && x.attempts === 0)).toBe(true);
    expect(decodeMemory(r[2].text)).toMatchObject({ kind: "dossier", human: "Wallet sharp." });
    expect(r[2]).toMatchObject({ refType: "wallet", refId: "0xabc", effect: { type: "credibility", after: 81 } });
  });

  test("flush sends queued rows in one bulk call with per-item namespaces", async () => {
    const mem = fakeMemory();
    await enqueue3();
    const report = await flushMemoryQueue(db, mem, NOW);
    expect(report.sent).toBe(3);
    expect(mem.bulkCalls).toHaveLength(1);
    expect(mem.bulkCalls[0].items.map((i) => i.namespace)).toEqual(["credence-lessons", "credence-lessons", "credence-voices"]);
    expect(mem.bulkCalls[0].options?.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    const r = await rows();
    expect(r.every((x) => x.status === "sent" && x.jobId && x.sentAt === NOW)).toBe(true);
  });

  test("second flush marks done jobs stored with blobId", async () => {
    const mem = fakeMemory();
    await enqueue3();
    await flushMemoryQueue(db, mem, NOW);
    mem.finishAll();
    const report = await flushMemoryQueue(db, mem, NOW + 60_000);
    expect(report.stored).toBe(3);
    const r = await rows();
    expect(r.every((x) => x.status === "stored" && x.blobId === `blob-${x.jobId}` && x.storedAt === NOW + 60_000)).toBe(true);
  });

  test("jobs still pending stay sent", async () => {
    const mem = fakeMemory();
    await enqueue3();
    await flushMemoryQueue(db, mem, NOW);
    const report = await flushMemoryQueue(db, mem, NOW + 60_000);
    expect(report.stored).toBe(0);
    expect((await rows()).every((x) => x.status === "sent")).toBe(true);
  });

  test("relayer failure keeps rows queued and counts attempts", async () => {
    const mem = fakeMemory();
    mem.failBulk = new Error("429 Too Many Requests");
    await enqueue3();
    await flushMemoryQueue(db, mem, NOW);
    let r = await rows();
    expect(r.every((x) => x.status === "queued" && x.attempts === 1 && x.error?.includes("429"))).toBe(true);
    for (let i = 1; i < 5; i++) await flushMemoryQueue(db, mem, NOW + i * 120_000);
    r = await rows();
    expect(r.every((x) => x.status === "failed" && x.attempts === 5)).toBe(true);
  });

  test("job status failed requeues the row", async () => {
    const mem = fakeMemory();
    await enqueueMemory(db, { namespace: "credence-lessons", kind: "lesson", human: "A won.", data: {} });
    await flushMemoryQueue(db, mem, NOW);
    const [sent] = await rows();
    mem.fail(sent.jobId!);
    const report = await flushMemoryQueue(db, mem, NOW + 60_000);
    // The requeued row is re-sent in the same flush once budget allows; it must not be lost.
    const [after] = await rows();
    expect(report.requeued).toBe(1);
    expect(after.attempts).toBe(1);
    expect(["queued", "sent"]).toContain(after.status);
    expect(after.error).toContain("upload failed");
  });

  test("flush sends nothing when budget is 0", async () => {
    const mem = fakeMemory();
    for (let i = 0; i < 10; i++) {
      await enqueueMemory(db, { namespace: "credence-lessons", kind: "lesson", human: `m${i}`, data: {} });
    }
    await flushMemoryQueue(db, mem, NOW); // 10 sends → minute budget exhausted
    await enqueueMemory(db, { namespace: "credence-lessons", kind: "lesson", human: "late", data: {} });
    const report = await flushMemoryQueue(db, mem, NOW + 1_000);
    expect(report.sent).toBe(0);
    const late = await db.select().from(memories).where(eq(memories.text, "late\n§credence/v1 " + JSON.stringify({ kind: "lesson", data: {} })));
    expect(late[0].status).toBe("queued");
  });

  test("sends at most the per-minute budget in one bulk call", async () => {
    const mem = fakeMemory();
    for (let i = 0; i < 25; i++) {
      await enqueueMemory(db, { namespace: "credence-lessons", kind: "lesson", human: `m${i}`, data: {} });
    }
    const report = await flushMemoryQueue(db, mem, NOW);
    expect(report.sent).toBe(10); // minute cap: 50 points / 5
    expect(mem.bulkCalls[0].items).toHaveLength(10);
  });

  test("recallDecoded decodes payloads and keeps plain text", async () => {
    const mem = fakeMemory();
    mem.recallResults = [
      { blob_id: "b1", text: "Lakers won.\n§credence/v1 " + JSON.stringify({ kind: "lesson", data: { y: 1 } }), distance: 0.1, created_at: "2026-11-04T00:00:00Z" },
      { blob_id: "b2", text: "free text", distance: 0.3 },
    ];
    const hits = await recallDecoded(mem, { namespace: "credence-lessons", query: "Lakers", limit: 5, sort: "recent" });
    expect(mem.recallCalls[0]).toEqual({ query: "Lakers", namespace: "credence-lessons", limit: 5, sort: "recent" });
    expect(hits[0]).toEqual({ blobId: "b1", createdAt: "2026-11-04T00:00:00Z", distance: 0.1, kind: "lesson", human: "Lakers won.", data: { y: 1 } });
    expect(hits[1]).toMatchObject({ blobId: "b2", kind: null, human: "free text", data: null });
  });
});
