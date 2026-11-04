/**
 * Saves one real response per Tatum endpoint so schema tests run against real shapes.
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/capture-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { TatumHttp, TatumError } from "@/lib/tatum/http";
import { PRICE_HISTORY_PATH } from "@/lib/tatum/prediction";

const raw = z.any();
const dir = "tests/fixtures/tatum";

async function main() {
  const env = getEnv();
  if (!env.TATUM_API_KEY) throw new Error("TATUM_API_KEY missing");
  const http = new TatumHttp({ apiKey: env.TATUM_API_KEY });
  mkdirSync(dir, { recursive: true });

  const save = (name: string, body: unknown) => {
    writeFileSync(`${dir}/real-${name}.json`, JSON.stringify(body, null, 2));
    console.log(`saved real-${name}.json`);
  };
  const tryGet = async (name: string, path: string, query: Record<string, string | number>, credits: number) => {
    try {
      const body = await http.get(path, query, { credits, schema: raw });
      save(name, body);
      return body;
    } catch (err) {
      console.log(`✗ ${name}: ${err instanceof TatumError ? `${err.status} ${JSON.stringify(err.body)}` : String(err)}`);
      return null;
    }
  };

  const list = await tryGet("markets", "/markets", { platform: "polymarket", status: "active", sort: "volume_desc", limit: 3 }, 100);
  const market = list?.data?.[0];
  await tryGet("markets-kalshi", "/markets", { platform: "kalshi", sort: "endingSoon", limit: 3 }, 100);
  await tryGet("markets-sports", "/markets", { platform: "polymarket", status: "active", category: "sports", limit: 3 }, 100);
  if (!market) return;

  await tryGet("market", `/markets/${market.id}`, {}, 100);
  const positions = await tryGet("positions", `/markets/${market.id}/positions`, { status: "OPEN", sortBy: "TOKENS", limit: 3 }, 100);
  const end = new Date();
  const start = new Date(end.getTime() - 86_400_000);
  const history = await tryGet("price-history", PRICE_HISTORY_PATH(market.id), { interval: "1h", start: start.toISOString(), end: end.toISOString() }, 200);
  if (!history) {
    await tryGet("price-history-alt", `/markets/${market.id}/price/history`, { interval: "1h", start: start.toISOString(), end: end.toISOString() }, 200);
  }
  const wallet = positions?.data?.[0]?.positions?.[0]?.proxyWallet;
  if (wallet) await tryGet("wallet-history", `/wallets/${wallet}/history`, { limit: 3, sortBy: "TIMESTAMP" }, 100);
  await tryGet("top-traders", "/top-traders", { category: "SPORTS", timePeriod: "MONTH", limit: 3 }, 200);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
