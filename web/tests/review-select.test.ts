import { describe, it, expect } from "vitest";
import { selectDuePuzzles, puzzleWeight } from "../src/review";
import type { Puzzle, ReviewState, WeaknessSummary } from "../src/types";

const pz = (o: Partial<Puzzle>): Puzzle => ({
  fen: "startpos",
  solutionLineUci: "e2e4",
  playedMoveUci: "e2e4",
  bestMoveUci: "e2e4",
  cpl: 200,
  evalBeforeCp: 0,
  sourceGameUrl: "g",
  sourcePly: 0,
  dedupeKey: "k",
  ...o,
});

const review = (dueDate: string): ReviewState => ({
  ease: 2.5,
  intervalDays: 1,
  reps: 1,
  lapses: 0,
  dueDate,
});

const emptySummary: WeaknessSummary = {
  totalMistakes: 0,
  avgCpl: 0,
  byPhase: [],
  byMotif: [],
  byMoveBucket: [],
};

describe("selectDuePuzzles", () => {
  const today = "2026-01-10";

  it("returns all due candidates (new + past-due + due-today), excluding not-yet-due, when count <= size", () => {
    const pNew = pz({ dedupeKey: "new" });
    const pPast = pz({ dedupeKey: "past" });
    const pDueToday = pz({ dedupeKey: "today" });
    const pFuture = pz({ dedupeKey: "future" });
    const reviewByKey: Record<string, ReviewState> = {
      past: review("2026-01-05"),
      today: review("2026-01-10"),
      future: review("2026-01-15"),
    };
    const result = selectDuePuzzles(
      [pNew, pPast, pDueToday, pFuture],
      reviewByKey,
      emptySummary,
      today
    );
    expect(result.map((p) => p.dedupeKey).sort()).toEqual(["new", "past", "today"]);
  });

  it("orders new-first, then reviewed candidates by due date ascending", () => {
    const pA = pz({ dedupeKey: "a" }); // no review -> new
    const pB = pz({ dedupeKey: "b" });
    const pC = pz({ dedupeKey: "c" });
    const reviewByKey: Record<string, ReviewState> = {
      b: review("2026-01-08"),
      c: review("2026-01-02"),
    };
    const result = selectDuePuzzles([pB, pC, pA], reviewByKey, emptySummary, today);
    expect(result.map((p) => p.dedupeKey)).toEqual(["a", "c", "b"]);
  });

  it("returns exactly `size` items without duplicates when candidates exceed size (weighted path)", () => {
    const puzzles = Array.from({ length: 20 }, (_, i) => pz({ dedupeKey: `p${i}` }));
    const result = selectDuePuzzles(puzzles, {}, emptySummary, today, 15);
    expect(result.length).toBe(15);
    expect(new Set(result.map((p) => p.dedupeKey)).size).toBe(15);
  });
});

describe("puzzleWeight", () => {
  const summary: WeaknessSummary = {
    totalMistakes: 5,
    avgCpl: 300,
    byPhase: [
      { key: "opening", n: 3, pct: 60, avgCpl: 100 },
      { key: "unknown", n: 2, pct: 40, avgCpl: 200 },
    ],
    byMotif: [
      { key: "hanging piece", n: 4, pct: 80, avgCpl: 150 },
      { key: "unknown", n: 1, pct: 20, avgCpl: 50 },
    ],
    byMoveBucket: [],
  };

  it("weight = 1 + phasePct/100 + motifPct/100 for a tagged puzzle", () => {
    const p = pz({ phase: "opening", motif: "hanging piece" });
    expect(puzzleWeight(p, summary)).toBeCloseTo(1 + 0.6 + 0.8, 10);
  });

  it("untagged phase/motif contributes 0 even though the summary has an 'unknown' bucket (matches Python dict.get(None, 0) lookup on the raw, un-coalesced key)", () => {
    const p = pz({ phase: undefined, motif: undefined });
    expect(puzzleWeight(p, summary)).toBe(1);
  });
});
