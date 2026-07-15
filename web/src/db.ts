import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { MoveEval, Puzzle, ReviewState } from "./types";
import { sm2Update } from "./review";

export const DB_NAME = "chess-trainer";
export const DB_VERSION = 1;

export interface TrainerSchema extends DBSchema {
  analyses: {
    key: [string, string];
    value: {
      username: string;
      gameUrl: string;
      evals: MoveEval[];
      analyzedAt: string;
    };
    indexes: { by_username: string };
  };
  puzzles: {
    key: [string, string];
    value: Puzzle & { username: string };
    indexes: { by_username: string };
  };
  reviewState: {
    key: [string, string];
    value: ReviewState & { username: string; dedupeKey: string };
    indexes: { by_username: string };
  };
}

export async function getAnalyzedGameUrls(
  db: IDBPDatabase<TrainerSchema>,
  username: string,
): Promise<Set<string>> {
  const records = await db.getAllFromIndex("analyses", "by_username", username);
  return new Set(records.map((record) => record.gameUrl));
}

export async function putAnalysis(
  db: IDBPDatabase<TrainerSchema>,
  username: string,
  gameUrl: string,
  evals: MoveEval[],
): Promise<void> {
  // Empty evals must still be written so variant/zero-eval games count as
  // analyzed and aren't re-analyzed on every run.
  await db.put("analyses", {
    username,
    gameUrl,
    evals,
    analyzedAt: new Date().toISOString(),
  });
}

export async function getAllEvals(
  db: IDBPDatabase<TrainerSchema>,
  username: string,
): Promise<MoveEval[]> {
  const records = await db.getAllFromIndex("analyses", "by_username", username);
  return records.flatMap((record) => record.evals);
}

export async function putPuzzlesIfAbsent(
  db: IDBPDatabase<TrainerSchema>,
  username: string,
  puzzles: Puzzle[],
): Promise<number> {
  let inserted = 0;
  // Per-puzzle getKey+put (not a single readwrite tx) — idb auto-closes a
  // transaction once control returns to the microtask queue without an
  // outstanding request, so mixing awaits on non-idb work inside one tx risks
  // premature closure. This mirrors extract.py:31's INSERT OR IGNORE: first-wins.
  for (const puzzle of puzzles) {
    const existing = await db.getKey("puzzles", [username, puzzle.dedupeKey]);
    if (existing === undefined) {
      await db.put("puzzles", { ...puzzle, username });
      inserted += 1;
    }
  }
  return inserted;
}

export async function getAllPuzzles(
  db: IDBPDatabase<TrainerSchema>,
  username: string,
): Promise<Puzzle[]> {
  const records = await db.getAllFromIndex("puzzles", "by_username", username);
  return records.map(({ username: _username, ...puzzle }) => puzzle);
}

export async function getReviewByKey(
  db: IDBPDatabase<TrainerSchema>,
  username: string,
): Promise<Record<string, ReviewState>> {
  const records = await db.getAllFromIndex("reviewState", "by_username", username);
  const byKey: Record<string, ReviewState> = {};
  for (const { username: _username, dedupeKey, ...state } of records) {
    byKey[dedupeKey] = state;
  }
  return byKey;
}

export async function recordResult(
  db: IDBPDatabase<TrainerSchema>,
  username: string,
  dedupeKey: string,
  passed: boolean,
  today: string,
): Promise<ReviewState> {
  const prior = await db.get("reviewState", [username, dedupeKey]);
  const next = sm2Update(prior ?? {}, passed, today);
  await db.put("reviewState", { ...next, username, dedupeKey });
  return next;
}

export function openTrainerDb(): Promise<IDBPDatabase<TrainerSchema>> {
  return openDB<TrainerSchema>(DB_NAME, DB_VERSION, {
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
}
