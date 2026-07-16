import { Meta } from "./types";
import { addDays } from "./dates";

// `run` is the current session run length (consecutive correct solves) after
// this result — 0 on a miss. It only ever raises bestRun; it never touches the
// calendar day-streak. Defaults to 0 so day-streak-only callers are unaffected.
export function applyReviewToMeta(meta: Meta, passed: boolean, today: string, run = 0): Meta {
  const currentStreak =
    meta.lastActiveDate === today
      ? meta.currentStreak
      : meta.lastActiveDate === addDays(today, -1)
        ? meta.currentStreak + 1
        : 1;

  return {
    username: meta.username,
    xp: meta.xp + (passed ? 1 : 0),
    currentStreak,
    bestStreak: Math.max(meta.bestStreak, currentStreak),
    bestRun: Math.max(meta.bestRun ?? 0, run),
    lastActiveDate: today,
  };
}
