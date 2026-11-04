import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/lib/db/client";
import { memories, sharpLines } from "@/lib/db/schema";
import { decodeMemory } from "@/lib/memory/format";
import { recordCall } from "@/engine/calls";
import { createEngineCtx, type EngineCtx } from "@/engine/ctx";
import { upsertMarkets } from "@/engine/markets";
import { computeAndStoreSharpLine } from "@/engine/sharp";
import { createTestDb } from "../helpers/db";
import { makeMarket, NOW } from "../helpers/factories";
import { seedSnapshot } from "../helpers/seed";

let db: Db;
let ctx: EngineCtx;

beforeEach(async () => {
  db = await createTestDb();
  ctx = createEngineCtx({ db, tatum: null, memory: null, now: () => NOW, log: () => {} });
  await upsertMarkets(ctx, [makeMarket()]);
});

describe("calls", () => {
  test("call memory text for a line", async () => {
    const snapshotId = await seedSnapshot(db, { holders: [["a", 0, 1000, 80], ["b", 1, 1000, 60]] });
    await computeAndStoreSharpLine(ctx, "0xmarket1", snapshotId);
    const id = await recordCall(ctx, "0xmarket1", "election");
    const [mem] = await db.select().from(memories).where(eq(memories.id, id!));
    expect(mem).toMatchObject({ namespace: "credence-calls", kind: "call", refType: "market", refId: "0xmarket1" });
    const decoded = decodeMemory(mem.text)!;
    expect(decoded.human).toContain("Lakers vs. Celtics");
    expect(decoded.human).toContain("crowd 50%");
    expect(decoded.human).toContain("Sharp Line 60%");
    expect(decoded.data).toMatchObject({ marketId: "0xmarket1", kind: "election", priceA: 0.5, snapshotId, outcomes: ["Lakers", "Celtics"] });
    const [line] = await db.select().from(sharpLines);
    expect(line.callMemoryId).toBe(id);
  });

  test("call memory when no credible money", async () => {
    const snapshotId = await seedSnapshot(db, { holders: [["a", 0, 5, 70]] });
    await computeAndStoreSharpLine(ctx, "0xmarket1", snapshotId);
    const id = await recordCall(ctx, "0xmarket1", "final");
    const [mem] = await db.select().from(memories).where(eq(memories.id, id!));
    expect(decodeMemory(mem.text)!.human).toContain("not enough credible money");
  });

  test("no sharp line yet → no call", async () => {
    expect(await recordCall(ctx, "0xmarket1", "final")).toBeNull();
    expect(await db.select().from(memories)).toHaveLength(0);
  });
});
