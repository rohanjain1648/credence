import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export type OutcomeQuote = { name: string; price: number | null; tokenId: string | null };
export type MarketResolution = {
  outcome: string | null;
  resolvedAt: string | null;
  txHash?: string | null;
  source?: string | null;
};
export type Contributor = { address: string; outcomeIndex: 0 | 1; weight: number; credibility: number };

export const markets = sqliteTable("markets", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(),
  eventId: text("event_id"),
  question: text("question").notNull(),
  apiCategory: text("api_category"),
  group: text("group").notNull().default("OTHER"),
  tags: text("tags", { mode: "json" }).$type<string[]>(),
  status: text("status"),
  closeTime: integer("close_time"),
  outcomes: text("outcomes", { mode: "json" }).$type<OutcomeQuote[]>().notNull(),
  volume: real("volume"),
  liquidity: real("liquidity"),
  resolution: text("resolution", { mode: "json" }).$type<MarketResolution>(),
  url: text("url"),
  updatedAt: integer("updated_at").notNull(),
  resolveChecks: integer("resolve_checks").notNull().default(0),
  nextResolveCheckAt: integer("next_resolve_check_at"),
});

export const marketPrices = sqliteTable(
  "market_prices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    marketId: text("market_id").notNull(),
    ts: integer("ts").notNull(),
    prices: text("prices", { mode: "json" }).$type<Array<number | null>>().notNull(),
    source: text("source").notNull(),
  },
  (t) => [index("market_prices_market_ts").on(t.marketId, t.ts)],
);

export const venuePairs = sqliteTable("venue_pairs", {
  polyId: text("poly_id").primaryKey(),
  kalshiId: text("kalshi_id").notNull(),
  flip: integer("flip", { mode: "boolean" }).notNull().default(false),
  score: real("score").notNull(),
  method: text("method").notNull(),
});

export const wallets = sqliteTable("wallets", {
  address: text("address").primaryKey(),
  name: text("name"),
  xUsername: text("x_username"),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  profileImage: text("profile_image"),
  lastHistoryAt: integer("last_history_at"),
  historyStale: integer("history_stale", { mode: "boolean" }).notNull().default(false),
});

export const closedPositions = sqliteTable(
  "closed_positions",
  {
    address: text("address").notNull(),
    conditionId: text("condition_id").notNull(),
    outcomeIndex: integer("outcome_index").notNull(),
    title: text("title"),
    slug: text("slug"),
    eventSlug: text("event_slug"),
    outcome: text("outcome"),
    avgPrice: real("avg_price").notNull(),
    curPrice: real("cur_price").notNull(),
    realizedPnl: real("realized_pnl").notNull(),
    totalBought: real("total_bought").notNull(),
    settledAt: integer("settled_at").notNull(),
    group: text("group").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.address, t.conditionId, t.outcomeIndex] }),
    index("closed_positions_address").on(t.address),
  ],
);

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    marketId: text("market_id").notNull(),
    ts: integer("ts").notNull(),
    kind: text("kind").notNull(),
    prices: text("prices", { mode: "json" }).$type<Array<number | null>>(),
  },
  (t) => [index("snapshots_market_ts").on(t.marketId, t.ts)],
);

export const holderSnapshots = sqliteTable(
  "holder_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    snapshotId: text("snapshot_id").notNull(),
    marketId: text("market_id").notNull(),
    address: text("address").notNull(),
    outcomeIndex: integer("outcome_index").notNull(),
    size: real("size").notNull(),
    avgPrice: real("avg_price"),
    currentValue: real("current_value").notNull(),
  },
  (t) => [index("holder_snapshots_snapshot").on(t.snapshotId), index("holder_snapshots_address").on(t.address)],
);

export const voiceScores = sqliteTable(
  "voice_scores",
  {
    voiceId: text("voice_id").notNull(),
    group: text("group").notNull(),
    asOf: integer("as_of").notNull(),
    n: integer("n").notNull(),
    wins: integer("wins").notNull(),
    edge: real("edge").notNull(),
    z: real("z").notNull(),
    credibility: real("credibility").notNull(),
    pnl: real("pnl").notNull(),
    volume: real("volume").notNull(),
  },
  (t) => [primaryKey({ columns: [t.voiceId, t.group, t.asOf] })],
);

export const sharpLines = sqliteTable(
  "sharp_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    marketId: text("market_id").notNull(),
    snapshotId: text("snapshot_id").notNull(),
    ts: integer("ts").notNull(),
    priceA: real("price_a").notNull(),
    consensus: real("consensus"),
    line: real("line"),
    weight: real("weight").notNull(),
    lambda: real("lambda").notNull(),
    contributors: text("contributors", { mode: "json" }).$type<Contributor[]>().notNull(),
    callMemoryId: text("call_memory_id"),
  },
  (t) => [index("sharp_lines_market_ts").on(t.marketId, t.ts)],
);

export const lambdas = sqliteTable(
  "lambdas",
  {
    group: text("group").notNull(),
    asOf: integer("as_of").notNull(),
    lambda: real("lambda").notNull(),
    n: integer("n").notNull(),
    brierMarket: real("brier_market"),
    brierCredence: real("brier_credence"),
  },
  (t) => [primaryKey({ columns: [t.group, t.asOf] })],
);

export const picks = sqliteTable(
  "picks",
  {
    id: text("id").primaryKey(),
    handle: text("handle").notNull(),
    marketId: text("market_id").notNull(),
    outcomeIndex: integer("outcome_index").notNull(),
    outcomeName: text("outcome_name").notNull(),
    confidence: real("confidence").notNull(),
    reason: text("reason"),
    priceAtPick: real("price_at_pick").notNull(),
    kalshiAtPick: real("kalshi_at_pick"),
    lineAtPick: real("line_at_pick"),
    createdAt: integer("created_at").notNull(),
    status: text("status").notNull().default("open"),
    settledAt: integer("settled_at"),
    y: real("y"),
    edge: real("edge"),
    brierUser: real("brier_user"),
    brierMarket: real("brier_market"),
    memoryId: text("memory_id"),
    receiptId: text("receipt_id"),
  },
  (t) => [index("picks_handle").on(t.handle), index("picks_market").on(t.marketId)],
);

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    namespace: text("namespace").notNull(),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    status: text("status").notNull().default("queued"),
    jobId: text("job_id"),
    blobId: text("blob_id"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    effect: text("effect", { mode: "json" }),
    createdAt: integer("created_at").notNull(),
    sentAt: integer("sent_at"),
    storedAt: integer("stored_at"),
  },
  (t) => [index("memories_status").on(t.status), index("memories_ref").on(t.refType, t.refId)],
);

export const checkpoints = sqliteTable("checkpoints", {
  seq: integer("seq").primaryKey(),
  ts: integer("ts").notNull(),
  memoryId: text("memory_id"),
  prevBlobId: text("prev_blob_id"),
  payload: text("payload", { mode: "json" }).notNull(),
});

export const receipts = sqliteTable("receipts", {
  id: text("id").primaryKey(),
  kind: integer("kind").notNull(),
  refId: text("ref_id").notNull(),
  digest: text("digest").notNull(),
  txDigest: text("tx_digest"),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
});

export const apiUsage = sqliteTable(
  "api_usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    endpoint: text("endpoint").notNull(),
    credits: integer("credits").notNull(),
    status: integer("status").notNull(),
    ts: integer("ts").notNull(),
  },
  (t) => [index("api_usage_ts").on(t.ts)],
);

export const kv = sqliteTable("kv", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
