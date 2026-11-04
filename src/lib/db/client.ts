import { mkdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

let cached: Db | undefined;

export function getDb(): Db {
  if (cached) return cached;
  const env = getEnv();
  if (env.DATABASE_URL.startsWith("file:")) mkdirSync("data", { recursive: true });
  cached = drizzle(createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN }), { schema });
  return cached;
}
