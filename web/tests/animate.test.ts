import { describe, it, expect } from "vitest";
import { easeOutCubic, countUpValue } from "../src/ui/animate";

describe("easeOutCubic", () => {
  it("pins the endpoints", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it("eases out (past the midpoint by t=0.5)", () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 5);
  });
});

describe("countUpValue", () => {
  it("returns from at t<=0 and to at t>=1", () => {
    expect(countUpValue(0, 100, 0)).toBe(0);
    expect(countUpValue(0, 100, 1)).toBe(100);
  });

  it("clamps out-of-range t", () => {
    expect(countUpValue(10, 50, -2)).toBe(10);
    expect(countUpValue(10, 50, 3)).toBe(50);
  });

  it("is monotonic non-decreasing across the range", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const v = countUpValue(0, 58, i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("rounds to integers", () => {
    expect(Number.isInteger(countUpValue(0, 7, 0.33))).toBe(true);
  });

  it("counts down when to < from", () => {
    expect(countUpValue(100, 0, 0)).toBe(100);
    expect(countUpValue(100, 0, 1)).toBe(0);
  });
});
