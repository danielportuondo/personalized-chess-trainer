import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import { openTrainerDb, DB_NAME, DB_VERSION } from "../src/db";

// fake-indexeddb persists DB_NAME across `it` blocks in this process, so reset
// between tests to keep them independent.
afterEach(async () => {
  await indexedDB.deleteDatabase(DB_NAME);
});

describe("openTrainerDb", () => {
  it("creates all four object stores, three with a by_username index", async () => {
    const db = await openTrainerDb();

    expect(Array.from(db.objectStoreNames).sort()).toEqual([
      "analyses",
      "meta",
      "puzzles",
      "reviewState",
    ]);

    const tx = db.transaction(["analyses", "puzzles", "reviewState"], "readonly");
    for (const name of ["analyses", "puzzles", "reviewState"] as const) {
      expect(tx.objectStore(name).indexNames.contains("by_username")).toBe(true);
    }
    await tx.done;

    db.close();
  });

  it("is idempotent across repeated opens (no upgrade re-run, no error)", async () => {
    const db1 = await openTrainerDb();
    await db1.put("analyses", {
      username: "a",
      gameUrl: "g1",
      evals: [],
      analyzedAt: "2026-01-01",
    });
    db1.close();

    const db2 = await openTrainerDb();
    expect(db2.version).toBe(DB_VERSION);
    expect(Array.from(db2.objectStoreNames).sort()).toEqual([
      "analyses",
      "meta",
      "puzzles",
      "reviewState",
    ]);
    // Data survived the second open untouched, proving upgrade() didn't re-run
    // (re-running createObjectStore on an existing store would throw).
    const record = await db2.get("analyses", ["a", "g1"]);
    expect(record).toEqual({
      username: "a",
      gameUrl: "g1",
      evals: [],
      analyzedAt: "2026-01-01",
    });

    db2.close();
  });

  it("namespaces records by username: a put under 'a' is invisible to by_username reads for 'b'", async () => {
    const db = await openTrainerDb();

    await db.put("puzzles", {
      username: "a",
      dedupeKey: "dk1",
      fen: "fen-a",
      solutionLineUci: "e2e4",
      playedMoveUci: "e2e3",
      bestMoveUci: "e2e4",
      cpl: 50,
      evalBeforeCp: 10,
      sourceGameUrl: "g1",
      sourcePly: 1,
    });

    const forB = await db.getAllFromIndex("puzzles", "by_username", "b");
    expect(forB).toEqual([]);

    const forA = await db.getAllFromIndex("puzzles", "by_username", "a");
    expect(forA).toHaveLength(1);
    expect(forA[0].dedupeKey).toBe("dk1");

    db.close();
  });
});
