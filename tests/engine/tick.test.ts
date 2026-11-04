import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/lib/db/client";
import { memories, snapshots } from "@/lib/db/schema";
import { enqueueMemory } from "@/lib/memory/writer";
import { createEngineCtx } from "@/engine/ctx";
import { upsertMarkets } from "@/engine/markets";
import { runTick } from "@/engine/tick";
import { createTestDb } from "../helpers/db";
import { makeMarket, NOW } from "../helpers/factories";
import { fakeMemory } from "../helpers/fakeMemory";
import { fakeTatum } from "../helpers/fakeTatum";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

const stage = (report: Awaited<ReturnType<typeof runTick>>, name: string) => report.stages.find((s) => s.name === name)!;

describe("snapshots", () => {
  const closingIn = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString();
  const positionCalls = (t: ReturnType<typeof fakeTatum>) => t.calls.filter((c) => c.method === "getMarketPositions").map((c) => c.args[0]);
  const noMarkets = { listMarkets: async () => ({ data: [] }) };
  const ctxFor = (tatum: ReturnType<typeof fakeTatum>) => createEngineCtx({ db, tatum, memory: null, now: () => NOW, log: () => {} });

  test("routine snapshots retry on the next tick when all of them failed", async () => {
    let fail = true;
    const tatum = fakeTatum({
      ...noMarkets,
      getMarketPositions: async () => {
        if (fail) throw new Error("Tatum 500 on /markets/:id/positions");
        return [];
      },
    });
    const ctx = ctxFor(tatum);
    await upsertMarkets(ctx, [makeMarket({ id: "a", closeTime: closingIn(24) })]);

    expect(stage(await runTick(ctx), "snapshots").detail).toMatchObject({ routine: expect.stringContaining("Tatum 500") });
    fail = false;
    expect(stage(await runTick(ctx), "snapshots").detail).toMatchObject({ routine: 1 });
  });

  test("a partial failure counts as a completed run", async () => {
    const tatum = fakeTatum({
      ...noMarkets,
      getMarketPositions: async (id) => {
        if (id === "a") throw new Error("Tatum 500");
        return [];
      },
    });
    const ctx = ctxFor(tatum);
    await upsertMarkets(ctx, [
      makeMarket({ id: "a", closeTime: closingIn(24), volume: 200 }),
      makeMarket({ id: "b", closeTime: closingIn(24), volume: 100 }),
    ]);
    expect(stage(await runTick(ctx), "snapshots").detail).toMatchObject({ routine: 1 });
    expect(stage(await runTick(ctx), "snapshots").detail).toMatchObject({ routine: "not due" });
  });

  test("gives up after 3 failures in a row, so an outage can't stall the tick", async () => {
    const tatum = fakeTatum({
      ...noMarkets,
      getMarketPositions: async () => {
        throw new Error("Tatum 500");
      },
    });
    const ctx = ctxFor(tatum);
    await upsertMarkets(ctx, ["a", "b", "c", "d", "e"].map((id) => makeMarket({ id, closeTime: closingIn(24) })));
    await runTick(ctx);
    expect(positionCalls(tatum)).toHaveLength(3);
  });

  test("final snapshots take the biggest markets first and are limited per tick", async () => {
    const tatum = fakeTatum({ ...noMarkets, getMarketPositions: async () => [] });
    const ctx = ctxFor(tatum);
    await upsertMarkets(ctx, Array.from({ length: 25 }, (_, i) => makeMarket({ id: `m${i}`, closeTime: closingIn(0.5), volume: i })));

    expect(stage(await runTick(ctx), "snapshots").detail).toMatchObject({ final: 20 });
    const finals = await db.select().from(snapshots).where(eq(snapshots.kind, "final"));
    expect(finals.map((s) => s.marketId)).toContain("m24");
    expect(finals.map((s) => s.marketId)).not.toContain("m0");

    expect(stage(await runTick(ctx), "snapshots").detail).toMatchObject({ final: 5 });
    expect(stage(await runTick(ctx), "snapshots").detail).toMatchObject({ final: 0 });
  });
});

describe("tick", () => {
  test("runs stages in order", async () => {
    const tatum = fakeTatum({ listMarkets: async () => ({ data: [] }) });
    const report = await runTick(createEngineCtx({ db, tatum, memory: fakeMemory(), now: () => NOW, log: () => {} }));
    expect(report.stages.map((s) => s.name)).toEqual([
      "syncMarkets",
      "syncKalshi",
      "snapshots",
      "history",
      "rescore",
      "sharpLines",
      "resolutions",
      "flushMemory",
    ]);
    expect(report.stages.every((s) => s.ok)).toBe(true);
  });

  test("a throwing stage does not stop later stages", async () => {
    const tatum = fakeTatum({
      listMarkets: async () => {
        throw new Error("Tatum 503");
      },
    });
    const report = await runTick(createEngineCtx({ db, tatum, memory: null, now: () => NOW, log: () => {} }));
    expect(stage(report, "syncMarkets")).toMatchObject({ ok: false, error: expect.stringContaining("503") });
    expect(stage(report, "resolutions").ok).toBe(true);
    expect(stage(report, "flushMemory").ok).toBe(true);
  });

  test("memory null: flush skipped, memories stay queued", async () => {
    await enqueueMemory(db, { namespace: "credence-lessons", kind: "lesson", human: "x", data: {} });
    const report = await runTick(createEngineCtx({ db, tatum: null, memory: null, now: () => NOW, log: () => {} }));
    expect(stage(report, "flushMemory")).toMatchObject({ ok: true, detail: "skipped: memory not configured" });
    expect(stage(report, "syncMarkets")).toMatchObject({ ok: true, detail: "skipped: tatum not configured" });
    const [row] = await db.select().from(memories);
    expect(row.status).toBe("queued");
  });

  test("cadence: second tick within the hour skips syncMarkets", async () => {
    const tatum = fakeTatum({ listMarkets: async () => ({ data: [] }) });
    let now = NOW;
    const ctx = createEngineCtx({ db, tatum, memory: null, now: () => now, log: () => {} });
    await runTick(ctx);
    const callsAfterFirst = tatum.calls.length;
    now += 10 * 60_000;
    const report = await runTick(ctx);
    expect(stage(report, "syncMarkets").detail).toBe("not due");
    expect(tatum.calls.length).toBe(callsAfterFirst);
    now += 50 * 60_000;
    expect(stage(await runTick(ctx), "syncMarkets").detail).not.toBe("not due");
  });

  test("a failed stage is retried on the next tick", async () => {
    let fail = true;
    const tatum = fakeTatum({
      listMarkets: async () => {
        if (fail) throw new Error("boom");
        return { data: [] };
      },
    });
    const ctx = createEngineCtx({ db, tatum, memory: null, now: () => NOW, log: () => {} });
    await runTick(ctx);
    fail = false;
    expect(stage(await runTick(ctx), "syncMarkets")).toMatchObject({ ok: true, detail: { upserted: 0 } });
  });
});
