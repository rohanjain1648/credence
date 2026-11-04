import { describe, expect, test } from "vitest";
import { matchVenues, normalizeQuestion, similarity, type MarketLite } from "@/lib/scoring/matching";

const DAY = 86_400_000;
const T = Date.parse("2026-11-04T23:00:00Z");
const m = (id: string, question: string, outcomes: string[], closeTime: number | null = T): MarketLite => ({ id, question, outcomes, closeTime });

describe("matching", () => {
  test("normalize drops stopwords and punctuation", () => {
    expect(normalizeQuestion("Will the Lakers beat the Celtics?")).toEqual(["lakers", "beat", "celtics"]);
  });

  test("similarity is Jaccard over normalized tokens", () => {
    expect(similarity("Lakers vs. Celtics", "Will the Lakers win vs Celtics?")).toBe(1);
    expect(similarity("Democrats win the Senate", "Republicans win the House")).toBe(0);
  });

  test("matches same event within close-time window", () => {
    const pairs = matchVenues(
      [m("p1", "Which party will win the Senate in 2026?", ["Democrats", "Republicans"])],
      [m("k1", "Which party will win the Senate in 2026?", ["Yes", "No"], T + DAY), m("k2", "Bitcoin above 100k?", ["Yes", "No"])],
    );
    expect(pairs).toEqual([{ polyId: "p1", kalshiId: "k1", score: 1, flip: false }]);
  });

  test("rejects pairs beyond 3 days apart even with identical text", () => {
    expect(matchVenues([m("p1", "Fed cuts rates in December?", ["Yes", "No"])], [m("k1", "Fed cuts rates in December?", ["Yes", "No"], T + 4 * DAY)])).toEqual([]);
  });

  test("rejects pairs below the similarity threshold", () => {
    expect(matchVenues([m("p1", "Lakers vs. Celtics", ["Lakers", "Celtics"])], [m("k1", "Lakers vs. Knicks", ["Yes", "No"])])).toEqual([]);
  });

  test("picks the best-scoring Kalshi market", () => {
    const pairs = matchVenues(
      [m("p1", "Will Bitcoin be above $100,000 on Nov 7?", ["Yes", "No"])],
      [m("k1", "Bitcoin above $100,000?", ["Yes", "No"]), m("k2", "Will Bitcoin be above $100,000 on Nov 7?", ["Yes", "No"])],
    );
    expect(pairs[0].kalshiId).toBe("k2");
  });

  test("team market orientation flips when Kalshi YES names outcome B", () => {
    const pairs = matchVenues([m("p1", "Lakers vs. Celtics", ["Lakers", "Celtics"])], [m("k1", "Will the Celtics win vs Lakers?", ["Yes", "No"])]);
    expect(pairs[0]).toMatchObject({ kalshiId: "k1", flip: true });
  });

  test("team market keeps orientation when Kalshi YES names outcome A", () => {
    const pairs = matchVenues([m("p1", "Lakers vs. Celtics", ["Lakers", "Celtics"])], [m("k1", "Will the Lakers win vs Celtics?", ["Yes", "No"])]);
    expect(pairs[0].flip).toBe(false);
  });
});
