import { describe, expect, test } from "vitest";
import { envelopeOf, MarketSchema, pageOf, PriceHistorySchema } from "@/lib/tatum/schemas";
import closingSoon from "../fixtures/tatum/real-markets-closing-soon.json";
import kalshi from "../fixtures/tatum/real-markets-kalshi.json";
import market from "../fixtures/tatum/real-market.json";
import markets from "../fixtures/tatum/real-markets.json";
import priceHistory from "../fixtures/tatum/real-price-history.json";

/** Responses captured from the live API by `npm run capture:fixtures`. */
describe("schemas accept real Tatum responses", () => {
  test.each([
    ["polymarket list", markets],
    ["kalshi list", kalshi],
    ["markets closing soon", closingSoon],
  ])("%s", (_name, body) => {
    const parsed = pageOf(MarketSchema).parse(body);
    expect(parsed.data.length).toBeGreaterThan(0);
    for (const m of parsed.data) expect(m.outcomes.length).toBe(2);
  });

  test("single market, wrapped in a data envelope", () => {
    const parsed = envelopeOf(MarketSchema).parse(market);
    expect(parsed.outcomes[0]).toMatchObject({ name: "YES", price: 0.145 });
    expect(parsed.source?.url).toContain("polymarket.com");
  });

  test("price history", () => {
    expect(envelopeOf(PriceHistorySchema).parse(priceHistory).interval).toBe("1h");
  });
});
