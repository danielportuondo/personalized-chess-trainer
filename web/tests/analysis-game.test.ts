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
