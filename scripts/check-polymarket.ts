/**
 * Checks the Polymarket v2 wallet-data client against the live API, with no keys.
 * Polymarket is blocked in some countries (including India), so run it from a server elsewhere:
 *   npx tsx scripts/check-polymarket.ts
 */
import { createPolymarketWalletApi } from "@/lib/polymarket/dataApi";
import { scoreBets } from "@/lib/scoring/credibility";
import { categorize } from "@/lib/scoring/categorize";

async function main() {
  const api = createPolymarketWalletApi();
  const leaders = await api.getTopTraders({ category: "SPORTS", timePeriod: "MONTH", orderBy: "PNL", limit: 3 });
  console.log(`leaderboard: ${leaders.length} rows, top ${leaders[0]?.userName ?? leaders[0]?.proxyWallet}`);

  const wallet = leaders[0].proxyWallet;
  const page1 = await api.getWalletHistory(wallet, { limit: 50, offset: 0 });
  const page2 = await api.getWalletHistory(wallet, { limit: 50, offset: 50 });
  console.log(`wallet history: ${page1.length} rows on page 1, ${page2.length} on page 2`);
  const bets = [...page1, ...page2].map((r) => ({
    avgPrice: r.avgPrice,
    resolution: r.curPrice,
    totalBought: r.totalBought,
    settledAt: r.timestamp * 1000,
    group: categorize({ title: r.title, slug: r.slug, eventSlug: r.eventSlug }),
    realizedPnl: r.realizedPnl,
  }));
  const s = scoreBets(bets);
  console.log(`credibility from those bets: ${s.credibility.toFixed(1)} over ${s.n} counted bets, edge ${(s.edge * 100).toFixed(1)} pts`);

  const condition = page1.find((r) => r.conditionId)?.conditionId ?? "0x5db999fad322cea2914535aae5517060c3f80ad6d8c0231cde2124a434d16846";
  const groups = await api.getMarketPositions("0x5db999fad322cea2914535aae5517060c3f80ad6d8c0231cde2124a434d16846", { limit: 50 });
  console.log(`holders: ${groups.map((g) => `${g.positions.length} on outcome ${g.positions[0]?.outcomeIndex}`).join(", ")} (sample condition ${condition.slice(0, 10)}…)`);
  const top = groups[0]?.positions[0];
  if (top) console.log(`top holder ${top.proxyWallet.slice(0, 10)}… value $${Math.round(top.currentValue)} avg ${top.avgPrice}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
