export type FakeResponse = { status: number; body?: unknown } | Error;
export type FakeCall = { url: string; headers: Record<string, string> };
export type FakeFetch = typeof fetch & { calls: FakeCall[] };

export function fakeFetch(responses: FakeResponse[]): FakeFetch {
  const calls: FakeCall[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const r = responses.shift() ?? { status: 500, body: { message: "no more fake responses" } };
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }) as FakeFetch;
  f.calls = calls;
  return f;
}
