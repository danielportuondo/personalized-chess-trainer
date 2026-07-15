import { describe, it, expect } from "vitest";
import { applyReviewToMeta } from "../src/progress";
import type { Meta } from "../src/types";

const base = (o: Partial<Meta> = {}): Meta => ({
  username: "u",
  xp: 0,
  currentStreak: 0,
  bestStreak: 0,
  lastActiveDate: "",
  ...o,
});

const TODAY = "2026-07-15";
const YEST = "2026-07-14";

describe("applyReviewToMeta", () => {
  it("first pass ever seeds streak 1 and awards XP", () => {
    const next = applyReviewToMeta(base(), true, TODAY);
    expect(next.xp).toBe(1);
    expect(next.currentStreak).toBe(1);
    expect(next.bestStreak).toBe(1);
    expect(next.lastActiveDate).toBe(TODAY);
  });

  it("a miss still counts as activity but earns no XP", () => {
    const next = applyReviewToMeta(base(), false, TODAY);
    expect(next.xp).toBe(0);
    expect(next.currentStreak).toBe(1);
    expect(next.bestStreak).toBe(1);
    expect(next.lastActiveDate).toBe(TODAY);
  });

  it("consecutive day increments the streak", () => {
    const prior = base({ xp: 5, currentStreak: 3, bestStreak: 3, lastActiveDate: YEST });
    const next = applyReviewToMeta(prior, true, TODAY);
    expect(next.currentStreak).toBe(4);
    expect(next.bestStreak).toBe(4);
    expect(next.xp).toBe(6);
  });

  it("same-day second review leaves streak unchanged but still adds XP", () => {
    const prior = base({ xp: 2, currentStreak: 2, bestStreak: 5, lastActiveDate: TODAY });
    const next = applyReviewToMeta(prior, true, TODAY);
    expect(next.currentStreak).toBe(2);
    expect(next.bestStreak).toBe(5);
    expect(next.xp).toBe(3);
  });

  it("a gap resets streak to 1 but preserves bestStreak", () => {
    const prior = base({ xp: 9, currentStreak: 7, bestStreak: 7, lastActiveDate: "2026-07-10" });
    const next = applyReviewToMeta(prior, true, TODAY);
    expect(next.currentStreak).toBe(1);
    expect(next.bestStreak).toBe(7);
    expect(next.xp).toBe(10);
  });

  it("preserves username on the returned object and does not mutate the input", () => {
    const prior = base({ username: "alice", xp: 1, currentStreak: 1, bestStreak: 1, lastActiveDate: YEST });
    const snapshot = { ...prior };
    const next = applyReviewToMeta(prior, true, TODAY);
    expect(next.username).toBe("alice");
    expect(prior).toEqual(snapshot);
  });
});
