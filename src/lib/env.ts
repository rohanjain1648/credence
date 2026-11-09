import { z } from "zod";

const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const EnvSchema = z.object({
  TATUM_API_KEY: optional,
  TATUM_DAILY_CREDIT_CAP: z.preprocess(
    (v) => (v === "" || v === undefined ? undefined : Number(v)),
    z.number().int().positive().default(60000),
  ),
  MEMWAL_ACCOUNT_ID: optional,
  MEMWAL_PRIVATE_KEY: optional,
  MEMWAL_SERVER_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url().default("https://relayer.memory.walrus.xyz"),
  ),
  DATABASE_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("file:./data/credence.db")),
  DATABASE_AUTH_TOKEN: optional,
  SUI_RECEIPTS_PRIVATE_KEY: optional,
  SUI_RECEIPTS_PACKAGE_ID: optional,
  ODDS_API_KEY: optional,
  CRON_SECRET: optional,
  AMNESIA_ENABLED: z.preprocess((v) => v === "true" || v === "1", z.boolean()),
  /** Where wallet data comes from: Tatum, Polymarket's public v2 API, or Tatum with Polymarket as fallback. */
  WALLET_DATA_SOURCE: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["auto", "tatum", "polymarket"]).default("auto")),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  return EnvSchema.parse(raw);
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

export function features(env: Env) {
  return {
    tatum: Boolean(env.TATUM_API_KEY),
    memory: Boolean(env.MEMWAL_ACCOUNT_ID && env.MEMWAL_PRIVATE_KEY),
    suiSigner: Boolean(env.SUI_RECEIPTS_PRIVATE_KEY && env.SUI_RECEIPTS_PACKAGE_ID),
    odds: Boolean(env.ODDS_API_KEY),
  };
}
