import type { TatumHttp } from "./http";
import {
  ClosedPositionSchema,
  envelopeOf,
  MarketSchema,
  OutcomePositionsSchema,
  pageOf,
  PriceHistorySchema,
  TopTraderSchema,
  type ClosedPosition,
  type Market,
  type OutcomePositions,
  type PriceHistory,
  type TopTrader,
} from "./schemas";

export type { ClosedPosition, Holder, Market, OutcomePositions, PriceHistory, TopTrader } from "./schemas";

export type LeaderboardCategory =
  | "OVERALL"
  | "POLITICS"
  | "SPORTS"
  | "CRYPTO"
  | "CULTURE"
  | "MENTIONS"
  | "WEATHER"
  | "ECONOMICS"
  | "TECH"
  | "FINANCE";

export type ListMarketsQuery = {
  platform?: "polymarket" | "kalshi";
  status?: "active" | "closed" | "resolved";
  category?: string;
  tag?: string;
  eventId?: string;
  search?: string;
  endingBefore?: string;
  minVolume?: number;
  sort?: "volume_desc" | "liquidity_desc" | "endingSoon" | "newest";
  cursor?: string;
  limit?: number;
};

export type PriceHistoryQuery = {
  interval: "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";
  start: string;
  end: string;
  source?: "candlesticks" | "midpoint";
};

export type PositionsQuery = {
  status?: "OPEN" | "CLOSED" | "ALL";
  sortBy?: "TOKENS" | "CASH_PNL" | "REALIZED_PNL" | "TOTAL_PNL";
  limit?: number;
  offset?: number;
};

export type WalletHistoryQuery = {
  limit?: number;
  offset?: number;
  sortBy?: "TIMESTAMP" | "REALIZEDPNL";
  sortDirection?: "ASC" | "DESC";
};

export type TopTradersQuery = {
  category?: LeaderboardCategory;
  timePeriod?: "DAY" | "WEEK" | "MONTH" | "ALL";
  orderBy?: "PNL" | "VOL";
  limit?: number;
  offset?: number;
};

export type PredictionApi = {
  listMarkets(q: ListMarketsQuery): Promise<{ data: Market[]; cursor?: string }>;
  getMarket(id: string): Promise<Market>;
  getPriceHistory(id: string, q: PriceHistoryQuery): Promise<PriceHistory>;
  getMarketPositions(id: string, q: PositionsQuery): Promise<OutcomePositions[]>;
  getWalletHistory(address: string, q: WalletHistoryQuery): Promise<ClosedPosition[]>;
  getTopTraders(q: TopTradersQuery): Promise<TopTrader[]>;
};

export const CREDITS = {
  market: 100,
  positions: 100,
  walletHistory: 100,
  topTraders: 200,
  priceHistory: 200,
} as const;

/** Tatum's reference page lists `/markets/{id}/history`; verified against the live API in Task 5. */
export const PRICE_HISTORY_PATH = (id: string) => `/markets/${encodeURIComponent(id)}/history`;

export function createPredictionApi(http: TatumHttp): PredictionApi {
  return {
    async listMarkets(q) {
      const res = await http.get("/markets", q, { credits: CREDITS.market, schema: pageOf(MarketSchema) });
      return { data: res.data, cursor: res.pagination?.cursor ?? undefined };
    },
    getMarket(id) {
      return http.get(`/markets/${encodeURIComponent(id)}`, {}, { credits: CREDITS.market, schema: envelopeOf(MarketSchema) });
    },
    getPriceHistory(id, q) {
      return http.get(PRICE_HISTORY_PATH(id), q, { credits: CREDITS.priceHistory, schema: envelopeOf(PriceHistorySchema) });
    },
    async getMarketPositions(id, q) {
      const res = await http.get(`/markets/${encodeURIComponent(id)}/positions`, q, {
        credits: CREDITS.positions,
        schema: pageOf(OutcomePositionsSchema),
      });
      return res.data;
    },
    async getWalletHistory(address, q) {
      const res = await http.get(`/wallets/${address}/history`, q, {
        credits: CREDITS.walletHistory,
        schema: pageOf(ClosedPositionSchema),
      });
      return res.data;
    },
    async getTopTraders(q) {
      const res = await http.get("/top-traders", q, { credits: CREDITS.topTraders, schema: pageOf(TopTraderSchema) });
      return res.data;
    },
  };
}
