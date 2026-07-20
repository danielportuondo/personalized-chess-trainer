import { describe, it, expect } from "vitest";
import { parseInfoLine } from "../src/engine";

// Pure UCI `info` line parser — the unit-testable core of engine.ts. No Worker
// involved; Worker/WASM behavior is verified in-browser by the controller.
describe("parseInfoLine", () => {
  it("parses a cp score with a pv", () => {
    const line =
      "info depth 12 seldepth 18 multipv 1 score cp 34 nodes 123456 nps 500000 pv e2e4 e7e5 g1f3 b8c6";
    expect(parseInfoLine(line)).toEqual({
      cp: 34,
      mate: null,
      pv: ["e2e4", "e7e5", "g1f3", "b8c6"],
      multipv: 1,
    });
  });

  it("parses a mate score with a pv", () => {
    const line = "info depth 5 seldepth 6 multipv 1 score mate 3 nodes 999 nps 1000 pv d1h5 g8f6 h5f7";
    expect(parseInfoLine(line)).toEqual({
      cp: null,
      mate: 3,
      pv: ["d1h5", "g8f6", "h5f7"],
      multipv: 1,
    });
  });

  it("keeps the numeric value and ignores a trailing bound qualifier", () => {
    const line = "info depth 10 score cp 34 upperbound nodes 1000 pv e2e4";
    expect(parseInfoLine(line)).toEqual({
      cp: 34,
      mate: null,
      pv: ["e2e4"],
      multipv: 1,
    });
  });

  it("returns an empty pv when the line has a score but no pv", () => {
    const line = "info depth 1 score cp 12 nodes 20";
    expect(parseInfoLine(line)).toEqual({
      cp: 12,
      mate: null,
      pv: [],
      multipv: 1,
    });
  });

  it("returns null for a non-score line (info string)", () => {
    expect(parseInfoLine("info string NNUE evaluation using nn-9067e33176e.nnue")).toBeNull();
  });

  it("returns null for a currmove-only info line", () => {
    expect(parseInfoLine("info depth 1 currmove e2e4 currmovenumber 1")).toBeNull();
  });

  it("returns null for a bestmove line", () => {
    expect(parseInfoLine("bestmove e2e4 ponder e7e5")).toBeNull();
  });
});
