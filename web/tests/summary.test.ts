import { describe, it, expect } from "vitest";
import { weaknessSummary } from "../src/profile";
import type { Puzzle } from "../src/types";

const pz = (o: Partial<Puzzle>): Puzzle => ({
  fen: "startpos",
  solutionLineUci: "e2e4",
  playedMoveUci: "e2e4",
  bestMoveUci: "e2e4",
  cpl: 0,
  evalBeforeCp: 0,
  sourceGameUrl: "g",
  sourcePly: 0,
  dedupeKey: "k",
  ...o,
});

describe("weaknessSummary", () => {
  it("empty input", () => {
    expect(weaknessSummary([])).toEqual({
      totalMistakes: 0,
      avgCpl: 0,
      byPhase: [],
      byMotif: [],
      byMoveBucket: [],
    });
  });

  it("computes counts, pct, avgCpl, and move buckets on a hand-built list", () => {
    const puzzles: Puzzle[] = [
      pz({ dedupeKey: "1", phase: "opening", motif: "hanging piece", cpl: 200, sourcePly: 5 }), // move 3 -> 1-10
      pz({ dedupeKey: "2", phase: "opening", motif: "hanging piece", cpl: 300, sourcePly: 9 }), // move 5 -> 1-10
      pz({ dedupeKey: "3", phase: "middlegame", motif: "other", cpl: 400, sourcePly: 25 }), // move 13 -> 11-20
      pz({
        dedupeKey: "4",
        phase: "middlegame",
        motif: "missed win of material",
        cpl: 500,
        sourcePly: 45,
      }), // move 23 -> 21-30
      pz({ dedupeKey: "5", phase: undefined, motif: undefined, cpl: 600, sourcePly: 65 }), // move 33 -> 31+
    ];
    const s = weaknessSummary(puzzles);

    expect(s.totalMistakes).toBe(5);
    expect(s.avgCpl).toBe(400);

    expect(s.byPhase).toEqual([
      { key: "opening", n: 2, pct: 40, avgCpl: 250 },
      { key: "middlegame", n: 2, pct: 40, avgCpl: 450 },
      { key: "unknown", n: 1, pct: 20, avgCpl: 600 },
    ]);

    expect(s.byMotif).toEqual([
      { key: "hanging piece", n: 2, pct: 40, avgCpl: 250 },
      { key: "other", n: 1, pct: 20, avgCpl: 400 },
      { key: "missed win of material", n: 1, pct: 20, avgCpl: 500 },
      { key: "unknown", n: 1, pct: 20, avgCpl: 600 },
    ]);

    // byMoveBucket is ordered by MIN(source_ply) i.e. bucket order, not by n.
    expect(s.byMoveBucket).toEqual([
      { key: "1-10", n: 2, pct: 40, avgCpl: 250 },
      { key: "11-20", n: 1, pct: 20, avgCpl: 400 },
      { key: "21-30", n: 1, pct: 20, avgCpl: 500 },
      { key: "31+", n: 1, pct: 20, avgCpl: 600 },
    ]);
  });

  it("rounds pct to 1 decimal place (non-terminating fraction)", () => {
    const puzzles: Puzzle[] = [
      pz({ dedupeKey: "1", phase: "opening", cpl: 150, sourcePly: 1 }),
      pz({ dedupeKey: "2", phase: "middlegame", cpl: 150, sourcePly: 1 }),
      pz({ dedupeKey: "3", phase: "endgame", cpl: 150, sourcePly: 1 }),
    ];
    const s = weaknessSummary(puzzles);
    for (const row of s.byPhase) {
      expect(row.pct).toBeCloseTo(33.3, 5);
    }
  });

  it("group avgCpl uses SQLite ROUND (half-AWAY-from-zero) on an exact .5 tie", () => {
    // avg = (10 + 15) / 2 = 12.5 -> SQLite ROUND(12.5, 0) == 13 (away), NOT
    // Python builtin round(12.5) == 12 (banker's). Group fields use SQL ROUND().
    const puzzles: Puzzle[] = [
      pz({ dedupeKey: "1", phase: "opening", cpl: 10, sourcePly: 1 }),
      pz({ dedupeKey: "2", phase: "opening", cpl: 15, sourcePly: 1 }),
    ];
    const s = weaknessSummary(puzzles);
    expect(s.byPhase[0].avgCpl).toBe(13);
  });

  it("group pct uses SQLite ROUND (half-AWAY-from-zero) on a .05 tie at 1 dp", () => {
    // 1 of 16 -> 6.25% -> SQLite ROUND(6.25, 1) == 6.3 (away), not 6.2 (banker's).
    const puzzles: Puzzle[] = [
      pz({ dedupeKey: "odd", phase: "opening", cpl: 100, sourcePly: 1 }),
      ...Array.from({ length: 15 }, (_, i) =>
        pz({ dedupeKey: `m${i}`, phase: "middlegame", cpl: 100, sourcePly: 1 })
      ),
    ];
    const s = weaknessSummary(puzzles);
    const opening = s.byPhase.find((r) => r.key === "opening")!;
    expect(opening.pct).toBe(6.3);
  });

  it("TOP-LEVEL avgCpl uses Python builtin round (banker's / half-to-even) at 1 dp", () => {
    // avg = 49 / 4 = 12.25 -> Python round(12.25, 1) == 12.2 (even), NOT the
    // SQL half-away 12.3. Distinguishes the top-level path from the group path.
    const puzzles: Puzzle[] = [
      pz({ dedupeKey: "1", cpl: 12, sourcePly: 1 }),
      pz({ dedupeKey: "2", cpl: 12, sourcePly: 1 }),
      pz({ dedupeKey: "3", cpl: 12, sourcePly: 1 }),
      pz({ dedupeKey: "4", cpl: 13, sourcePly: 1 }),
    ];
    const s = weaknessSummary(puzzles);
    expect(s.avgCpl).toBe(12.2);
  });
});
