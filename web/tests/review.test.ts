import { describe, it, expect } from "vitest";
import { sm2Update } from "../src/review";

const TODAY = "2026-01-01";

describe("sm2Update", () => {
  it("new pass", () => {
    const s = sm2Update({}, true, TODAY);
    expect(s.reps).toBe(1);
    expect(s.intervalDays).toBe(1);
    expect(s.dueDate).toBe("2026-01-02");
  });

  it("growth", () => {
    const s = sm2Update(
      { ease: 2.5, intervalDays: 6, reps: 2 },
      true,
      TODAY
    );
    expect(s.reps).toBe(3);
    expect(s.intervalDays).toBe(15);
    expect(s.ease).toBe(2.6);
  });

  it("fail collapses and resurfaces sooner", () => {
    const far = { ease: 2.5, intervalDays: 15, reps: 3 };
    const passed = sm2Update(far, true, TODAY);
    const failed = sm2Update(far, false, TODAY);
    expect(failed.intervalDays).toBe(1);
    expect(failed.reps).toBe(0);
    expect(failed.lapses).toBe(1);
    expect(failed.ease).toBe(2.3);
    expect(failed.dueDate < passed.dueDate).toBe(true);
  });

  it("interval uses Python banker's rounding on .5 ties", () => {
    // Python round(5 * 2.5) == round(12.5) == 12 (not 13)
    const s = sm2Update({ ease: 2.5, intervalDays: 5, reps: 2 }, true, TODAY);
    expect(s.reps).toBe(3);
    expect(s.intervalDays).toBe(12);
  });

  it("ease floor 1.3", () => {
    let s: any = { ease: 1.3, intervalDays: 5, reps: 2 };
    for (let i = 0; i < 3; i++) {
      s = sm2Update(s, false, TODAY);
      expect(s.ease).toBe(1.3);
    }
  });
});
