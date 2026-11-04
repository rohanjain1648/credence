import type { Db } from "@/lib/db/client";
import { holderSnapshots, snapshots, voiceScores } from "@/lib/db/schema";
import { NOW } from "./factories";

/** A snapshot of holders, each with an optional SPORTS credibility (n = 40). */
export async function seedSnapshot(
  database: Db,
  o: { marketId?: string; snapshotId?: string; prices?: Array<number | null>; holders: Array<[string, 0 | 1, number, number | null]> },
) {
  const marketId = o.marketId ?? "0xmarket1";
  const snapshotId = o.snapshotId ?? "snap1";
  await database.insert(snapshots).values({ id: snapshotId, marketId, ts: NOW - 60_000, kind: "election", prices: o.prices ?? [0.5, 0.5] });
  for (const [address, outcomeIndex, value, credibility] of o.holders) {
    await database.insert(holderSnapshots).values({ snapshotId, marketId, address, outcomeIndex, size: value, avgPrice: 0.5, currentValue: value });
    if (credibility !== null) {
      await database.insert(voiceScores).values({ voiceId: address, group: "SPORTS", asOf: NOW - 120_000, n: 40, wins: 20, edge: 0, z: 0, credibility, pnl: 0, volume: 0 });
    }
  }
  return snapshotId;
}
