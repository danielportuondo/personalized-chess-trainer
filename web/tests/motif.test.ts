import { describe, it, expect } from "vitest";
import { classifyMotif } from "../src/profile";
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("classifyMotif", () => {
  it("missed forced mate", () => expect(classifyMotif(START, "e2e4", "e2e4", 9500)).toBe("missed forced mate"));
  it("allowed forced mate", () =>
    expect(classifyMotif(START, "e2e4", "d2d4", 0, -9800)).toBe("allowed forced mate"));
  it("hanging piece", () =>
    expect(classifyMotif("6k1/8/1p6/8/8/8/6K1/R7 w - - 0 1", "a1a5", "g2f2", 0)).toBe("hanging piece"));
  it("missed win of material (1-ply)", () =>
    expect(classifyMotif("7k/8/8/3n4/4P3/8/8/6K1 w - - 0 1", "g1f1", "e4d5", 0)).toBe("missed win of material"));
  it("missed win of material (via PV)", () =>
    expect(classifyMotif("6k1/8/2r5/3N4/8/8/8/6K1 w - - 0 1", "g1g2", "d5e7", 0, undefined, "d5e7 g8f7 e7c6")).toBe("missed win of material"));
  it("quiet error is other", () =>
    expect(classifyMotif("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", "e1d1", "e2e4", 0, undefined, "e2e4")).toBe("other"));
});
