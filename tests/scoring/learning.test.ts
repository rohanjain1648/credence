import { describe, expect, test } from "vitest";
import { brier, fitLambda, learningCurve, type Observation } from "@/lib/scoring/learning";

const obs = (o: Partial<Observation>): Observation => ({ q: 0.5, s: 1, y: 1, group: "SPORTS", resolvedAt: 0, ...o });
const repeat = (n: number, o: Partial<Observation>) => Array.from({ length: n }, () => obs(o));

describe("learning", () => {
  test("fitLambda prior with no data", () => expect(fitLambda([])).toBe(0.25));
  test("sharps always right → capped at 0.6", () => expect(fitLambda(repeat(4, { s: 1, y: 1 }))).toBe(0.6));
  test("sharps always wrong → 0", () => expect(fitLambda(repeat(4, { s: 1, y: 0 }))).toBe(0));
  test("one right observation moves lambda halfway", () => expect(fitLambda([obs({})])).toBeCloseTo(0.5, 10));
  test("brier", () => expect(brier(0.7, 1)).toBeCloseTo(0.09, 10));

  test("learning curve is prequential and sorted by resolvedAt", () => {
    const points = learningCurve([obs({ resolvedAt: 2 }), obs({ resolvedAt: 1 })]);
    expect(points.map((p) => p.resolvedAt)).toEqual([1, 2]);
    expect(points[0].lambda).toBe(0.25);
    expect(points[0].brierCredence).toBeCloseTo(0.140625, 10);
    expect(points[0].brierMarket).toBeCloseTo(0.25, 10);
    expect(points[1].lambda).toBeCloseTo(0.5, 10);
    expect(points[1].brierCredence).toBeCloseTo(0.1015625, 10);
  });

  test("learning curve fits lambda per group", () => {
    const points = learningCurve([obs({ resolvedAt: 1, group: "SPORTS" }), obs({ resolvedAt: 2, group: "POLITICS" })]);
    expect(points[1].lambda).toBe(0.25);
  });
});
