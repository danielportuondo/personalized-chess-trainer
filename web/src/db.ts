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
