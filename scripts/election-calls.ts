/**
 * Turns the election snapshots into Credence's on-the-record calls in Walrus Memory:
 * score the holders, compute each Sharp Line, write the calls, then drain the queue.
 * Run after snapshot:election, before polls open on 2026-11-03:
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/election-calls.ts [--no-wait]
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { recordCall } from "@/engine/calls";
import { createEngineCtx, creditsUsedSince, startOfUtcDay } from "@/engine/ctx";
import { computeAndStoreSharpLine } from "@/engine/sharp";
import { pickHistoryCandidates, refreshVoiceHistory, rescoreVoices, seedVoicesFromLeaderboards } from "@/engine/voices";
import { migrateDb } from "@/lib/db/migrate";
import { memories, snapshots } from "@/lib/db/schema";
import { flushMemoryQueue } from "@/lib/memory/writer";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const wait = !process.argv.includes("--no-wait");
  const ctx = createEngineCtx();
  await migrateDb(ctx.db);
  if (!ctx.tatum) throw new Error("TATUM_API_KEY missing");
  const creditsBefore = await creditsUsedSince(ctx.db, startOfUtcDay(ctx.now()));

  const seeded = await seedVoicesFromLeaderboards(ctx, { categories: ["POLITICS", "OVERALL"], periods: ["MONTH", "ALL"], perBoard: 50 });
  console.log(`seeded ${seeded} leaderboard wallets`);

  const candidates = await pickHistoryCandidates(ctx, 150);
  console.log(`refreshing history for ${candidates.length} holders`);
  for (const [i, address] of candidates.entries()) {
    try {
      const n = await refreshVoiceHistory(ctx, address, { maxPages: 2 });
      if (i % 10 === 0) console.log(`  ${i + 1}/${candidates.length} ${address} · ${n} bets`);
    } catch (err) {
      console.log(`  ✗ ${address}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const deltas = await rescoreVoices(ctx, candidates, ctx.now());
  console.log(`rescored ${candidates.length} voices (${deltas.length} category scores)`);

  const latest = await ctx.db.select().from(snapshots).where(eq(snapshots.kind, "election")).orderBy(desc(snapshots.ts));
  const perMarket = new Map<string, string>();
  for (const s of latest) if (!perMarket.has(s.marketId)) perMarket.set(s.marketId, s.id);

  for (const [marketId, snapshotId] of perMarket) {
    const line = await computeAndStoreSharpLine(ctx, marketId, snapshotId);
    if (!line) continue;
    await recordCall(ctx, marketId, "election");
    const shown = line.line === null ? "no line" : `${Math.round(line.priceA * 100)}% → ${Math.round(line.line * 100)}%`;
    console.log(`  call · ${shown} · weight ${line.weight.toFixed(2)} · ${marketId.slice(0, 10)}`);
  }

  const creditsAfter = await creditsUsedSince(ctx.db, startOfUtcDay(ctx.now()));
  console.log(`Tatum credits used: ${creditsAfter - creditsBefore}`);

  if (!ctx.memory) throw new Error("MEMWAL_ACCOUNT_ID / MEMWAL_PRIVATE_KEY missing; calls are queued locally");
  for (;;) {
    const report = await flushMemoryQueue(ctx.db, ctx.memory, ctx.now());
    const pending = await ctx.db.select({ id: memories.id }).from(memories).where(inArray(memories.status, ["queued", "sent"]));
    console.log(`memory flush: +${report.sent} sent, +${report.stored} stored, ${report.requeued} requeued, ${report.failed} failed · ${pending.length} pending`);
    if (pending.length === 0 || !wait) break;
    await sleep(15_000);
  }

  const stored = await ctx.db
    .select({ blobId: memories.blobId, kind: memories.kind })
    .from(memories)
    .where(and(eq(memories.status, "stored"), inArray(memories.kind, ["call", "dossier"])));
  console.log(`${stored.length} memories stored on Walrus Mainnet:`);
  for (const m of stored) console.log(`  ${m.kind.padEnd(8)} ${m.blobId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
