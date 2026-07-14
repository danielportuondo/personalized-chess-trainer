import type { MoveEval, Puzzle } from "./types";

export function dedupeKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

const CPL_THRESHOLD = 150;
const EVAL_CAP = 700;

// Port of extract.py:13-49. The SQL does `ORDER BY cpl DESC` then
// `INSERT OR IGNORE` on dedupe_key, so the highest-cpl occurrence of a
// recurring position wins; sort before deduping to mirror that exactly.
export function extractPuzzles(evals: MoveEval[]): Puzzle[] {
  const candidates = evals.filter(
    (e) => e.cpl >= CPL_THRESHOLD && e.evalBeforeCp > -EVAL_CAP && e.evalAfterPlayedCp < EVAL_CAP
  );
  const sorted = [...candidates].sort((a, b) => b.cpl - a.cpl);

  const seen = new Set<string>();
  const puzzles: Puzzle[] = [];
  for (const row of sorted) {
    const key = dedupeKey(row.fenBefore);
    if (seen.has(key)) continue;
    seen.add(key);
    puzzles.push({
      fen: row.fenBefore,
      solutionLineUci: row.bestLineUci || row.bestMoveUci,
      playedMoveUci: row.playedMoveUci,
      bestMoveUci: row.bestMoveUci,
      cpl: row.cpl,
      evalBeforeCp: row.evalBeforeCp,
      phase: row.phase,
      sourceGameUrl: row.gameUrl,
      sourcePly: row.ply,
      dedupeKey: key,
    });
  }
  return puzzles;
}
