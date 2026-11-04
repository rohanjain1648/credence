import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/lib/db/client";
import { lambdas, markets, sharpLines } from "@/lib/db/schema";
import { createEngineCtx, type EngineCtx } from "@/engine/ctx";
import { upsertMarkets } from "@/engine/markets";
import { computeAndStoreSharpLine, getLambda } from "@/engine/sharp";
import { createTestDb } from "../helpers/db";
import { makeMarket, NOW } from "../helpers/factories";
import { seedSnapshot } from "../helpers/seed";

let db: Db;
let ctx: EngineCtx;

beforeEach(async () => {
  db = await createTestDb();
  ctx = createEngineCtx({ db, tatum: null, memory: null, now: () => NOW, log: () => {} });
});

describe("sharp lines", () => {
  test("getLambda uses the latest learned value or the prior", async () => {
    expect(await getLambda(ctx, "SPORTS")).toBe(0.25);
    await db.insert(lambdas).values([
      { group: "SPORTS", asOf: 1, lambda: 0.1, n: 3 },
      { group: "SPORTS", asOf: 2, lambda: 0.31, n: 4 },
    ]);
    expect(await getLambda(ctx, "SPORTS")).toBe(0.31);
  });

  test("stores sharp line with contributors from snapshot + credibility", async () => {
    await upsertMarkets(ctx, [makeMarket()]);
    const snapshotId = await seedSnapshot(db, { holders: [["a", 0, 1000, 80], ["b", 1, 1000, 60], ["c", 0, 1000, null]] });
    const row = await computeAndStoreSharpLine(ctx, "0xmarket1", snapshotId);
    expect(row).not.toBeNull();
    expect(row!.priceA).toBe(0.5);
    expect(row!.line).toBeCloseTo(0.6, 6);
    expect(row!.consensus).toBeCloseTo(0.9, 6);
    expect(row!.lambda).toBe(0.25);
    expect(row!.contributors[0].address).toBe("a");
    expect(await db.select().from(sharpLines)).toHaveLength(1);
  });

  test("three-outcome market → null, no row", async () => {
    await upsertMarkets(ctx, [
      makeMarket({ outcomes: [{ name: "A", price: 0.3, tokenId: null }, { name: "B", price: 0.3, tokenId: null }, { name: "C", price: 0.4, tokenId: null }] }),
    ]);
    const snapshotId = await seedSnapshot(db, { holders: [["a", 0, 1000, 80]] });
    expect(await computeAndStoreSharpLine(ctx, "0xmarket1", snapshotId)).toBeNull();
    expect(await db.select().from(sharpLines)).toHaveLength(0);
  });

  test("missing outcome price → null, no row", async () => {
    await upsertMarkets(ctx, [makeMarket({ outcomes: [{ name: "Yes", price: null, tokenId: null }, { name: "No", price: null, tokenId: null }] })]);
    const snapshotId = await seedSnapshot(db, { prices: [null, null], holders: [["a", 0, 1000, 80]] });
    expect(await computeAndStoreSharpLine(ctx, "0xmarket1", snapshotId)).toBeNull();
    expect(await db.select().from(sharpLines)).toHaveLength(0);
  });

  test("unknown market or snapshot → null", async () => {
    expect(await computeAndStoreSharpLine(ctx, "nope", "nope")).toBeNull();
    expect(await db.select().from(markets)).toHaveLength(0);
  });
});
