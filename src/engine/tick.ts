import { and, desc, eq, gt, gte, isNull, lt, lte } from "drizzle-orm";
import { kv, markets, sharpLines, snapshots } from "@/lib/db/schema";
import { flushMemoryQueue } from "@/lib/memory/writer";
import { CREDITS } from "@/lib/tatum/prediction";
import { recordCall } from "./calls";
import { optionalCreditsAvailable, type EngineCtx } from "./ctx";
import { snapshotHolders, type SnapshotKind } from "./holders";
import { syncMarkets } from "./markets";
import { processResolutions } from "./resolve";
import { computeAndStoreSharpLine } from "./sharp";
import { syncKalshiAndPair } from "./venues";
import { pickHistoryCandidates, refreshVoiceHistory, rescoreVoices } from "./voices";

export type StageReport = { name: string; ok: boolean; ms: number; detail?: unknown; error?: string };
export type TickReport = { stages: StageReport[] };

const MIN = 60_000;
const HOUR = 60 * MIN;
const NO_TATUM = "skipped: tatum not configured";
const NO_MEMORY = "skipped: memory not configured";
const WAITING = "waiting for credits";

const HORIZON_DAYS = 3;
const SYNC_PAGES = 2;
const SYNC_PAGE_SIZE = 100;
const SYNC_MIN_VOLUME = 10_000;
/**
 * Listing is off: on the live API, Kalshi's list ignores `sort`, is about 70% parlays, and produced no
 * matches against 110 Polymarket markets. Kalshi prices come from pairs in data/venue-overrides.json.
 */
const KALSHI_PAGES = 0;
const ROUTINE_SNAPSHOTS = 20;
/** Many markets share a midnight UTC close time, so several ticks in the window split the work. */
const FINAL_SNAPSHOTS_PER_TICK = 20;
const MAX_SNAPSHOT_FAILURES_IN_A_ROW = 3;
const HISTORY_WALLETS = 15;
const HISTORY_PAGES = 2;

async function isDue(ctx: EngineCtx, key: string, everyMs: number): Promise<boolean> {
  const [row] = await ctx.db.select().from(kv).where(eq(kv.key, `tick:${key}`));
  return !row || ctx.now() - Number(row.value) >= everyMs;
}

async function markRan(ctx: EngineCtx, key: string): Promise<void> {
  const value = String(ctx.now());
  await ctx.db.insert(kv).values({ key: `tick:${key}`, value }).onConflictDoUpdate({ target: kv.key, set: { value } });
}

/**
 * Runs optional work only when it's due and its cost fits the credit budget. Work that throws or
 * waits for credits is not marked as run, so the next tick tries again.
 */
async function every<T>(
  ctx: EngineCtx,
  key: string,
  everyMs: number,
  cost: number,
  fn: () => Promise<T>,
): Promise<T | "not due" | typeof WAITING> {
  if (!(await isDue(ctx, key, everyMs))) return "not due";
  if ((await optionalCreditsAvailable(ctx)) < cost) return WAITING;
  const result = await fn();
  await markRan(ctx, key);
  return result;
}

/** Snapshots markets in order. Stops after a few failures in a row, because that means an outage, not a bad market. */
async function snapshotMany(ctx: EngineCtx, ids: string[], kind: SnapshotKind): Promise<{ done: number; lastError: string | null }> {
  let done = 0;
  let failuresInARow = 0;
  let lastError: string | null = null;
  for (const id of ids) {
    try {
      await snapshotHolders(ctx, id, kind);
      done++;
      failuresInARow = 0;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      ctx.log(`${kind} snapshot ${id} failed: ${lastError}`);
      if (++failuresInARow >= MAX_SNAPSHOT_FAILURES_IN_A_ROW) break;
    }
  }
  return { done, lastError };
}

async function routineSnapshots(ctx: EngineCtx, now: number) {
  return every(ctx, "routineSnapshots", 6 * HOUR, CREDITS.positions, async () => {
    const affordable = Math.floor((await optionalCreditsAvailable(ctx)) / CREDITS.positions);
    const tracked = await ctx.db
      .select({ id: markets.id })
      .from(markets)
      .where(and(eq(markets.platform, "polymarket"), isNull(markets.resolution), gt(markets.closeTime, now), lt(markets.closeTime, now + 72 * HOUR)))
      .orderBy(desc(markets.volume))
      .limit(Math.min(ROUTINE_SNAPSHOTS, affordable));
    const { done, lastError } = await snapshotMany(ctx, tracked.map((m) => m.id), "routine");
    // Throwing leaves the run unmarked, so the engine picks up as soon as Tatum recovers.
    if (done === 0 && lastError) throw new Error(lastError);
    return done;
  });
}

async function snapshotStage(ctx: EngineCtx) {
  const now = ctx.now();
  const routine = await routineSnapshots(ctx, now).catch((err: unknown) => `failed: ${err instanceof Error ? err.message : String(err)}`);

  const closing = await ctx.db
    .select({ id: markets.id })
    .from(markets)
    .leftJoin(snapshots, and(eq(snapshots.marketId, markets.id), eq(snapshots.kind, "final")))
    .where(
      and(
        eq(markets.platform, "polymarket"),
        isNull(markets.resolution),
        gt(markets.closeTime, now),
        lte(markets.closeTime, now + 90 * MIN),
        isNull(snapshots.id),
      ),
    )
    .orderBy(desc(markets.volume))
    .limit(FINAL_SNAPSHOTS_PER_TICK);
  const { done: final } = await snapshotMany(ctx, closing.map((m) => m.id), "final");
  return { routine, final };
}

async function sharpLineStage(ctx: EngineCtx) {
  const pending = await ctx.db
    .select({ id: snapshots.id, marketId: snapshots.marketId, kind: snapshots.kind })
    .from(snapshots)
    .leftJoin(sharpLines, eq(sharpLines.snapshotId, snapshots.id))
    .where(and(isNull(sharpLines.id), gte(snapshots.ts, ctx.now() - 48 * HOUR)));
  let lines = 0;
  let calls = 0;
  for (const s of pending) {
    const line = await computeAndStoreSharpLine(ctx, s.marketId, s.id);
    if (!line) continue;
    lines++;
    if (s.kind === "final" && (await recordCall(ctx, s.marketId, "final"))) calls++;
  }
  return { lines, calls };
}

/**
 * One pass of the engine. Every stage is isolated: a failure is reported and the
 * remaining stages still run. Cadence is kept in `kv` so ticks can be frequent and cheap.
 */
export async function runTick(ctx: EngineCtx): Promise<TickReport> {
  const report: TickReport = { stages: [] };
  const stage = async (name: string, fn: () => Promise<unknown>) => {
    const start = Date.now();
    try {
      const detail = await fn();
      report.stages.push({ name, ok: true, ms: Date.now() - start, detail });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      ctx.log(`tick stage ${name} failed: ${error}`);
      report.stages.push({ name, ok: false, ms: Date.now() - start, error });
    }
  };
  const touched: string[] = [];

  await stage("syncMarkets", async () =>
    ctx.tatum
      ? every(ctx, "syncMarkets", HOUR, SYNC_PAGES * CREDITS.market, () =>
          syncMarkets(ctx, { horizonDays: HORIZON_DAYS, minVolume: SYNC_MIN_VOLUME, limit: SYNC_PAGE_SIZE, maxPages: SYNC_PAGES }),
        )
      : NO_TATUM,
  );
  await stage("syncKalshi", async () =>
    ctx.tatum
      ? every(ctx, "syncKalshi", 6 * HOUR, CREDITS.market, () =>
          syncKalshiAndPair(ctx, { horizonDays: HORIZON_DAYS, maxPages: KALSHI_PAGES }),
        )
      : NO_TATUM,
  );
  await stage("snapshots", async () => (ctx.tatum ? snapshotStage(ctx) : NO_TATUM));
  await stage("history", async () => {
    if (!ctx.tatum) return NO_TATUM;
    const affordable = Math.floor((await optionalCreditsAvailable(ctx)) / (HISTORY_PAGES * CREDITS.walletHistory));
    if (affordable === 0) return WAITING;
    let failed = 0;
    for (const address of await pickHistoryCandidates(ctx, Math.min(HISTORY_WALLETS, affordable))) {
      try {
        await refreshVoiceHistory(ctx, address, { maxPages: HISTORY_PAGES });
        touched.push(address);
      } catch (err) {
        failed++;
        ctx.log(`history ${address} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { refreshed: touched.length, failed };
  });
  await stage("rescore", async () => (touched.length ? { deltas: (await rescoreVoices(ctx, touched, ctx.now())).length } : "nothing to do"));
  await stage("sharpLines", () => sharpLineStage(ctx));
  await stage("resolutions", async () => (ctx.tatum ? processResolutions(ctx, { maxMarkets: 20 }) : NO_TATUM));
  await stage("flushMemory", async () => (ctx.memory ? flushMemoryQueue(ctx.db, ctx.memory, ctx.now()) : NO_MEMORY));
  return report;
}
