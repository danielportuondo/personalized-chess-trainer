import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import {
  openTrainerDb,
  DB_NAME,
  putPuzzlesIfAbsent,
  putPuzzles,
  getAllPuzzles,
  getReviewByKey,
  recordResult,
} from "../src/db";
import type { Puzzle } from "../src/types";

afterEach(async () => {
  await indexedDB.deleteDatabase(DB_NAME);
});

const TODAY = "2026-01-01";

function makePuzzle(dedupeKey: string, overrides: Partial<Puzzle> = {}): Puzzle {
  return {
    fen: "fen",
    solutionLineUci: "e2e4",
    playedMoveUci: "e2e3",
    bestMoveUci: "e2e4",
    cpl: 50,
    evalBeforeCp: 10,
    sourceGameUrl: "g1",
    sourcePly: 1,
    dedupeKey,
    ...overrides,
  };
}

describe("putPuzzlesIfAbsent", () => {
  it("inserts absent dedupeKeys and returns the inserted count", async () => {
    const db = await openTrainerDb();

    const count = await putPuzzlesIfAbsent(db, "alice", [
      makePuzzle("dk1"),
      makePuzzle("dk2"),
    ]);

    expect(count).toBe(2);
    const all = await getAllPuzzles(db, "alice");
    expect(all).toHaveLength(2);

    db.close();
  });

  it("first-wins: re-inserting an existing dedupeKey with different fields returns 0 and leaves the stored puzzle unchanged", async () => {
    const db = await openTrainerDb();

    await putPuzzlesIfAbsent(db, "alice", [makePuzzle("dk1", { cpl: 50, fen: "fen" })]);
    const count = await putPuzzlesIfAbsent(db, "alice", [
      makePuzzle("dk1", { cpl: 999, fen: "different-fen" }),
    ]);

    expect(count).toBe(0);
    const all = await getAllPuzzles(db, "alice");
    expect(all).toHaveLength(1);
    expect(all[0].cpl).toBe(50);
    expect(all[0].fen).toBe("fen");

    db.close();
  });
});

describe("putPuzzles", () => {
  it("overwrites an existing row in place and leaves reviewState intact", async () => {
    const db = await openTrainerDb();

    await putPuzzlesIfAbsent(db, "alice", [makePuzzle("dk1", { ambiguous: true })]);
    await recordResult(db, "alice", "dk1", true, TODAY);

    await putPuzzles(db, "alice", [makePuzzle("dk1", { ambiguous: false })]);

    const all = await getAllPuzzles(db, "alice");
    expect(all).toHaveLength(1);
    expect(all[0].ambiguous).toBe(false);

    const byKey = await getReviewByKey(db, "alice");
    expect(byKey["dk1"].reps).toBe(1);

    db.close();
  });
});

describe("getAllPuzzles", () => {
  it("returns clean Puzzle[] with no username property leaking", async () => {
    const db = await openTrainerDb();
    await putPuzzlesIfAbsent(db, "alice", [makePuzzle("dk1")]);

    const all = await getAllPuzzles(db, "alice");

    expect(all).toHaveLength(1);
    expect("username" in all[0]).toBe(false);
    expect(all[0].dedupeKey).toBe("dk1");

    db.close();
  });
});

describe("getReviewByKey", () => {
  it("returns Record<dedupeKey, ReviewState> with clean values (no username/dedupeKey props)", async () => {
    const db = await openTrainerDb();
    await recordResult(db, "alice", "dk1", true, TODAY);

    const byKey = await getReviewByKey(db, "alice");

    expect(Object.keys(byKey)).toEqual(["dk1"]);
    expect("username" in byKey["dk1"]).toBe(false);
    expect("dedupeKey" in byKey["dk1"]).toBe(false);
    expect(byKey["dk1"].reps).toBe(1);

    db.close();
  });
});

describe("recordResult", () => {
  it("first pass on a fresh key seeds reps:1, intervalDays:1", async () => {
    const db = await openTrainerDb();

    const state = await recordResult(db, "alice", "dk1", true, TODAY);

    expect(state.reps).toBe(1);
    expect(state.intervalDays).toBe(1);

    const persisted = await db.get("reviewState", ["alice", "dk1"]);
    expect(persisted).toMatchObject({ reps: 1, intervalDays: 1, username: "alice", dedupeKey: "dk1" });

    db.close();
  });

  it("second pass reads prior state and grows to reps:2, intervalDays:6 (ON CONFLICT DO UPDATE parity)", async () => {
    const db = await openTrainerDb();

    await recordResult(db, "alice", "dk1", true, TODAY);
    const state = await recordResult(db, "alice", "dk1", true, "2026-01-02");

    expect(state.reps).toBe(2);
    expect(state.intervalDays).toBe(6);

    const persisted = await db.get("reviewState", ["alice", "dk1"]);
    expect(persisted).toMatchObject({ reps: 2, intervalDays: 6 });
    expect(state).toEqual(await (async () => {
      const { username: _u, dedupeKey: _dk, ...clean } = (await db.get("reviewState", ["alice", "dk1"]))!;
      return clean;
    })());

    db.close();
  });

  it("a fail collapses reps:0, intervalDays:1, lapses:1", async () => {
    const db = await openTrainerDb();

    await recordResult(db, "alice", "dk1", true, TODAY);
    await recordResult(db, "alice", "dk1", true, "2026-01-02");
    const state = await recordResult(db, "alice", "dk1", false, "2026-01-10");

    expect(state.reps).toBe(0);
    expect(state.intervalDays).toBe(1);
    expect(state.lapses).toBe(1);

    const persisted = await db.get("reviewState", ["alice", "dk1"]);
    expect(persisted).toMatchObject({ reps: 0, intervalDays: 1, lapses: 1 });

    db.close();
  });
});

describe("preservation", () => {
  it("recordResult then a repeat putPuzzlesIfAbsent leaves the puzzle and reviewState intact", async () => {
    const db = await openTrainerDb();

    await putPuzzlesIfAbsent(db, "alice", [makePuzzle("dk1", { cpl: 50 })]);
    await recordResult(db, "alice", "dk1", true, TODAY);

    const count = await putPuzzlesIfAbsent(db, "alice", [makePuzzle("dk1", { cpl: 999 })]);

    expect(count).toBe(0);
    const puzzles = await getAllPuzzles(db, "alice");
    expect(puzzles[0].cpl).toBe(50);

    const byKey = await getReviewByKey(db, "alice");
    expect(byKey["dk1"].reps).toBe(1);

    db.close();
  });
});

describe("cross-user isolation", () => {
  it("puzzles and reviewState under 'alice' are invisible to helpers for 'bob'", async () => {
    const db = await openTrainerDb();

    await putPuzzlesIfAbsent(db, "alice", [makePuzzle("dk1")]);
    await recordResult(db, "alice", "dk1", true, TODAY);

    expect(await getAllPuzzles(db, "bob")).toEqual([]);
    expect(await getReviewByKey(db, "bob")).toEqual({});

    expect(await getAllPuzzles(db, "alice")).toHaveLength(1);
    expect(Object.keys(await getReviewByKey(db, "alice"))).toEqual(["dk1"]);

    db.close();
  });
});
