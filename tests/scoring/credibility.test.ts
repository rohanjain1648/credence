import { describe, expect, test } from "vitest";
import { credibilityFromZ, scoreBets, scoreByGroup, type ResolvedBet } from "@/lib/scoring/credibility";

const bet = (o: Partial<ResolvedBet>): ResolvedBet => ({
  avgPrice: 0.5,
  resolution: 1,
  totalBought: 100,
  settledAt: 1_000,
  group: "SPORTS",
  realizedPnl: 0,
  ...o,
});
const repeat = (n: number, o: Partial<ResolvedBet>) => Array.from({ length: n }, () => bet(o));

describe("credibility", () => {
  test("no bets → neutral", () => {
    expect(scoreBets([])).toMatchObject({ n: 0, wins: 0, credibility: 50, edge: 0, z: 0 });
  });

  test("3 coin-flip wins stay modest", () => {
    const s = scoreBets(repeat(3, { avgPrice: 0.5, resolution: 1 }));
    expect(s.z).toBeCloseTo(0.8321, 3);
    expect(s.edge).toBeCloseTo(0.11538, 4);
    expect(s.credibility).toBeCloseTo(63.52, 1);
  });

  test("100 bets at 0.4 winning half", () => {
    const s = scoreBets([...repeat(50, { avgPrice: 0.4, resolution: 1 }), ...repeat(50, { avgPrice: 0.4, resolution: 0 })]);
    expect(s.n).toBe(100);
    expect(s.wins).toBe(50);
    expect(s.z).toBeCloseTo(1.9426, 3);
    expect(s.edge).toBeCloseTo(0.0909, 3);
    expect(s.credibility).toBeCloseTo(78.5, 1);
  });

  test("losing at fair prices drives credibility below 50", () => {
    expect(scoreBets(repeat(40, { avgPrice: 0.6, resolution: 0 })).credibility).toBeLessThan(20);
  });

  test("excludes extreme prices, dust and settlements after asOf", () => {
    const s = scoreBets(
      [
        bet({ avgPrice: 0.999 }),
        bet({ avgPrice: 0.004 }),
        bet({ totalBought: 2 }),
        bet({ settledAt: 5_000 }),
        bet({ avgPrice: 0.5, resolution: 1 }),
      ],
      2_000,
    );
    expect(s.n).toBe(1);
  });

  test("pnl and volume are reported but do not move credibility", () => {
    const rich = scoreBets(repeat(10, { realizedPnl: 1_000_000, totalBought: 1_000_000 }));
    const poor = scoreBets(repeat(10, { realizedPnl: 1, totalBought: 10 }));
    expect(rich.pnl).toBe(10_000_000);
    expect(rich.volume).toBe(10_000_000);
    expect(rich.credibility).toBeCloseTo(poor.credibility, 10);
  });

  test("scoreByGroup splits by group and includes OVERALL", () => {
    const s = scoreByGroup([...repeat(3, { group: "SPORTS" }), ...repeat(2, { group: "POLITICS" })]);
    expect(s.SPORTS?.n).toBe(3);
    expect(s.POLITICS?.n).toBe(2);
    expect(s.OVERALL?.n).toBe(5);
    expect(s.CRYPTO).toBeUndefined();
  });

  test("credibilityFromZ is bounded and centered", () => {
    expect(credibilityFromZ(0)).toBe(50);
    expect(credibilityFromZ(100)).toBeLessThanOrEqual(100);
    expect(credibilityFromZ(-100)).toBeGreaterThanOrEqual(0);
  });
});
