import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrateDb } from "@/lib/db/migrate";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/client";

export async function createTestDb(): Promise<Db> {
  const db = drizzle(createClient({ url: ":memory:" }), { schema });
  await migrateDb(db);
  return db;
}
