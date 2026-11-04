import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { createTestDb } from "./helpers/db";

test("migrations create all tables", async () => {
  const db = await createTestDb();
  const rows = await db.all<{ name: string }>(sql`select name from sqlite_master where type='table'`);
  expect(rows.map((r) => r.name)).toEqual(
    expect.arrayContaining([
      "markets", "market_prices", "venue_pairs", "wallets", "closed_positions", "snapshots",
      "holder_snapshots", "voice_scores", "sharp_lines", "lambdas", "picks", "memories",
      "checkpoints", "receipts", "api_usage", "kv",
    ]),
  );
});
