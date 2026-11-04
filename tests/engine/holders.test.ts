import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/lib/db/client";
import { holderSnapshots, snapshots, wallets } from "@/lib/db/schema";
import { createEngineCtx } from "@/engine/ctx";
import { snapshotHolders } from "@/engine/holders";
import { upsertMarkets } from "@/engine/markets";
import { createTestDb } from "../helpers/db";
import { makeHolder, makeMarket, NOW } from "../helpers/factories";
import { fakeTatum } from "../helpers/fakeTatum";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

describe("holders", () => {
  test("snapshotHolders stores snapshot and holders for both outcomes", async () => {
    const tatum = fakeTatum({
      getMarketPositions: async () => [
        { token: "t0", positions: [makeHolder({ proxyWallet: "0xa", name: "Ann" }), makeHolder({ proxyWallet: "0xb" })] },
        {
          token: "t1",
          positions: [
            makeHolder({ proxyWallet: "0xc", outcomeIndex: 1, currentValue: 900 }),
            makeHolder({ proxyWallet: "0xd", outcomeIndex: 1 }),
          ],
        },
      ],
    });
    const ctx = createEngineCtx({ db, tatum, memory: null, now: () => NOW, log: () => {} });
    await upsertMarkets(ctx, [makeMarket()]);

    const res = await snapshotHolders(ctx, "0xmarket1", "election");

    expect(res.holders).toBe(4);
    expect(tatum.calls[0].args).toEqual(["0xmarket1", { status: "OPEN", sortBy: "TOKENS", limit: 50 }]);
    const [snap] = await db.select().from(snapshots);
    expect(snap).toMatchObject({ id: res.snapshotId, marketId: "0xmarket1", ts: NOW, kind: "election", prices: [0.41, 0.59] });
    const holders = await db.select().from(holderSnapshots);
    expect(holders.map((h) => [h.address, h.outcomeIndex])).toEqual([
      ["0xa", 0],
      ["0xb", 0],
      ["0xc", 1],
      ["0xd", 1],
    ]);
    const ws = await db.select().from(wallets);
    expect(ws.find((w) => w.address === "0xa")?.name).toBe("Ann");
  });

  test("snapshotHolders skips kalshi markets without calling the API", async () => {
    const tatum = fakeTatum();
    const ctx = createEngineCtx({ db, tatum, memory: null, now: () => NOW, log: () => {} });
    await upsertMarkets(ctx, [makeMarket({ id: "KXNBA-LAL", platform: "kalshi" })]);
    const res = await snapshotHolders(ctx, "KXNBA-LAL", "routine");
    expect(res.holders).toBe(0);
    expect(tatum.calls).toHaveLength(0);
  });

  test("unknown market throws", async () => {
    const ctx = createEngineCtx({ db, tatum: fakeTatum(), memory: null, now: () => NOW, log: () => {} });
    await expect(snapshotHolders(ctx, "nope", "routine")).rejects.toThrow(/nope/);
  });
});
