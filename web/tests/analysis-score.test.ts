import { describe, it, expect } from "vitest";
import { MATE_SCORE, mateScore, povCp } from "../src/analysis";

// Port of tests/test_scores.py's test_pov_cp_mate_conversion.
describe("mateScore / povCp — mate conversion", () => {
  it("mate:3 (white to move, white POV) -> MATE_SCORE - 3", () => {
    expect(povCp({ cp: null, mate: 3, pv: [] }, "white", "white")).toBe(MATE_SCORE - 3);
  });

  it("mate:-3 (white to move, white POV) -> -MATE_SCORE + 3", () => {
    expect(povCp({ cp: null, mate: -3, pv: [] }, "white", "white")).toBe(-MATE_SCORE + 3);
  });

  it("a faster mate ranks higher: m(1) > m(5)", () => {
    expect(mateScore(1)).toBeGreaterThan(mateScore(5));
  });

  it("being mated sooner is worse: m(-1) < m(-5)", () => {
    expect(mateScore(-1)).toBeLessThan(mateScore(-5));
  });
});

// Port of tests/test_scores.py's test_pov_cp_plain_and_perspective.
describe("povCp — plain cp and perspective flip", () => {
  it("same POV: white to move, white player -> unchanged", () => {
    expect(povCp({ cp: 150, mate: null, pv: [] }, "white", "white")).toBe(150);
  });

  it("flipped POV: black to move, white player -> sign flips", () => {
    expect(povCp({ cp: 900, mate: null, pv: [] }, "black", "white")).toBe(-900);
  });
});
