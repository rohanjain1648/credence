import type { z } from "zod";

export type Query = Record<string, string | number | boolean | null | undefined>;
export type UsageEvent = { endpoint: string; credits: number; status: number; ts: number };

export type TatumHttpOptions = {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRps?: number;
  dailyCreditCap?: number;
  creditsUsedToday?: () => Promise<number>;
  onUsage?: (u: UsageEvent) => Promise<void> | void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export class TatumError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "TatumError";
  }
}

export class CreditCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditCapError";
  }
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1000, 2000];
const REQUEST_TIMEOUT_MS = 20_000;

/** `/markets/0xabc/positions` → `/markets/:id/positions`, so usage groups by endpoint, not by market. */
function endpointLabel(path: string): string {
  return path
    .split("/")
    .map((seg) => (seg === "" || /^[a-z-]+$/.test(seg) ? seg : ":id"))
    .join("/");
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export class TatumHttp {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly intervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private nextSlot = 0;

  constructor(private readonly o: TatumHttpOptions) {
    this.baseUrl = o.baseUrl ?? "https://api.tatum.io/v4/data/prediction";
    this.fetchImpl = o.fetchImpl ?? fetch;
    // Tatum's free plan answers 429 above 3 requests per second; keep a margin for network jitter.
    this.intervalMs = 1000 / (o.maxRps ?? 2.5);
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
  }

  async get<T>(path: string, query: Query, opts: { credits: number; schema: z.ZodType<T> }): Promise<T> {
    if (this.o.dailyCreditCap !== undefined && this.o.creditsUsedToday) {
      const used = await this.o.creditsUsedToday();
      if (used + opts.credits > this.o.dailyCreditCap) {
        throw new CreditCapError(`Tatum daily credit cap reached (${used}/${this.o.dailyCreditCap})`);
      }
    }

    const url = this.buildUrl(path, query);
    const endpoint = endpointLabel(path);
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await this.sleep(jitter(BACKOFF_MS[attempt - 1]));
      await this.waitForSlot();

      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          headers: { "x-api-key": this.o.apiKey, accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        lastError = err;
        continue;
      }

      const body = await readBody(res);
      await this.o.onUsage?.({ endpoint, credits: res.ok ? opts.credits : 0, status: res.status, ts: this.now() });

      if (res.ok) return opts.schema.parse(body);

      lastError = new TatumError(`Tatum ${res.status} on ${endpoint}`, res.status, body);
      if (!isRetryable(res.status)) throw lastError;
    }

    if (lastError instanceof TatumError) throw lastError;
    throw new TatumError(`Tatum request failed on ${endpoint}: ${String(lastError)}`, 0, null);
  }

  private buildUrl(path: string, query: Query): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.append(k, String(v));
    }
    const qs = params.toString();
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;
  }

  /** Spaces request starts `1000 / maxRps` ms apart, including across concurrent callers. */
  private async waitForSlot(): Promise<void> {
    const now = this.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.intervalMs;
    if (slot > now) await this.sleep(slot - now);
  }
}

function jitter(ms: number): number {
  return ms * (0.8 + Math.random() * 0.4);
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
