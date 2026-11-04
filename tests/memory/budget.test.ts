import { describe, expect, test } from "vitest";
import { pointsAvailable } from "@/lib/memory/budget";

const NOW = 1_800_000_000_000;
const times = (n: number, at: number) => Array.from({ length: n }, () => at);

describe("memory budget", () => {
  test("fresh: minute cap binds", () => expect(pointsAvailable([], NOW)).toBe(50));
  test("80 sends in last hour → 0", () => expect(pointsAvailable(times(80, NOW - 30 * 60e3), NOW)).toBe(0));
  test("10 sends in last minute → 0", () => expect(pointsAvailable(times(10, NOW - 10e3), NOW)).toBe(0));
  test("78 sends in the hour leaves 10 points", () => expect(pointsAvailable(times(78, NOW - 30 * 60e3), NOW)).toBe(10));
  test("sends older than an hour do not count", () => expect(pointsAvailable(times(200, NOW - 61 * 60e3), NOW)).toBe(50));
});
