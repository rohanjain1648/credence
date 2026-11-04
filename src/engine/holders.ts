import { eq, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { holderSnapshots, markets, snapshots, wallets } from "@/lib/db/schema";
import type { EngineCtx } from "./ctx";

export type SnapshotKind = "routine" | "final" | "election";

/** Records who holds each side of a market right now. Positions only exist for Polymarket. */
export async function snapshotHolders(
  ctx: EngineCtx,
  marketId: string,
  kind: SnapshotKind,
): Promise<{ snapshotId: string; holders: number }> {
  const [market] = await ctx.db.select().from(markets).where(eq(markets.id, marketId));
  if (!market) throw new Error(`Market ${marketId} not found`);
  if (market.platform !== "polymarket" || !ctx.tatum) return { snapshotId: "", holders: 0 };

  const groups = await ctx.tatum.getMarketPositions(marketId, { status: "OPEN", sortBy: "TOKENS", limit: 50 });
  const snapshotId = ulid();
  const ts = ctx.now();
  await ctx.db.insert(snapshots).values({ id: snapshotId, marketId, ts, kind, prices: market.outcomes.map((o) => o.price) });

  const rows = groups
    .flatMap((g) => g.positions)
    .filter((h) => h.outcomeIndex === 0 || h.outcomeIndex === 1)
    .map((h) => ({
      snapshotId,
      marketId,
      address: h.proxyWallet.toLowerCase(),
      outcomeIndex: h.outcomeIndex,
      size: h.size,
      avgPrice: h.avgPrice ?? null,
      currentValue: h.currentValue,
      name: h.name ?? null,
      profileImage: h.profileImage ?? null,
      verified: Boolean(h.verified),
    }));
  if (rows.length === 0) return { snapshotId, holders: 0 };

  await ctx.db.insert(holderSnapshots).values(rows.map(({ name: _n, profileImage: _p, verified: _v, ...r }) => r));
  await ctx.db
    .insert(wallets)
    .values(rows.map((r) => ({ address: r.address, name: r.name, profileImage: r.profileImage, verified: r.verified })))
    .onConflictDoUpdate({
      target: wallets.address,
      set: {
        name: sql`coalesce(excluded.name, ${wallets.name})`,
        profileImage: sql`coalesce(excluded.profile_image, ${wallets.profileImage})`,
      },
    });
  return { snapshotId, holders: rows.length };
}
