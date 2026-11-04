import { describe, expect, test } from "vitest";
import { computeSharpLine, holderWeight } from "@/lib/scoring/sharpLine";

const h = (address: string, outcomeIndex: 0 | 1, currentValue: number, credibility: number | null) => ({
  address,
  outcomeIndex,
  currentValue,
  credibility,
});

describe("sharp line", () => {
  test("holder weight", () => {
    expect(holderWeight(80, 1000)).toBeCloseTo(2.4872, 3);
    expect(holderWeight(55, 1e6)).toBe(0);
    expect(holderWeight(90, -5)).toBe(0);
  });

  test("pulls the price toward credible money", () => {
    const r = computeSharpLine(0.5, [h("a", 0, 1000, 80), h("b", 1, 1000, 60)], 0.25);
    expect(r.consensus).toBeCloseTo(0.9, 6);
    expect(r.line).toBeCloseTo(0.6, 6);
    expect(r.contributors.map((c) => c.address)).toEqual(["a", "b"]);
  });

  test("not enough credible money → null line", () => {
    const r = computeSharpLine(0.5, [h("a", 0, 5, 70)], 0.25);
    expect(r.line).toBeNull();
    expect(r.consensus).toBeNull();
  });

  test("line clamps to 0.99", () => {
    expect(computeSharpLine(0.98, [h("a", 0, 1e5, 95)], 0.6).line).toBe(0.99);
  });

  test("unknown credibility is ignored", () => {
    expect(computeSharpLine(0.5, [h("a", 0, 1e5, null)], 0.25).weight).toBe(0);
  });

  test("keeps the top 5 contributors by weight", () => {
    const holders = [50, 60, 70, 80, 90, 95].map((c, i) => h(`w${i}`, 0, 1000, c));
    const r = computeSharpLine(0.5, holders, 0.25);
    expect(r.contributors).toHaveLength(5);
    expect(r.contributors[0].address).toBe("w5");
    expect(r.contributors.some((c) => c.address === "w0")).toBe(false);
  });
});
