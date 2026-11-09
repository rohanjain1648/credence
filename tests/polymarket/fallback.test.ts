import { describe, expect, test } from "vitest";
import { withWalletFallback } from "@/lib/polymarket/fallback";
import { CreditCapError, TatumError } from "@/lib/tatum/http";
import type { PredictionApi } from "@/lib/tatum/prediction";
import { fakeTatum } from "../helpers/fakeTatum";

const MIN = 60_000;
const ok = (tag: string) => async () => [{ tag }] as never;
const fail = (err: Error) => async () => {
  throw err;
};
const tatum500 = new TatumError("Tatum 500 on /top-traders", 500, null);

function setup(primary: Partial<PredictionApi>, mode: "auto" | "tatum" | "polymarket" = "auto") {
  let now = 0;
  const p = fakeTatum({ listMarkets: async () => ({ data: [] }), ...primary });
  const f = fakeTatum({ getTopTraders: ok("polymarket"), getWalletHistory: ok("polymarket"), getMarketPositions: ok("polymarket") });
  const logs: string[] = [];
  const api = withWalletFallback(p, f, { mode, now: () => now, log: (m) => logs.push(m) });
  return { api, p, f, logs, advance: (ms: number) => (now += ms) };
}

describe("wallet data fallback", () => {
  test("auto uses Tatum while it works", async () => {
    const { api, f } = setup({ getTopTraders: ok("tatum") });
    expect(await api.getTopTraders({})).toEqual([{ tag: "tatum" }]);
    expect(f.calls).toHaveLength(0);
  });

  test("auto switches to Polymarket on a Tatum server error, and stays switched for 30 minutes", async () => {
    const { api, p, f, logs, advance } = setup({ getTopTraders: fail(tatum500), getWalletHistory: ok("tatum") });
    expect(await api.getTopTraders({})).toEqual([{ tag: "polymarket" }]);
    expect(await api.getWalletHistory("0x1", {})).toEqual([{ tag: "polymarket" }]);
    expect(p.calls.map((c) => c.method)).toEqual(["getTopTraders"]);
    expect(logs[0]).toMatch(/polymarket/i);
    advance(31 * MIN);
    expect(await api.getWalletHistory("0x1", {})).toEqual([{ tag: "tatum" }]);
    expect(f.calls).toHaveLength(2);
  });

  test("market endpoints always use Tatum", async () => {
    const { api, f } = setup({ getTopTraders: fail(tatum500) }, "polymarket");
    await api.listMarkets({});
    expect(f.calls).toHaveLength(0);
  });

  test("errors that aren't Tatum outages are not hidden", async () => {
    const { api, f } = setup({ getTopTraders: fail(new CreditCapError("cap")) });
    await expect(api.getTopTraders({})).rejects.toBeInstanceOf(CreditCapError);
    const bad = setup({ getTopTraders: fail(new TatumError("bad", 400, null)) });
    await expect(bad.api.getTopTraders({})).rejects.toMatchObject({ status: 400 });
    expect(f.calls).toHaveLength(0);
  });

  test("tatum mode never falls back; polymarket mode never calls Tatum for wallet data", async () => {
    const t = setup({ getTopTraders: fail(tatum500) }, "tatum");
    await expect(t.api.getTopTraders({})).rejects.toBe(tatum500);
    const pm = setup({ getTopTraders: ok("tatum") }, "polymarket");
    expect(await pm.api.getTopTraders({})).toEqual([{ tag: "polymarket" }]);
    expect(pm.p.calls).toHaveLength(0);
  });
});
