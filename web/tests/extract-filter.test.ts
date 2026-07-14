import { describe, it, expect } from "vitest";
import { dedupeKey, extractPuzzles } from "../src/extract";
import type { MoveEval } from "../src/types";

const base = (o: Partial<MoveEval> = {}): MoveEval => ({
  gameUrl: "g",
  ply: 3,
  fullmoveNo: 2,
  playerColor: "white",
  fenBefore: "6k1/8/8/8/8/8/8/6K1 w - - 0 2",
  playedMoveUci: "g1f1",
  bestMoveUci: "g1h1",
  bestLineUci: "g1h1",
  evalBeforeCp: 50,
  evalAfterPlayedCp: -300,
  cpl: 350,
  ...o,
});

describe("extractPuzzles", () => {
  it("keeps a real blunder", () => expect(extractPuzzles([base({})]).length).toBe(1));

  it("drops when already lost (evalBefore <= -700)", () =>
    expect(extractPuzzles([base({ evalBeforeCp: -900, cpl: 350 })]).length).toBe(0));

  it("drops a slip while still winning (evalAfter >= 700)", () =>
    expect(extractPuzzles([base({ evalAfterPlayedCp: 800, cpl: 350 })]).length).toBe(0));

  it("drops below cpl threshold", () => expect(extractPuzzles([base({ cpl: 100 })]).length).toBe(0));

  it("keeps a boundary blunder (cpl == 150, evalBefore just above -700, evalAfter just below 700)", () =>
    expect(
      extractPuzzles([base({ cpl: 150, evalBeforeCp: -699, evalAfterPlayedCp: 699 })]).length
    ).toBe(1));

  it("maps every MoveEval field onto the Puzzle shape, leaving motif untagged", () => {
    const [pz] = extractPuzzles([base({ phase: "endgame" })]);
    expect(pz.fen).toBe("6k1/8/8/8/8/8/8/6K1 w - - 0 2");
    expect(pz.solutionLineUci).toBe("g1h1");
    expect(pz.playedMoveUci).toBe("g1f1");
    expect(pz.bestMoveUci).toBe("g1h1");
    expect(pz.cpl).toBe(350);
    expect(pz.evalBeforeCp).toBe(50);
    expect(pz.phase).toBe("endgame");
    expect(pz.sourceGameUrl).toBe("g");
    expect(pz.sourcePly).toBe(3);
    expect(pz.motif).toBeUndefined();
    expect(pz.dedupeKey).toBe(dedupeKey("6k1/8/8/8/8/8/8/6K1 w - - 0 2"));
  });

  it("falls back to bestMoveUci for solutionLineUci when bestLineUci is empty", () => {
    const [pz] = extractPuzzles([base({ bestLineUci: "" })]);
    expect(pz.solutionLineUci).toBe("g1h1");
  });

  it("dedupes on position, keeping the highest-cpl occurrence regardless of input order", () => {
    const low = base({ gameUrl: "g1", ply: 1, cpl: 150, playedMoveUci: "a2a3" });
    const high = base({ gameUrl: "g2", ply: 7, cpl: 500, playedMoveUci: "b2b3" });
    // low listed first in input, but higher-cpl "high" must win the dedupe (sort by cpl DESC first).
    const puzzles = extractPuzzles([low, high]);
    expect(puzzles.length).toBe(1);
    expect(puzzles[0].cpl).toBe(500);
    expect(puzzles[0].playedMoveUci).toBe("b2b3");
    expect(puzzles[0].sourceGameUrl).toBe("g2");
  });

  it("keeps distinct positions (different fenBefore -> different dedupeKey)", () => {
    const a = base({ fenBefore: "6k1/8/8/8/8/8/8/6K1 w - - 0 2" });
    const b = base({ fenBefore: "6k1/8/8/8/8/8/8/5K2 w - - 0 2" });
    expect(extractPuzzles([a, b]).length).toBe(2);
  });
});
