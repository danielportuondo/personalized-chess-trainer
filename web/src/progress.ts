import { Meta } from "./types";
import { addDays } from "./dates";

export function applyReviewToMeta(meta: Meta, passed: boolean, today: string): Meta {
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
    lastActiveDate: today,
  };
}
