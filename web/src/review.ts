import { Puzzle, ReviewState, WeaknessSummary } from "./types";
import { addDays } from "./dates";

// Python's round() is round-half-to-even (banker's); JS Math.round() is
// round-half-away-from-zero. They diverge on exact .5 ties (e.g. round(12.5)
// == 12 in Python but Math.round(12.5) === 13). Match Python for
// behavior-identical parity. ndigits mirrors Python's round(x, ndigits).
export function pyRound(x: number, ndigits = 0): number {
  const factor = 10 ** ndigits;
  const scaled = x * factor;
  const f = Math.floor(scaled);
  const d = scaled - f;
  const rounded = d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
  return rounded / factor;
}

export function sm2Update(
  state: Partial<ReviewState>,
  passed: boolean,
  today: string
): ReviewState {
  let ease = state.ease ?? 2.5;
  let interval = state.intervalDays ?? 0;
  let reps = state.reps ?? 0;
  let lapses = state.lapses ?? 0;
  let lastResult: 0 | 1;

  if (passed) {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 6 : pyRound(interval * ease);
    ease = Math.min(3.0, ease + 0.1);
    lastResult = 1;
  } else {
    reps = 0;
    lapses += 1;
    interval = 1;
    ease = Math.max(1.3, ease - 0.2);
    lastResult = 0;
  }

  return {
    ease: pyRound(ease, 3),
    intervalDays: interval,
    reps,
    lapses,
    dueDate: addDays(today, interval),
    lastResult,
    lastReviewed: today,
  };
}

// Port of train.py:108-109's `score()`. Deliberately looks up the puzzle's
// raw (possibly undefined) phase/motif — matching Python's
// `phase_pct.get(pz["phase"], 0)` on the raw column value, which is None
// (not the string "unknown") for untagged puzzles. dict.get(None, 0) never
// matches the "unknown" bucket key, so untagged puzzles score 0 here even
// though weaknessSummary reports a nonzero "unknown" pct.
export function puzzleWeight(puzzle: Puzzle, summary: WeaknessSummary): number {
  const phasePct: Record<string, number> = {};
  for (const row of summary.byPhase) phasePct[row.key] = row.pct;
  const motifPct: Record<string, number> = {};
  for (const row of summary.byMotif) motifPct[row.key] = row.pct;

  const p = puzzle.phase !== undefined ? phasePct[puzzle.phase] : undefined;
  const m = puzzle.motif !== undefined ? motifPct[puzzle.motif] : undefined;
  return 1 + (p ?? 0) / 100 + (m ?? 0) / 100;
}

// Efraimidis-Spirakis weighted sampling without replacement (train.py:79-86).
function weightedSample<T>(items: T[], weights: number[], k: number): T[] {
  const keyed = items.map((item, i) => ({ item, rank: Math.random() ** (1 / weights[i]) }));
  keyed.sort((a, b) => b.rank - a.rank);
  return keyed.slice(0, k).map((x) => x.item);
}

// Candidates for review: puzzles never reviewed, or whose reviewState is due
// today or earlier. Shared by selectDuePuzzles (weighted drill selection) and
// the profile screen's due-count badge, so both use the exact same predicate.
export function dueCandidates(
  puzzles: Puzzle[],
  reviewByKey: Record<string, ReviewState>,
  today: string
): Puzzle[] {
  return puzzles.filter((p) => {
    const r = reviewByKey[p.dedupeKey];
    return !r || r.dueDate <= today;
  });
}

// Port of train.py:89-111. `summary` is supplied by the caller (typically
// weaknessSummary(puzzles)) rather than recomputed here, so this module has
// no dependency on profile.ts.
export function selectDuePuzzles(
  puzzles: Puzzle[],
  reviewByKey: Record<string, ReviewState>,
  summary: WeaknessSummary,
  today: string,
  size = 15
): Puzzle[] {
  const candidates = dueCandidates(puzzles, reviewByKey, today);

  const ordered = [...candidates].sort((a, b) => {
    const ra = reviewByKey[a.dedupeKey];
    const rb = reviewByKey[b.dedupeKey];
    const aHas = ra ? 1 : 0;
    const bHas = rb ? 1 : 0;
    if (aHas !== bHas) return aHas - bHas;
    if (!ra || !rb) return 0;
    return ra.dueDate < rb.dueDate ? -1 : ra.dueDate > rb.dueDate ? 1 : 0;
  });

  if (ordered.length <= size) return ordered;

  const weights = ordered.map((p) => puzzleWeight(p, summary));
  return weightedSample(ordered, weights, size);
}
