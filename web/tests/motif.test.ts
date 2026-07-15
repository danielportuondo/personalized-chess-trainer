import { describe, it, expect } from "vitest";
import { classifyMotif, tagMotifs } from "../src/profile";
import type { MoveEval, Puzzle } from "../src/types";
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const QUIET_FEN = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1";

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
    expect(classifyMotif(QUIET_FEN, "e1d1", "e2e4", 0, undefined, "e2e4")).toBe("other"));
});

function makeEval(overrides: Partial<MoveEval> & Pick<MoveEval, "gameUrl" | "ply">): MoveEval {
  return {
    fullmoveNo: 1,
    playerColor: "white",
    fenBefore: START,
    playedMoveUci: "e2e4",
    bestMoveUci: "e2e4",
    bestLineUci: "e2e4",
    evalBeforeCp: 0,
    evalAfterPlayedCp: 0,
    cpl: 0,
    ...overrides,
  };
}

function makePuzzle(overrides: Partial<Puzzle> & Pick<Puzzle, "sourceGameUrl" | "sourcePly">): Puzzle {
  return {
    fen: START,
    solutionLineUci: "e2e4",
    playedMoveUci: "e2e4",
    bestMoveUci: "e2e4",
    cpl: 200,
    evalBeforeCp: 0,
    dedupeKey: "k",
    ...overrides,
  };
}

describe("tagMotifs", () => {
  it("tags a puzzle whose source eval shows a walked-into mate as 'allowed forced mate'", () => {
    const mateEval = makeEval({
      gameUrl: "g1",
      ply: 5,
      fenBefore: START,
      playedMoveUci: "e2e4",
      bestMoveUci: "d2d4",
      bestLineUci: "d2d4",
      evalBeforeCp: 0,
      evalAfterPlayedCp: -9800,
    });
    const puzzle = makePuzzle({
      sourceGameUrl: "g1",
      sourcePly: 5,
      fen: START,
      playedMoveUci: "e2e4",
      bestMoveUci: "d2d4",
      solutionLineUci: "d2d4",
      evalBeforeCp: 0,
    });

    tagMotifs([puzzle], [mateEval]);

    expect(puzzle.motif).toBe("allowed forced mate");
  });

  it("tags a quiet puzzle as 'other'", () => {
    const quietEval = makeEval({
      gameUrl: "g2",
      ply: 7,
      fenBefore: QUIET_FEN,
      playedMoveUci: "e1d1",
      bestMoveUci: "e2e4",
      bestLineUci: "e2e4",
      evalBeforeCp: 0,
      evalAfterPlayedCp: 0,
    });
    const puzzle = makePuzzle({
      sourceGameUrl: "g2",
      sourcePly: 7,
      fen: QUIET_FEN,
      playedMoveUci: "e1d1",
      bestMoveUci: "e2e4",
      solutionLineUci: "e2e4",
      evalBeforeCp: 0,
    });

    tagMotifs([puzzle], [quietEval]);

    expect(puzzle.motif).toBe("other");
  });

  it("leaves motif undefined when no eval matches (sourceGameUrl, sourcePly)", () => {
    const unrelatedEval = makeEval({ gameUrl: "other-game", ply: 1 });
    const puzzle = makePuzzle({ sourceGameUrl: "g3", sourcePly: 99 });

    tagMotifs([puzzle], [unrelatedEval]);

    expect(puzzle.motif).toBeUndefined();
  });
});
