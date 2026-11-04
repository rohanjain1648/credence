import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/lib/db/client";
import { marketPrices, markets } from "@/lib/db/schema";
import { createEngineCtx, type EngineCtx } from "@/engine/ctx";
import { findElectionMarkets, syncMarkets, upsertMarkets } from "@/engine/markets";
import { createTestDb } from "../helpers/db";
import { makeMarket, NOW } from "../helpers/factories";
import { fakeTatum } from "../helpers/fakeTatum";

let db: Db;
const ctxWith = (tatum = fakeTatum()): EngineCtx => createEngineCtx({ db, tatum, memory: null, now: () => NOW, log: () => {} });

beforeEach(async () => {
  db = await createTestDb();
});

describe("markets", () => {
  test("upsertMarkets is idempotent and records a price point each time", async () => {
    const ctx = ctxWith();
    await upsertMarkets(ctx, [makeMarket()]);
    await upsertMarkets(ctx, [
      makeMarket({ outcomes: [{ name: "Lakers", price: 0.44, tokenId: "t0" }, { name: "Celtics", price: 0.56, tokenId: "t1" }] }),
    ]);
    const rows = await db.select().from(markets);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcomes[0].price).toBe(0.44);
    const prices = await db.select().from(marketPrices).where(eq(marketPrices.marketId, "0xmarket1"));
    expect(prices.map((p) => p.prices[0])).toEqual([0.41, 0.44]);
    expect(prices[0]).toMatchObject({ ts: NOW, source: "list" });
  });

  test("upsertMarkets maps fields and assigns group via categorize", async () => {
    await upsertMarkets(ctxWith(), [makeMarket()]);
    const [row] = await db.select().from(markets);
    expect(row).toMatchObject({
      platform: "polymarket",
      group: "SPORTS",
      closeTime: Date.parse("2026-11-04T23:00:00Z"),
      url: "https://polymarket.com/event/nba-lal-bos-2026-11-04",
      updatedAt: NOW,
    });
  });

  test("resolution is stored when present", async () => {
    await upsertMarkets(ctxWith(), [makeMarket({ resolution: { outcome: "Lakers", resolvedAt: "2026-11-05T03:00:00Z", txHash: null, source: "uma" } })]);
    const [row] = await db.select().from(markets);
    expect(row.resolution).toMatchObject({ outcome: "Lakers" });
  });

  const syncOptions = { horizonDays: 3, minVolume: 10_000, limit: 100, maxPages: 2 };

  test("syncMarkets asks for the newest active markets with volume in the horizon", async () => {
    const tatum = fakeTatum({ listMarkets: async () => ({ data: [] }) });
    await syncMarkets(ctxWith(tatum), syncOptions);
    expect(tatum.calls.map((c) => c.args[0])).toEqual([
      { platform: "polymarket", status: "active", endingBefore: "2026-11-04T12:00:00.000Z", minVolume: 10_000, sort: "newest", limit: 100 },
    ]);
  });

  test("syncMarkets drops markets Tatum still lists as active after they closed", async () => {
    const open = makeMarket({ id: "open", closeTime: "2026-11-02T00:00:00Z" });
    const stale = makeMarket({ id: "stale", closeTime: "2026-10-28T00:00:00Z" });
    const tatum = fakeTatum({ listMarkets: async () => ({ data: [open, stale] }) });
    expect(await syncMarkets(ctxWith(tatum), syncOptions)).toEqual({ upserted: 1 });
    expect((await db.select().from(markets)).map((m) => m.id)).toEqual(["open"]);
  });

  test("syncMarkets follows the cursor up to maxPages", async () => {
    const page = (id: string, cursor?: string) => ({ data: [makeMarket({ id })], cursor });
    const pages = [page("a", "c1"), page("b", "c2"), page("c", "c3")];
    const tatum = fakeTatum({ listMarkets: async () => pages.shift()! });
    expect(await syncMarkets(ctxWith(tatum), syncOptions)).toEqual({ upserted: 2 });
    expect(tatum.calls).toHaveLength(2);
    expect(tatum.calls[1].args[0]).toMatchObject({ cursor: "c1" });
  });

  test("findElectionMarkets dedupes, filters to 2026 races and ranks by volume", async () => {
    const senate = makeMarket({ id: "s", question: "Which party will win the Senate in 2026?", volume: 9e6, closeTime: "2026-11-04T00:00:00Z" });
    const house = makeMarket({ id: "h", question: "Which party will win the House in 2026?", volume: 8e6, closeTime: "2026-11-04T00:00:00Z" });
    const old = makeMarket({ id: "o", question: "Senate race 2030?", volume: 1e9, closeTime: "2030-11-04T00:00:00Z" });
    const unrelated = makeMarket({ id: "u", question: "Lakers vs. Celtics", volume: 1e9 });
    const tatum = fakeTatum({ listMarkets: async () => ({ data: [senate, house, old, unrelated] }) });
    const found = await findElectionMarkets(ctxWith(tatum), { limit: 40 });
    expect(found.map((m) => m.id)).toEqual(["s", "h"]);
  });
});
