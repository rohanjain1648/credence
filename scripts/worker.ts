/**
 * Runs the engine continuously on this machine: one tick every 10 minutes.
 * Run: npm run worker   (add --once for a single tick)
 */
import { createEngineCtx } from "@/engine/ctx";
import { runTick, type TickReport } from "@/engine/tick";
import { migrateDb } from "@/lib/db/migrate";

const INTERVAL_MS = 10 * 60_000;

function print(report: TickReport) {
  console.log(`\n── tick ${new Date().toISOString()}`);
  for (const s of report.stages) {
    const detail = s.error ?? (typeof s.detail === "string" ? s.detail : JSON.stringify(s.detail));
    console.log(`${s.ok ? "✓" : "✗"} ${s.name.padEnd(12)} ${String(s.ms).padStart(6)}ms  ${detail ?? ""}`);
  }
}

async function main() {
  const once = process.argv.includes("--once");
  const ctx = createEngineCtx();
  await migrateDb(ctx.db);
  for (;;) {
    print(await runTick(ctx));
    if (once) break;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
