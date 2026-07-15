import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, it, expect, afterEach } from "vitest";
import { openTrainerDb, DB_NAME, getMeta, putMeta } from "../src/db";
import type { Meta } from "../src/types";

afterEach(async () => {
  await indexedDB.deleteDatabase(DB_NAME);
});

describe("fresh v2 open", () => {
  it("creates all four object stores, including meta", async () => {
    const db = await openTrainerDb();

    expect(Array.from(db.objectStoreNames).sort()).toEqual([
      "analyses",
      "puzzles",
      "reviewState",
      "meta",
    ].sort());

    db.close();
  });
});

describe("v1 -> v2 migration", () => {
  it("preserves existing analyses/puzzles records and adds the meta store", async () => {
    // Seed a v1 DB exactly as today's versionless upgrade() does.
    const v1db = await openDB(DB_NAME, 1, {
      upgrade(db) {
        const analyses = db.createObjectStore("analyses", {
          keyPath: ["username", "gameUrl"],
        });
        analyses.createIndex("by_username", "username");

        const puzzles = db.createObjectStore("puzzles", {
          keyPath: ["username", "dedupeKey"],
        });
        puzzles.createIndex("by_username", "username");

        const reviewState = db.createObjectStore("reviewState", {
          keyPath: ["username", "dedupeKey"],
        });
        reviewState.createIndex("by_username", "username");
      },
    });

    await v1db.put("analyses", {
      username: "alice",
      gameUrl: "game-1",
      evals: [],
      analyzedAt: "2026-01-01T00:00:00.000Z",
    });
    await v1db.put("puzzles", {
      username: "alice",
      dedupeKey: "dk1",
      fen: "fen",
      solutionLineUci: "e2e4",
      playedMoveUci: "e2e3",
      bestMoveUci: "e2e4",
      cpl: 50,
      evalBeforeCp: 10,
      sourceGameUrl: "game-1",
      sourcePly: 1,
    });
    v1db.close();

    const db = await openTrainerDb();

    expect(Array.from(db.objectStoreNames).sort()).toEqual([
      "analyses",
      "puzzles",
      "reviewState",
      "meta",
    ].sort());

    const analysesRecord = await db.get("analyses", ["alice", "game-1"]);
    expect(analysesRecord).toEqual({
      username: "alice",
      gameUrl: "game-1",
      evals: [],
      analyzedAt: "2026-01-01T00:00:00.000Z",
    });

    const puzzleRecord = await db.get("puzzles", ["alice", "dk1"]);
    expect(puzzleRecord?.dedupeKey).toBe("dk1");

    const meta = await getMeta(db, "alice");
    expect(meta).toEqual({
      username: "alice",
      xp: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastActiveDate: "",
    });

    db.close();
  });
});

describe("getMeta/putMeta", () => {
  it("round-trips a stored Meta record", async () => {
    const db = await openTrainerDb();
    const meta: Meta = {
      username: "alice",
      xp: 42,
      currentStreak: 3,
      bestStreak: 7,
      lastActiveDate: "2026-01-05",
    };

    await putMeta(db, meta);
    const stored = await getMeta(db, "alice");

    expect(stored).toEqual(meta);

    db.close();
  });

  it("returns a zeroed default carrying the requested username when absent", async () => {
    const db = await openTrainerDb();

    const meta = await getMeta(db, "bob");

    expect(meta).toEqual({
      username: "bob",
      xp: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastActiveDate: "",
    });

    db.close();
  });
});
