import type { Holder, Market } from "@/lib/tatum/prediction";

export const NOW = Date.parse("2026-11-01T12:00:00Z");

export function makeMarket(o: Partial<Market> = {}): Market {
  return {
    id: "0xmarket1",
    platform: "polymarket",
    eventId: "100",
    question: "Lakers vs. Celtics",
    description: null,
    category: null,
    tags: [],
    imageUrl: null,
    status: "active",
    openTime: null,
    closeTime: "2026-11-04T23:00:00Z",
    settleTime: null,
    createdAt: null,
    outcomes: [
      { name: "Lakers", price: 0.41, tokenId: "t0" },
      { name: "Celtics", price: 0.59, tokenId: "t1" },
    ],
    volume: 250_000,
    volumeUnit: "usd",
    liquidity: 10_000,
    resolution: null,
    source: { platform: "polymarket", platformId: "0xmarket1", url: "https://polymarket.com/event/nba-lal-bos-2026-11-04" },
    chain: null,
    ...o,
  };
}

export function makeHolder(o: Partial<Holder> = {}): Holder {
  return {
    proxyWallet: "0xaaa",
    name: null,
    profileImage: null,
    verified: false,
    asset: "t0",
    conditionId: "0xmarket1",
    avgPrice: 0.4,
    size: 1000,
    currPrice: 0.41,
    currentValue: 410,
    cashPnl: 10,
    totalBought: 400,
    realizedPnl: 0,
    totalPnl: 10,
    outcome: "Lakers",
    outcomeIndex: 0,
    ...o,
  };
}
