import type {
  ListMemoriesOptions,
  MemoriesResult,
  RecallMemory,
  RecallParams,
  RememberBulkAsyncOptions,
  RememberBulkItem,
} from "@mysten-incubation/memwal";
import type { MemWalLike } from "@/lib/memory/client";

type JobState = { status: "pending" | "running" | "uploaded" | "done" | "failed" | "not_found"; blob_id?: string; error?: string };

/** In-memory stand-in for the Walrus Memory relayer. Tests drive job outcomes explicitly. */
export function fakeMemory() {
  let counter = 0;
  const jobs = new Map<string, JobState>();
  const fake = {
    bulkCalls: [] as Array<{ items: RememberBulkItem[]; options?: RememberBulkAsyncOptions }>,
    recallCalls: [] as RecallParams[],
    recallResults: [] as RecallMemory[],
    listed: [] as MemoriesResult["memories"],
    failBulk: null as Error | null,
    jobs,
    /** Mark one accepted job as finished on Walrus. */
    finish(jobId: string, blobId = `blob-${jobId}`) {
      jobs.set(jobId, { status: "done", blob_id: blobId });
    },
    finishAll() {
      for (const [id, s] of jobs) if (s.status === "pending") jobs.set(id, { status: "done", blob_id: `blob-${id}` });
    },
    fail(jobId: string, error = "upload failed") {
      jobs.set(jobId, { status: "failed", error });
    },
    async rememberBulkAsync(items: RememberBulkItem[], options?: RememberBulkAsyncOptions) {
      if (fake.failBulk) throw fake.failBulk;
      fake.bulkCalls.push({ items, options });
      const job_ids = items.map(() => `job-${++counter}`);
      for (const id of job_ids) jobs.set(id, { status: "pending" });
      return { job_ids, total: items.length, status: "accepted" };
    },
    async getRememberBulkStatus(jobIds: string[]) {
      return {
        results: jobIds.map((job_id) => ({ job_id, ...(jobs.get(job_id) ?? { status: "not_found" as const }) })),
      };
    },
    async recall(params: RecallParams) {
      fake.recallCalls.push(params);
      return { results: fake.recallResults.slice(0, params.limit ?? 10), total: fake.recallResults.length };
    },
    async listMemories(options?: ListMemoriesOptions): Promise<MemoriesResult> {
      const memories = options?.namespace ? fake.listed.filter((m) => m.namespace_id === options.namespace) : fake.listed;
      return { memories, next_cursor: null, has_more: false, snapshot_version: 1, deleted: [], must_resync: false };
    },
    async health() {
      return { status: "ok", version: "fake" };
    },
  };
  const typed: MemWalLike = fake;
  void typed;
  return fake;
}
