import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import { openTrainerDb, DB_NAME, recordProgress, getMeta } from "../src/db";

afterEach(async () => {
  await indexedDB.deleteDatabase(DB_NAME);
});

const TODAY = "2026-07-15";
const YEST = "2026-07-14";

describe("recordProgress", () => {
  it("reads prior state, applies, and persists across calls", async () => {
    const db = await openTrainerDb();

    await recordProgress(db, "u", true, YEST);
    const next = await recordProgress(db, "u", true, TODAY);

    expect(next.currentStreak).toBe(2);
    expect(next.xp).toBe(2);
    expect(next.bestStreak).toBe(2);
    expect(next.lastActiveDate).toBe(TODAY);

    const persisted = await getMeta(db, "u");
    expect(persisted).toEqual(next);

    db.close();
  });
});
