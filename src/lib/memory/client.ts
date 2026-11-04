import "server-only";
import {
  MemWal,
  type HealthResult,
  type ListMemoriesOptions,
  type MemoriesResult,
  type RecallParams,
  type RecallResult,
  type RememberBulkAcceptedResult,
  type RememberBulkAsyncOptions,
  type RememberBulkItem,
  type RememberBulkStatusResult,
} from "@mysten-incubation/memwal";
import { features, getEnv } from "@/lib/env";

/** The slice of the Walrus Memory SDK the app uses; tests substitute a fake. */
export interface MemWalLike {
  rememberBulkAsync(items: RememberBulkItem[], options?: RememberBulkAsyncOptions): Promise<RememberBulkAcceptedResult>;
  getRememberBulkStatus(jobIds: string[], opts?: { timeoutMs?: number }): Promise<RememberBulkStatusResult>;
  recall(params: RecallParams): Promise<RecallResult>;
  listMemories(options?: ListMemoriesOptions): Promise<MemoriesResult>;
  health(): Promise<HealthResult>;
}

let cached: MemWalLike | null | undefined;

export function getMemory(): MemWalLike | null {
  if (cached !== undefined) return cached;
  const env = getEnv();
  cached = features(env).memory
    ? MemWal.create({ key: env.MEMWAL_PRIVATE_KEY!, accountId: env.MEMWAL_ACCOUNT_ID!, serverUrl: env.MEMWAL_SERVER_URL })
    : null;
  return cached;
}
