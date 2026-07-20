import { describe, expect, it } from "vitest";
import { curateLine, curatePuzzle, difficultyScore, isDrillable } from "../src/curate";
import type { Puzzle } from "../src/types";

// Scholar's mate: 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? — White mates with Qxf7#.
const MATE_IN_1_FEN = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
// KQ vs K: 1.Kg6! (quiet — queen on b1 so no discovered check) Kg8 (forced) 2.Qb8#.
const MATE_IN_2_FEN = "7k/8/5K2/8/8/8/8/1Q6 w - - 0 1";
// Royal fork: 1.Nc7+ Kd7 2.Nxa8 — rook banked on the second user move.
const FORK_FEN = "r3k3/8/8/3N4/8/8/8/6K1 w - - 0 1";
// Queen sac into smothered mate: 1.Qg8+ Rxg8 2.Nf7# — material dips to −9, mate still wins.
const SMOTHERED_FEN = "5r1k/6pp/8/6N1/2Q5/8/8/6K1 w - - 0 1";
// Rxd5 grabs a knight but the e6 pawn recaptures the rook — gain is never banked.
const RECAPTURE_FEN = "6k1/8/4p3/3n4/8/8/8/3R2K1 w - - 0 1";
// Rook shuffles for 3 moves, only wins the knight on user move 4 — past MOVE_CAP.
const LATE_GAIN_FEN = "1n4k1/7p/8/8/8/8/8/R5K1 w - - 0 1";
// Two-rook ladder, mate on user move 4 (within MATE_MOVE_CAP).
const LADDER_4_FEN = "8/8/8/4k3/R7/1R6/8/6K1 w - - 0 1";
// Same ladder one rank further out: mate on user move 5 (past MATE_MOVE_CAP).
const LADDER_5_FEN = "8/8/8/8/4k3/R7/1R6/6K1 w - - 0 1";

function makePuzzle(overrides: Partial<Puzzle> = {}): Puzzle {
  return {
    fen: MATE_IN_1_FEN,
    solutionLineUci: "h5f7",
    playedMoveUci: "h5h4",
    bestMoveUci: "h5f7",
    cpl: 800,
    evalBeforeCp: 9996,
    sourceGameUrl: "https://example.com/game/1",
    sourcePly: 6,
    dedupeKey: MATE_IN_1_FEN.split(" ").slice(0, 4).join(" "),
    ...overrides,
  };
}

describe("curateLine", () => {
  it("cuts a mate-in-1 at one user move", () => {
    const c = curateLine(MATE_IN_1_FEN, "h5f7");
    expect(c).toEqual({ lineUci: "h5f7", userMoves: 1, goal: "mate", forcingRatio: 1 });
  });

  it("plays a quiet first move through to the mate on move 2", () => {
    const c = curateLine(MATE_IN_2_FEN, "f6g6 h8g8 b1b8");
    expect(c).toEqual({ lineUci: "f6g6 h8g8 b1b8", userMoves: 2, goal: "mate", forcingRatio: 0.5 });
  });

  it("banks the forked rook on user move 2", () => {
    const c = curateLine(FORK_FEN, "d5c7 e8d7 c7a8");
    expect(c).toEqual({ lineUci: "d5c7 e8d7 c7a8", userMoves: 2, goal: "material", forcingRatio: 1 });
  });

  it("prefers the mate cut even when the line sacrifices material", () => {
    const c = curateLine(SMOTHERED_FEN, "c4g8 f8g8 g5f7");
    expect(c).toMatchObject({ lineUci: "c4g8 f8g8 g5f7", userMoves: 2, goal: "mate" });
  });

  it("ignores tail moves past the payoff", () => {
    // Full 16-ply-style PV: the mate-in-1 followed by garbage the walk never reaches.
    const c = curateLine(MATE_IN_1_FEN, "h5f7");
    expect(c?.userMoves).toBe(1);
    const forked = curateLine(FORK_FEN, "d5c7 e8d7 c7a8 d7c8 a8c7 c8d8");
    expect(forked).toMatchObject({ lineUci: "d5c7 e8d7 c7a8", userMoves: 2, goal: "material" });
  });

  it("does not bank a gain the opponent immediately recaptures", () => {
    expect(curateLine(RECAPTURE_FEN, "d1d5 e6d5 g1f1 g8f7")).toBeNull();
  });

  it("returns null for a quiet line with no payoff", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(curateLine(start, "g1f3 g8f6 d2d4 d7d5 c1f4 e7e6")).toBeNull();
  });

  it("returns null when material only arrives past the 3-move cap", () => {
    expect(curateLine(LATE_GAIN_FEN, "a1a2 h7h6 a2a3 h6h5 a3b3 h5h4 b3b8")).toBeNull();
  });

  it("allows mates up to 4 user moves", () => {
    const c = curateLine(LADDER_4_FEN, "a4a5 e5e6 b3b6 e6e7 a5a7 e7e8 b6b8");
    expect(c).toMatchObject({ userMoves: 4, goal: "mate" });
  });

  it("returns null for mates deeper than 4 user moves", () => {
    expect(
      curateLine(LADDER_5_FEN, "a3a4 e4e5 b2b5 e5e6 a4a6 e6e7 b5b7 e7e8 a6a8"),
    ).toBeNull();
  });

  it("survives malformed tails and empty lines without throwing", () => {
    expect(curateLine(MATE_IN_1_FEN, "")).toBeNull();
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(curateLine(start, "g1f3 zz9 e2e4")).toBeNull();
  });
});

describe("curatePuzzle", () => {
  it("curates a drillable puzzle", () => {
    expect(curatePuzzle(makePuzzle())).toMatchObject({ userMoves: 1, goal: "mate" });
  });

  it("rejects puzzles flagged ambiguous", () => {
    expect(curatePuzzle(makePuzzle({ ambiguous: true }))).toBeNull();
  });

  it("keeps unknown (legacy) ambiguity drillable", () => {
    expect(curatePuzzle(makePuzzle({ ambiguous: undefined }))).not.toBeNull();
  });

  it("isDrillable mirrors curatePuzzle as a boolean predicate", () => {
    expect(isDrillable(makePuzzle())).toBe(true);
    expect(isDrillable(makePuzzle({ ambiguous: true }))).toBe(false);
    expect(isDrillable(makePuzzle({ solutionLineUci: "g1f3" , fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"}))).toBe(false);
  });
});

describe("difficultyScore", () => {
  it("orders short forcing lines below long quiet ones", () => {
    const mate1 = curateLine(MATE_IN_1_FEN, "h5f7")!;
    const smothered = curateLine(SMOTHERED_FEN, "c4g8 f8g8 g5f7")!;
    const ladder = curateLine(LADDER_4_FEN, "a4a5 e5e6 b3b6 e6e7 a5a7 e7e8 b6b8")!;
    const s1 = difficultyScore(mate1, makePuzzle({ cpl: 800 }));
    const s2 = difficultyScore(smothered, makePuzzle({ cpl: 400 }));
    const s3 = difficultyScore(ladder, makePuzzle({ cpl: 200 }));
    expect(s1).toBeLessThan(s2);
    expect(s2).toBeLessThan(s3);
  });

  it("rewards bigger blunders (easier to refute) at equal length", () => {
    const mate1 = curateLine(MATE_IN_1_FEN, "h5f7")!;
    expect(difficultyScore(mate1, makePuzzle({ cpl: 900 }))).toBeLessThan(
      difficultyScore(mate1, makePuzzle({ cpl: 160 })),
    );
  });
});
