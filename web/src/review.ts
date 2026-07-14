import { ReviewState } from "./types";
import { addDays } from "./dates";

// Python's round() is round-half-to-even (banker's); JS Math.round() is
// round-half-away-from-zero. They diverge on exact .5 ties (e.g. round(12.5)
// == 12 in Python but Math.round(12.5) === 13), which occur here for odd
// interval * ease ending in .5. Match Python for behavior-identical parity.
function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
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
    ease: pyRound(ease * 1000) / 1000,
    intervalDays: interval,
    reps,
    lapses,
    dueDate: addDays(today, interval),
    lastResult,
    lastReviewed: today,
  };
}
