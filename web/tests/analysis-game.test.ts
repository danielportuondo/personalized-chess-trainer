import { describe, it, expect } from "vitest";
import { MATE_SCORE, analyzeGame } from "../src/analysis";
import type { AnalysisInfo, AnalyseFn } from "../src/analysis";

// Scripted fake `analyse`, call-ordered — port of tests/test_scores.py's FakeEngine.
function fakeAnalyse(infos: AnalysisInfo[]): AnalyseFn & { calls: number } {
  let calls = 0;
  const fn = (async (_fen: string) => {
    const info = infos[calls];
    calls++;
    return info;
  }) as AnalyseFn & { calls: number };
  Object.defineProperty(fn, "calls", { get: () => calls });
  return fn;
}

const HANGING_QUEEN_PGN = '[White "dportuondo"]\n[Black "opp"]\n\n1. e4 *';

// Port of tests/test_scores.py's test_cpl_hanging_queen.
describe("analyzeGame — hanging queen", () => {
  it("computes evalBeforeCp/evalAfterPlayedCp/cpl from the player's POV", async () => {
    const analyse = fakeAnalyse([
      { cp: 40, mate: null, pv: ["e2e4"] },
      { cp: 900, mate: null, pv: [] },
    ]);

    const evals = await analyzeGame(HANGING_QUEEN_PGN, "dportuondo", analyse);

    expect(evals).toHaveLength(1);
    const e = evals[0];
    expect(e.evalBeforeCp).toBe(40);
    expect(e.evalAfterPlayedCp).toBe(-900);
    expect(e.cpl).toBe(940);
  });
});

// Port of tests/test_scores.py's test_cpl_clamped_when_already_losing.
describe("analyzeGame — CPL clamped at zero when already losing", () => {
  it("never reports negative CPL", async () => {
    const analyse = fakeAnalyse([
      { cp: -300, mate: null, pv: ["e2e4"] },
      { cp: 300, mate: null, pv: [] },
    ]);

    const evals = await analyzeGame(HANGING_QUEEN_PGN, "dportuondo", analyse);

    expect(evals).toHaveLength(1);
    const e = evals[0];
    expect(e.evalBeforeCp).toBe(-300);
    expect(e.evalAfterPlayedCp).toBe(-300);
    expect(e.cpl).toBe(0);
  });
});

describe("analyzeGame — guard clauses", () => {
  it("returns [] for a non-standard-start Variant header", async () => {
    const pgn = '[White "dportuondo"]\n[Black "opp"]\n[Variant "Chess960"]\n\n1. e4 *';
    const analyse = fakeAnalyse([]);

    const evals = await analyzeGame(pgn, "dportuondo", analyse);

    expect(evals).toEqual([]);
  });

  it("returns [] when the username matches neither player", async () => {
    const analyse = fakeAnalyse([]);

    const evals = await analyzeGame(HANGING_QUEEN_PGN, "someoneElse", analyse);

    expect(evals).toEqual([]);
  });
});

// Port of the parity contract (chessops encodes castling as king-captures-own-rook,
// e.g. "e1h1"; the Python reference / Stockfish PV use standard king-two-square UCI,
// e.g. "e1g1") — guards against playedMoveUci diverging from bestMoveUci/the PV.
describe("analyzeGame — castling playedMoveUci normalization", () => {
  it("normalizes kingside castling (O-O) to standard UCI e1g1, not e1h1", async () => {
    // Player is White throughout, so every White move (e4, Nf3, Bc4, O-O) — not just
    // the castle — triggers a before+after analyse call; the castling eval is last.
    const pgn = '[White "dportuondo"]\n[Black "opp"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O *';
    const placeholder: AnalysisInfo = { cp: 20, mate: null, pv: [] };
    const analyse = fakeAnalyse(Array(8).fill(placeholder));

    const evals = await analyzeGame(pgn, "dportuondo", analyse);

    expect(evals).toHaveLength(4);
    expect(evals[3].playedMoveUci).toBe("e1g1");
  });

  it("normalizes queenside castling (O-O-O) to standard UCI e1c1, not e1a1", async () => {
    // 5 White moves (d4, Nc3, Bf4, Qd2, O-O-O) clear b1/c1/d1 for the queenside castle.
    const pgn =
      '[White "dportuondo"]\n[Black "opp"]\n\n1. d4 d5 2. Nc3 Nc6 3. Bf4 Bf5 4. Qd2 Qd6 5. O-O-O *';
    const placeholder: AnalysisInfo = { cp: 15, mate: null, pv: [] };
    const analyse = fakeAnalyse(Array(10).fill(placeholder));

    const evals = await analyzeGame(pgn, "dportuondo", analyse);

    expect(evals).toHaveLength(5);
    expect(evals[4].playedMoveUci).toBe("e1c1");
  });
});

// Nice to have: exercises the game-over branch (evalAfter = MATE_SCORE without a
// second `analyse` call), via the well-known Fool's Mate (fastest possible checkmate).
describe("analyzeGame — checkmate on the player's own move", () => {
  it("sets evalAfterPlayedCp = MATE_SCORE and does not call analyse for the after-position", async () => {
    // 1. f3 e5 2. g4 Qh4# — Black (the player) delivers mate on their 2nd move.
    const pgn = '[White "opp"]\n[Black "dportuondo"]\n\n1. f3 e5 2. g4 Qh4# *';
    const analyse = fakeAnalyse([
      { cp: 0, mate: null, pv: ["e7e5"] }, // ply 1: before ...e5
      { cp: 0, mate: null, pv: [] }, // ply 1: after ...e5
      { cp: 50, mate: null, pv: ["d8h4"] }, // ply 3: before ...Qh4#
    ]);

    const evals = await analyzeGame(pgn, "dportuondo", analyse);

    expect(evals).toHaveLength(2);
    const mateEval = evals[1];
    expect(mateEval.evalAfterPlayedCp).toBe(MATE_SCORE);
    expect(analyse.calls).toBe(3);
  });
});
