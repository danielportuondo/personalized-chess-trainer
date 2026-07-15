import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { MoveEval, Puzzle, ReviewState } from "./types";

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
