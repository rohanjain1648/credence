/**
 * Records who holds each side of the biggest 2026 US midterm markets, before results are known.
 * Run before 2026-11-03: npx tsx --conditions=react-server --env-file=.env.local scripts/snapshot-election.ts
 */
import { createEngineCtx, creditsUsedSince, startOfUtcDay } from "@/engine/ctx";
import { snapshotHolders } from "@/engine/holders";
import { findElectionMarkets, upsertMarkets } from "@/engine/markets";
import { migrateDb } from "@/lib/db/migrate";

async function main() {
  const ctx = createEngineCtx();
  await migrateDb(ctx.db);
  if (!ctx.tatum) throw new Error("TATUM_API_KEY missing");
  const before = await creditsUsedSince(ctx.db, startOfUtcDay(ctx.now()));

  const found = await findElectionMarkets(ctx, { limit: 40 });
  await upsertMarkets(ctx, found);
  console.log(`found ${found.length} election markets`);

  let holders = 0;
  for (const m of found) {
    try {
      const res = await snapshotHolders(ctx, m.id, "election");
      holders += res.holders;
      const yes = m.outcomes[0]?.price;
      console.log(`  ${res.holders.toString().padStart(3)} holders · ${yes != null ? `${Math.round(yes * 100)}%` : "  ?"} · ${m.question}`);
    } catch (err) {
      console.log(`  ✗ ${m.question}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const after = await creditsUsedSince(ctx.db, startOfUtcDay(ctx.now()));
  console.log(`snapshotted ${found.length} markets, ${holders} holder rows, ${after - before} credits`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
