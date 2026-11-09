import { z } from "zod";
import type { ClosedPosition, OutcomePositions, PredictionApi, TopTrader } from "@/lib/tatum/prediction";

/**
 * Polymarket's public Data API v2, used for wallet data while Tatum's wallet endpoints are down.
 * v1, which those endpoints appear to depend on, now answers 410 "Data API v1 has been retired".
 * Responses are mapped to the shapes Tatum returns, so the engine doesn't change.
 */
export type WalletApi = Pick<PredictionApi, "getMarketPositions" | "getWalletHistory" | "getTopTraders">;

export class PolymarketError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "PolymarketError";
  }
}

const BASE = "https://data-api.polymarket.com/v2";
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1000];
const TIMEOUT_MS = 20_000;
/** With include_pnl=true, v2 serves at most 100 holders per outcome. */
const MAX_HOLDERS = 100;

const num = z.number().nullable().optional();
const str = z.string().nullable().optional();
const Pagination = z.looseObject({ next_cursor: str, has_more: z.boolean().optional() }).optional();
const pageOf = <T extends z.ZodType>(item: T) => z.looseObject({ data: z.array(item), pagination: Pagination });

const HolderV2 = z.looseObject({
  proxy_wallet: z.string(),
  name: str,
  pseudonym: str,
  profile_image: str,
  verified: z.boolean().nullable().optional(),
  token_id: z.string(),
  amount: z.number(),
  avg_price: num,
  current_price: num,
  current_value: num,
  entry_cost_usdc: num,
  realized_pnl: num,
  unrealized_pnl: num,
  total_pnl: num,
  outcome_index: z.number(),
});
const HoldersPage = pageOf(z.looseObject({ token_id: z.string(), holders: z.array(HolderV2) }));

const PositionV2 = z.looseObject({
  proxy_wallet: z.string(),
  condition_id: z.string(),
  token_id: z.string(),
  avg_price: z.number(),
  current_price: z.number(),
  realized_pnl: z.number(),
  total_cost_usdc: num,
  total_size: num,
  last_event_at: num,
  title: str,
  slug: str,
  event_slug: str,
  icon: str,
  outcome: str,
  outcome_index: z.number(),
  opposite_outcome: str,
  opposite_token_id: str,
  end_date: str,
});
const PositionsPage = pageOf(PositionV2);

const LeaderV2 = z.looseObject({
  rank: z.number(),
  user_id: z.string(),
  user_name: str,
  x_username: str,
  verified: z.boolean().nullable().optional(),
  pnl: z.number(),
  volume: z.number(),
  profile_image: str,
});
const LeaderPage = pageOf(LeaderV2);

const blank = (s: string | null | undefined) => (s ? s : null);

export function createPolymarketWalletApi(
  o: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxRps?: number } = {},
): WalletApi {
  const fetchImpl = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const intervalMs = 1000 / (o.maxRps ?? 5);
  let nextSlot = 0;
  /** v2 pages with opaque cursors; the engine pages with offsets, so remember where each offset starts. */
  const cursors = new Map<string, string>();

  async function get<T>(path: string, query: Record<string, string | number | boolean | undefined>, schema: z.ZodType<T>): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) params.append(k, String(v));
    const url = `${BASE}${path}?${params}`;
    let last: PolymarketError | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1] ?? 2000);
      const now = Date.now();
      const slot = Math.max(now, nextSlot);
      nextSlot = slot + intervalMs;
      if (slot > now) await sleep(slot - now);
      let res: Response;
      try {
        res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (err) {
        last = new PolymarketError(`Polymarket request failed on ${path}: ${String(err)}`, 0, null);
        continue;
      }
      const body = await res.json().catch(() => null);
      if (res.ok) return schema.parse(body);
      last = new PolymarketError(`Polymarket ${res.status} on ${path}`, res.status, body);
      if (res.status !== 429 && res.status < 500) throw last;
    }
    throw last!;
  }

  async function positions(user: string, status: "CLOSED" | "REDEEMABLE", limit: number, key: string, cursor?: string) {
    const res = cursor
      ? await get("/positions", { user, cursor }, PositionsPage)
      : await get("/positions", { user, status, sort_by: "TIMESTAMP", sort_direction: "DESC", limit }, PositionsPage);
    if (res.pagination?.next_cursor) cursors.set(key, res.pagination.next_cursor);
    return res.data;
  }

  const toClosed = (p: z.infer<typeof PositionV2>): ClosedPosition => ({
    proxyWallet: p.proxy_wallet,
    asset: p.token_id,
    conditionId: p.condition_id,
    avgPrice: p.avg_price,
    // A fully exited position reports no remaining cost, so its stake is rebuilt from size and entry price.
    totalBought: p.total_cost_usdc ? p.total_cost_usdc : (p.total_size ?? 0) * p.avg_price,
    realizedPnl: p.realized_pnl,
    curPrice: p.current_price,
    timestamp: p.last_event_at ?? 0,
    title: p.title ?? null,
    slug: p.slug ?? null,
    icon: p.icon ?? null,
    eventSlug: p.event_slug ?? null,
    outcome: p.outcome ?? null,
    outcomeIndex: p.outcome_index,
    oppositeOutcome: p.opposite_outcome ?? null,
    oppositeAsset: p.opposite_token_id ?? null,
    endDate: p.end_date ?? null,
  });

  return {
    async getMarketPositions(id, q): Promise<OutcomePositions[]> {
      const res = await get("/holders", { condition: id, limit: Math.min(q.limit ?? 50, MAX_HOLDERS), include_pnl: true }, HoldersPage);
      return res.data.map((group) => ({
        token: group.token_id,
        positions: group.holders.map((h) => ({
          proxyWallet: h.proxy_wallet.toLowerCase(),
          name: blank(h.name) ?? blank(h.pseudonym),
          profileImage: blank(h.profile_image),
          verified: Boolean(h.verified),
          asset: h.token_id,
          conditionId: id,
          avgPrice: h.avg_price ?? null,
          size: h.amount,
          currPrice: h.current_price ?? null,
          currentValue: h.current_value ?? h.amount * (h.current_price ?? 0),
          cashPnl: h.unrealized_pnl ?? null,
          totalBought: h.entry_cost_usdc ?? null,
          realizedPnl: h.realized_pnl ?? null,
          totalPnl: h.total_pnl ?? null,
          outcome: null,
          outcomeIndex: h.outcome_index,
        })),
      }));
    },

    async getWalletHistory(address, q): Promise<ClosedPosition[]> {
      const limit = q.limit ?? 50;
      const offset = q.offset ?? 0;
      const user = address.toLowerCase();
      if (offset === 0) {
        // Settled bets are positions sold or redeemed (CLOSED), plus results not yet redeemed (REDEEMABLE).
        const closed = await positions(user, "CLOSED", limit, `${user}:CLOSED:${limit}`);
        const unredeemed = await positions(user, "REDEEMABLE", limit, `${user}:REDEEMABLE:${limit}`);
        return [...closed, ...unredeemed].map(toClosed);
      }
      const cursor = cursors.get(`${user}:CLOSED:${offset}`);
      if (!cursor) return [];
      return (await positions(user, "CLOSED", limit, `${user}:CLOSED:${offset + limit}`, cursor)).map(toClosed);
    },

    async getTopTraders(q): Promise<TopTrader[]> {
      const res = await get(
        "/leaderboard",
        {
          time_period: q.timePeriod?.toLowerCase(),
          category: q.category?.toLowerCase(),
          sort_by: q.orderBy === "VOL" ? "VOLUME" : q.orderBy,
          limit: q.limit,
        },
        LeaderPage,
      );
      return res.data.map((r) => ({
        rank: r.rank,
        proxyWallet: r.user_id,
        userName: blank(r.user_name),
        xUsername: blank(r.x_username),
        verifiedBadge: Boolean(r.verified),
        vol: r.volume,
        pnl: r.pnl,
        profileImage: blank(r.profile_image),
      }));
    },
  };
}
