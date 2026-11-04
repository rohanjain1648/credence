/**
 * Verifies every live dependency with the cheapest possible call.
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/smoke.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createEngineCtx, creditsUsedSince, startOfUtcDay } from "@/engine/ctx";
import { migrateDb } from "@/lib/db/migrate";
import { features, getEnv } from "@/lib/env";
import { createTatumSuiClient, latestCheckpoint } from "@/lib/sui/client";

async function check(name: string, fn: () => Promise<string>) {
  try {
    console.log(`✓ ${name}: ${await fn()}`);
    return true;
  } catch (err) {
    console.log(`✗ ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function main() {
  const env = getEnv();
  const ctx = createEngineCtx();
  await migrateDb(ctx.db);
  console.log("features:", features(env));

  const results = await Promise.all([
    check("Tatum Prediction API", async () => {
      if (!ctx.tatum) throw new Error("TATUM_API_KEY missing");
      const { data } = await ctx.tatum.listMarkets({ limit: 1 });
      const used = await creditsUsedSince(ctx.db, startOfUtcDay(Date.now()));
      return `"${data[0]?.question ?? "(no markets)"}" — credits used today ${used}`;
    }),
    check("Walrus Memory (Mainnet relayer)", async () => {
      if (!ctx.memory) throw new Error("MEMWAL_ACCOUNT_ID / MEMWAL_PRIVATE_KEY missing");
      const health = await ctx.memory.health();
      const page = await ctx.memory.listMemories({ limit: 100 });
      return `relayer ${health.status} v${health.version}${health.write_ready === false ? " (writes NOT ready)" : ""}; ${page.memories.length}${page.has_more ? "+" : ""} memories on account`;
    }),
    check("Tatum Sui RPC", async () => {
      if (!env.TATUM_API_KEY) throw new Error("TATUM_API_KEY missing");
      const sui = createTatumSuiClient(env.TATUM_API_KEY);
      const checkpoint = await latestCheckpoint(sui);
      if (!env.MEMWAL_ACCOUNT_ID) return `checkpoint #${checkpoint}`;
      const { object } = await sui.core.getObject({ objectId: env.MEMWAL_ACCOUNT_ID, include: { json: true } });
      mkdirSync("tests/fixtures/sui", { recursive: true });
      writeFileSync("tests/fixtures/sui/memwal-account.json", JSON.stringify(object, null, 2));
      return `checkpoint #${checkpoint}; memory account type ${object.type}`;
    }),
  ]);

  process.exit(results.every(Boolean) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
