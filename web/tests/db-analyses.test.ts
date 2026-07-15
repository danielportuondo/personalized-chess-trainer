import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import {
  openTrainerDb,
  DB_NAME,
  getAnalyzedGameUrls,
  putAnalysis,
  getAllEvals,
} from "../src/db";
import type { MoveEval } from "../src/types";

afterEach(async () => {
  await indexedDB.deleteDatabase(DB_NAME);
});

function makeEval(gameUrl: string, ply: number, cpl: number): MoveEval {
  return {
    gameUrl,
    ply,
    fullmoveNo: Math.ceil(ply / 2),
    playerColor: ply % 2 === 1 ? "white" : "black",
    fenBefore: "fen",
    playedMoveUci: "e2e3",
    bestMoveUci: "e2e4",
    bestLineUci: "e2e4 e7e5",
    evalBeforeCp: 10,
    evalAfterPlayedCp: 10 - cpl,
    cpl,
  };
}

describe("analyses store helpers", () => {
  it("putAnalysis then getAnalyzedGameUrls returns the persisted URL", async () => {
    const db = await openTrainerDb();

    await putAnalysis(db, "alice", "game-1", [makeEval("game-1", 1, 20)]);

    const urls = await getAnalyzedGameUrls(db, "alice");
    expect(urls).toEqual(new Set(["game-1"]));

    db.close();
  });

  it("empty evals array still marks the gameUrl as analyzed", async () => {
    const db = await openTrainerDb();

    await putAnalysis(db, "alice", "variant-game", []);

    const urls = await getAnalyzedGameUrls(db, "alice");
    expect(urls).toEqual(new Set(["variant-game"]));

    db.close();
  });

  it("getAllEvals concatenates evals across multiple analyses records for the user", async () => {
    const db = await openTrainerDb();

    await putAnalysis(db, "alice", "game-1", [
      makeEval("game-1", 1, 20),
      makeEval("game-1", 3, 40),
    ]);
    await putAnalysis(db, "alice", "game-2", [makeEval("game-2", 1, 10)]);

    const evals = await getAllEvals(db, "alice");
    expect(evals).toHaveLength(3);
    expect(evals.map((e) => e.cpl).sort()).toEqual([10, 20, 40]);

    db.close();
  });

  it("cross-user isolation: analyses under 'a' are invisible to helpers for 'b'", async () => {
    const db = await openTrainerDb();

    await putAnalysis(db, "a", "game-1", [makeEval("game-1", 1, 20)]);

    const urlsForB = await getAnalyzedGameUrls(db, "b");
    expect(urlsForB).toEqual(new Set());

    const evalsForB = await getAllEvals(db, "b");
    expect(evalsForB).toEqual([]);

    const urlsForA = await getAnalyzedGameUrls(db, "a");
    expect(urlsForA).toEqual(new Set(["game-1"]));

    db.close();
  });

  it("putAnalysis sets analyzedAt to an ISO timestamp", async () => {
    const db = await openTrainerDb();

    await putAnalysis(db, "alice", "game-1", []);
    const record = await db.get("analyses", ["alice", "game-1"]);

    expect(record?.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    db.close();
  });
});
