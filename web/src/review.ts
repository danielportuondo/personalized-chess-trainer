import { ReviewState } from "./types";
import { addDays } from "./dates";

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
    interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(interval * ease);
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
    ease: Math.round(ease * 1000) / 1000,
    intervalDays: interval,
    reps,
    lapses,
    dueDate: addDays(today, interval),
    lastResult,
    lastReviewed: today,
  };
}
