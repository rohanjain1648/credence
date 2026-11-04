import { z } from "zod";

/** Tatum sometimes serialises numbers as strings; accept both. */
const num = z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number());
const nstr = z.string().nullable().optional();
const nnum = num.nullable().optional();

export const OutcomeSchema = z.looseObject({
  name: z.string(),
  price: nnum,
  tokenId: nstr,
});

export const MarketSchema = z.looseObject({
  id: z.string(),
  platform: z.string(),
  eventId: nstr,
  question: z.string(),
  description: nstr,
  category: nstr,
  tags: z.array(z.string()).nullable().optional(),
  imageUrl: nstr,
  status: nstr,
  openTime: nstr,
  closeTime: nstr,
  settleTime: nstr,
  createdAt: nstr,
  outcomes: z.array(OutcomeSchema),
  volume: nnum,
  volumeUnit: nstr,
  liquidity: nnum,
  resolution: z
    .looseObject({ outcome: nstr, resolvedAt: nstr, txHash: nstr, source: nstr })
    .nullable()
    .optional(),
  source: z.looseObject({ platform: nstr, platformId: nstr, url: nstr }).nullable().optional(),
  chain: z.looseObject({}).nullable().optional(),
});

export const HolderSchema = z.looseObject({
  proxyWallet: z.string(),
  name: nstr,
  profileImage: nstr,
  verified: z.boolean().nullable().optional(),
  asset: z.string(),
  conditionId: z.string(),
  avgPrice: nnum,
  size: num,
  currPrice: nnum,
  currentValue: num,
  cashPnl: nnum,
  totalBought: nnum,
  realizedPnl: nnum,
  totalPnl: nnum,
  outcome: nstr,
  outcomeIndex: num,
});

export const OutcomePositionsSchema = z.looseObject({
  token: z.string(),
  positions: z.array(HolderSchema),
});

export const ClosedPositionSchema = z.looseObject({
  proxyWallet: z.string(),
  asset: z.string(),
  conditionId: z.string(),
  avgPrice: num,
  totalBought: num,
  realizedPnl: num,
  curPrice: num,
  timestamp: num,
  title: nstr,
  slug: nstr,
  icon: nstr,
  eventSlug: nstr,
  outcome: nstr,
  outcomeIndex: num,
  oppositeOutcome: nstr,
  oppositeAsset: nstr,
  endDate: nstr,
});

export const TopTraderSchema = z.looseObject({
  rank: num,
  proxyWallet: z.string(),
  userName: nstr,
  xUsername: nstr,
  verifiedBadge: z.boolean().nullable().optional(),
  vol: num,
  pnl: num,
  profileImage: nstr,
});

export const CandleSchema = z.looseObject({
  timestamp: z.string(),
  open: num,
  high: num,
  low: num,
  close: num,
  volume: nnum,
});

export const PriceHistorySchema = z.looseObject({
  marketId: z.string(),
  platform: z.string(),
  interval: z.string(),
  source: nstr,
  candles: z.array(CandleSchema),
  partial: z.boolean().nullable().optional(),
  availableFrom: nstr,
});

const PaginationSchema = z.looseObject({ cursor: nstr, pageSize: nnum, pageNumber: nnum }).nullable().optional();

export const pageOf = <T extends z.ZodType>(item: T) => z.looseObject({ data: z.array(item), pagination: PaginationSchema });

/** Accepts either `{ data: X }` or a bare `X`. */
export const envelopeOf = <T extends z.ZodType>(item: T) =>
  z.union([z.looseObject({ data: item }).transform((d) => d.data as z.infer<T>), item]);

export type Market = z.infer<typeof MarketSchema>;
export type Holder = z.infer<typeof HolderSchema>;
export type OutcomePositions = z.infer<typeof OutcomePositionsSchema>;
export type ClosedPosition = z.infer<typeof ClosedPositionSchema>;
export type TopTrader = z.infer<typeof TopTraderSchema>;
export type PriceHistory = z.infer<typeof PriceHistorySchema>;
