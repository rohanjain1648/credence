import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/lib/db/client";
import { checkpoints, holderSnapshots, lambdas, markets, memories, picks, sharpLines, snapshots, wallets } from "@/lib/db/schema";
import { decodeMemory } from "@/lib/memory/format";
import { CreditCapError } from "@/lib/tatum/http";
import { createEngineCtx, type EngineCtx } from "@/engine/ctx";
import { upsertMarkets } from "@/engine/markets";
import { createPick } from "@/engine/picks";
import { observationsFor, processResolutions } from "@/engine/resolve";
import { createTestDb } from "../helpers/db";
import { makeMarket, NOW } from "../helpers/factories";
import { fakeTatum } from "../helpers/fakeTatum";
import type { Market } from "@/lib/tatum/prediction";

let db: Db;
const CLOSE = NOW - 3_600_000;
const resolved = (id: string, winner: string): Market =>
  makeMarket({ id, closeTime: new Date(CLOSE).toISOString(), resolution: { outcome: winner, resolvedAt: new Date(NOW - 60_000).toISOString(), txHash: null, source: "uma" } });

async function trackedMarket(ctx: EngineCtx, id: string, priceA: number, line: number | null, consensus: number | null) {
  await upsertMarkets(ctx, [makeMarket({ id, closeTime: new Date(CLOSE).toISOString() })]);
  await db.insert(snapshots).values({ id: `snap-${id}`, marketId: id, ts: CLOSE - 600_000, kind: "final", prices: [priceA, 1 - priceA] });
  await db.insert(holderSnapshots).values([
    { snapshotId: `snap-${id}`, marketId: id, address: "0xright", outcomeIndex: 0, size: 1, avgPrice: 0.4, currentValue: 1000 },
    { snapshotId: `snap-${id}`, marketId: id, address: "0xwrong", outcomeIndex: 1, size: 1, avgPrice: 0.6, currentValue: 1000 },
  ]);
  await db.insert(sharpLines).values({
    marketId: id,
    snapshotId: `snap-${id}`,
    ts: CLOSE - 600_000,
    priceA,
    consensus,
    line,
    weight: 3,
    lambda: 0.25,
    contributors: [
      { address: "0xright", outcomeIndex: 0, weight: 2, credibility: 80 },
      { address: "0xwrong", outcomeIndex: 1, weight: 1, credibility: 60 },
    ],
  });
}

function ctxWith(getMarket: (id: string) => Promise<Market>): EngineCtx {
  return createEngineCtx({ db, tatum: fakeTatum({ getMarket }), memory: null, now: () => NOW, log: () => {} });
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("resolutions", () => {
  test("resolution writes lesson saying Sharp beat the crowd", async () => {
    const ctx = ctxWith(async (id) => resolved(id, "Lakers"));
    await trackedMarket(ctx, "m1", 0.41, 0.5, 0.77);
    const report = await processResolutions(ctx, { maxMarkets: 20 });
    expect(report).toMatchObject({ checked: 1, resolved: 1, lessons: 1 });
    const lesson = (await db.select().from(memories)).find((m) => m.kind === "lesson")!;
    expect(lesson).toMatchObject({ namespace: "credence-lessons", refType: "market", refId: "m1" });
    const decoded = decodeMemory(lesson.text)!;
    expect(decoded.human).toContain("Lakers");
    expect(decoded.human).toContain("beat the crowd");
    expect(decoded.data).toMatchObject({ y: 1, winner: "Lakers", priceA: 0.41, line: 0.5, right: ["0xright"], wrong: ["0xwrong"] });
    const [row] = await db.select().from(markets).where(eq(markets.id, "m1"));
    expect(row.resolution?.outcome).toBe("Lakers");
  });

  test("lesson admits when the crowd was closer", async () => {
    const ctx = ctxWith(async (id) => resolved(id, "Celtics"));
    await trackedMarket(ctx, "m1", 0.41, 0.5, 0.77);
    await processResolutions(ctx, { maxMarkets: 20 });
    const lesson = (await db.select().from(memories)).find((m) => m.kind === "lesson")!;
    expect(decodeMemory(lesson.text)!.human).toContain("crowd was closer");
  });

  test("marks holders of the final snapshot historyStale", async () => {
    const ctx = ctxWith(async (id) => resolved(id, "Lakers"));
    await trackedMarket(ctx, "m1", 0.41, 0.5, 0.77);
    await processResolutions(ctx, { maxMarkets: 20 });
    const ws = await db.select().from(wallets);
    expect(ws.map((w) => [w.address, w.historyStale]).sort()).toEqual([
      ["0xright", true],
      ["0xwrong", true],
    ]);
  });

  test("refits lambda for the group and records the effect", async () => {
    const ctx = ctxWith(async (id) => resolved(id, "Lakers"));
    await trackedMarket(ctx, "m1", 0.41, 0.5, 0.77);
    await processResolutions(ctx, { maxMarkets: 20 });
    const [l] = await db.select().from(lambdas).where(eq(lambdas.group, "SPORTS"));
    expect(l.n).toBe(1);
    expect(l.lambda).toBeGreaterThan(0.25);
    const lesson = (await db.select().from(memories)).find((m) => m.kind === "lesson")!;
    expect(lesson.effect).toMatchObject({ type: "lambda", group: "SPORTS", before: 0.25, after: l.lambda });
  });

  test("market still unresolved is untouched", async () => {
    const ctx = ctxWith(async (id) => makeMarket({ id, closeTime: new Date(CLOSE).toISOString() }));
    await trackedMarket(ctx, "m1", 0.41, 0.5, 0.77);
    const report = await processResolutions(ctx, { maxMarkets: 20 });
    expect(report).toMatchObject({ checked: 1, resolved: 0, lessons: 0 });
    expect(await db.select().from(memories)).toHaveLength(0);
    expect(await db.select().from(lambdas)).toHaveLength(0);
  });

  test("getMarket throwing for one market does not stop others", async () => {
    const ctx = ctxWith(async (id) => {
      if (id === "m1") throw new Error("Tatum 503");
      return resolved(id, "Lakers");
    });
    await trackedMarket(ctx, "m1", 0.41, 0.5, 0.77);
    await trackedMarket(ctx, "m2", 0.41, 0.5, 0.77);
    const report = await processResolutions(ctx, { maxMarkets: 20 });
    expect(report.resolved).toBe(1);
  });

  test("markets that close in the future are not checked", async () => {
    const ctx = ctxWith(async () => {
      throw new Error("should not be called");
    });
    await upsertMarkets(ctx, [makeMarket({ id: "future", closeTime: new Date(NOW + 3_600_000).toISOString() })]);
    expect((await processResolutions(ctx, { maxMarkets: 20 })).checked).toBe(0);
  });

  describe("resolution check backoff", () => {
    const MIN = 60_000;
    function unresolvedCtx(clock: { now: number }) {
      const tatum = fakeTatum({ getMarket: async (id) => makeMarket({ id, closeTime: new Date(CLOSE).toISOString() }) });
      return createEngineCtx({ db, tatum, memory: null, now: () => clock.now, log: () => {} });
    }

    test("an unresolved market waits longer after each check", async () => {
      const clock = { now: NOW };
      const ctx = unresolvedCtx(clock);
      await trackedMarket(ctx, "m1", 0.41, 0.5, 0.77);
      const checked = async (afterMinutes: number) => {
        clock.now += afterMinutes * MIN;
        return (await processResolutions(ctx, { maxMarkets: 20 })).checked;
      };
      expect(await checked(0)).toBe(1);
      expect(await checked(29)).toBe(0);
      expect(await checked(1)).toBe(1); // 30 min after the first check
      expect(await checked(59)).toBe(0);
      expect(await checked(1)).toBe(1); // 60 min after the second check
    });

    test("the wait stops growing at 24 hours", async () => {
      const clock = { now: NOW };
      const ctx = unresolvedCtx(clock);
      await trackedMarket(ctx, "m1", 0.41, 0.5, 0.77);
      await db.update(markets).set({ resolveChecks: 20 }).where(eq(markets.id, "m1"));
      await processResolutions(ctx, { maxMarkets: 20 });
      clock.now += 24 * 60 * MIN;
      expect((await processResolutions(ctx, { maxMarkets: 20 })).checked).toBe(1);
    });

    test("slow markets do not starve newer ones", async () => {
      const clock = { now: NOW };
      const ctx = unresolvedCtx(clock);
      for (const id of ["a", "b", "c"]) await trackedMarket(ctx, id, 0.41, 0.5, 0.77);
      expect((await processResolutions(ctx, { maxMarkets: 2 })).checked).toBe(2);
      clock.now += MIN;
      expect((await processResolutions(ctx, { maxMarkets: 2 })).checked).toBe(1);
    });

    test("a failed check is retried on the next tick", async () => {
      let fail = true;
      const tatum = fakeTatum({
        getMarket: async (id) => {
          if (fail) throw new Error("Tatum 503");
          return resolved(id, "Lakers");
        },
      });
      const ctx = createEngineCtx({ db, tatum, memory: null, now: () => NOW, log: () => {} });
      await trackedMarket(ctx, "m1", 0.41, 0.5, 0.77);
      await processResolutions(ctx, { maxMarkets: 20 });
      fail = false;
      expect((await processResolutions(ctx, { maxMarkets: 20 })).resolved).toBe(1);
    });

    test("stops checking once the credit cap is reached", async () => {
      const tatum = fakeTatum({
        getMarket: async () => {
          throw new CreditCapError("cap reached");
        },
      });
      const ctx = createEngineCtx({ db, tatum, memory: null, now: () => NOW, log: () => {} });
      for (const id of ["a", "b", "c"]) await trackedMarket(ctx, id, 0.41, 0.5, 0.77);
      await processResolutions(ctx, { maxMarkets: 20 });
      expect(tatum.calls).toHaveLength(1);
    });
  });

  describe("markets with picks but no Sharp Line", () => {
    async function pickedMarket() {
      const before = createEngineCtx({ db, tatum: null, memory: null, now: () => CLOSE - 60_000, log: () => {} });
      await upsertMarkets(before, [makeMarket({ id: "m1", closeTime: new Date(CLOSE).toISOString() })]);
      return createPick(before, { handle: "ravi", marketId: "m1", outcomeIndex: 0, confidence: 0.7 });
    }

    test("the pick settles when the market resolves", async () => {
      await pickedMarket();
      const report = await processResolutions(ctxWith(async (id) => resolved(id, "Lakers")), { maxMarkets: 20 });
      expect(report).toMatchObject({ checked: 1, resolved: 1, lessons: 0 });
      const [pick] = await db.select().from(picks);
      expect(pick).toMatchObject({ status: "won", y: 1 });
      expect((await db.select().from(memories)).map((m) => m.kind)).toContain("scorecard");
    });

    test("no lesson or checkpoint is written, because the trust model did not change", async () => {
      await pickedMarket();
      await processResolutions(ctxWith(async (id) => resolved(id, "Lakers")), { maxMarkets: 20 });
      expect(await db.select().from(checkpoints)).toHaveLength(0);
      expect((await db.select().from(memories)).some((m) => m.kind === "lesson")).toBe(false);
      expect(await db.select().from(lambdas)).toHaveLength(0);
    });

    test("a market with neither a line nor an open pick is not checked", async () => {
      const ctx = ctxWith(async () => {
        throw new Error("should not be called");
      });
      await upsertMarkets(ctx, [makeMarket({ id: "untracked", closeTime: new Date(CLOSE).toISOString() })]);
      expect((await processResolutions(ctx, { maxMarkets: 20 })).checked).toBe(0);
    });
  });

  test("observationsFor uses the last sharp line before close", async () => {
    const ctx = ctxWith(async (id) => resolved(id, "Lakers"));
    await trackedMarket(ctx, "m1", 0.41, 0.5, 0.77);
    await db.insert(sharpLines).values({ marketId: "m1", snapshotId: "late", ts: CLOSE + 1, priceA: 0.99, consensus: 1, line: 0.99, weight: 3, lambda: 0.25, contributors: [] });
    await processResolutions(ctx, { maxMarkets: 20 });
    expect(await observationsFor(db)).toEqual([{ q: 0.41, s: 0.77, y: 1, group: "SPORTS", resolvedAt: NOW - 60_000 }]);
  });
});
