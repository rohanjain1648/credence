import "server-only";
import { getEnv } from "@/lib/env";
import { getDb, type Db } from "./client";
import { migrateDb } from "./migrate";

let ready: Promise<Db> | undefined;

/** The app database, with migrations applied once per process for local SQLite files. */
export function getReadyDb(): Promise<Db> {
  ready ??= (async () => {
    const db = getDb();
    if (getEnv().DATABASE_URL.startsWith("file:")) await migrateDb(db);
    return db;
  })();
  return ready;
}
