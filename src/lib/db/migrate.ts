import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Db } from "./client";

export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
}
