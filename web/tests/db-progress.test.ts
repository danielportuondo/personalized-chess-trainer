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

  it("threads the session run into a persisted bestRun high-score", async () => {
    const db = await openTrainerDb();

    await recordProgress(db, "u", true, TODAY, 3);
    const next = await recordProgress(db, "u", true, TODAY, 4);
    expect(next.bestRun).toBe(4);

    await recordProgress(db, "u", false, TODAY, 0); // a miss must not lower it
    const persisted = await getMeta(db, "u");
    expect(persisted.bestRun).toBe(4);

    db.close();
  });

  it("defaults bestRun to 0 for a brand-new player", async () => {
    const db = await openTrainerDb();
    const meta = await getMeta(db, "fresh");
    expect(meta.bestRun).toBe(0);
    db.close();
  });
});
