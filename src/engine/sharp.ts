import { and, desc, eq } from "drizzle-orm";
import { holderSnapshots, lambdas, markets, sharpLines, snapshots } from "@/lib/db/schema";
import type { Group } from "@/lib/scoring/categorize";
import { LAMBDA_PRIOR } from "@/lib/scoring/learning";
import { computeSharpLine } from "@/lib/scoring/sharpLine";
import type { EngineCtx } from "./ctx";
import { latestCredibility } from "./voices";

export type SharpLineRow = typeof sharpLines.$inferSelect;

export async function getLambda(ctx: EngineCtx, group: Group): Promise<number> {
  const [row] = await ctx.db.select().from(lambdas).where(eq(lambdas.group, group)).orderBy(desc(lambdas.asOf)).limit(1);
  return row?.lambda ?? LAMBDA_PRIOR;
}

/** Sharp Line for one holder snapshot, using each holder's remembered credibility in the market's category. */
export async function computeAndStoreSharpLine(ctx: EngineCtx, marketId: string, snapshotId: string): Promise<SharpLineRow | null> {
  const [market] = await ctx.db.select().from(markets).where(eq(markets.id, marketId));
  const [snapshot] = await ctx.db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.id, snapshotId), eq(snapshots.marketId, marketId)));
  if (!market || !snapshot || market.outcomes.length !== 2) return null;

  const priceA = snapshot.prices?.[0] ?? market.outcomes[0].price;
  if (priceA == null) return null;

  const group = market.group as Group;
  const holders = await ctx.db.select().from(holderSnapshots).where(eq(holderSnapshots.snapshotId, snapshotId));
  const withCredibility = await Promise.all(
    holders.map(async (h) => ({
      address: h.address,
      outcomeIndex: h.outcomeIndex as 0 | 1,
      currentValue: h.currentValue,
      credibility: await latestCredibility(ctx, h.address, group),
    })),
  );
  const lambda = await getLambda(ctx, group);
  const result = computeSharpLine(priceA, withCredibility, lambda);

  const [row] = await ctx.db
    .insert(sharpLines)
    .values({
      marketId,
      snapshotId,
      ts: snapshot.ts,
      priceA,
      consensus: result.consensus,
      line: result.line,
      weight: result.weight,
      lambda,
      contributors: result.contributors,
    })
    .returning();
  return row;
}
