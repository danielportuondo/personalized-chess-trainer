// Orchestrates the full client-side analysis flow: fetch -> per-game engine
// analysis -> flatten -> puzzle extraction -> weakness summary. Port of
// __main__.py's `pipeline` command (ingest -> analyze -> extract -> profile),
// minus persistence: everything here is in-memory, computed fresh per call.
import type { IDBPDatabase } from "idb";
import type { MoveEval, Puzzle, WeaknessSummary } from "./types";
import { fetchRecentGames } from "./chesscom";
import { analyzeGame, mateScore } from "./analysis";
import { createEngine, type Engine } from "./engine";
import { extractPuzzles } from "./extract";
import { tagMotifs, weaknessSummary } from "./profile";
import {
  type TrainerSchema,
  getAnalyzedGameUrls,
  putAnalysis,
  getAllEvals,
  putPuzzlesIfAbsent,
  getAllPuzzles,
} from "./db";

export interface RunPipelineOptions {
  maxGames?: number;
  depth?: number;
  onProgress?: (done: number, total: number) => void;
  fetchImpl?: typeof fetch;
  createEngineFn?: typeof createEngine;
}

const DEFAULT_MAX_GAMES = 20;
const DEFAULT_DEPTH = 12;

// A puzzle's solution counts as unique when the second-best move is at least
// this much worse (mate scores bounded via mateScore). Below the gap the
// position has two near-equal answers and the drill would unfairly reject one.
const UNIQUE_GAP_CP = 100;

function boundedCp(info: { cp: number | null; mate: number | null }): number {
  return info.mate != null ? mateScore(info.mate) : (info.cp as number);
}

export async function runPipeline(
  username: string,
  opts: RunPipelineOptions = {}
): Promise<{ puzzles: Puzzle[]; summary: WeaknessSummary }> {
  const {
    maxGames = DEFAULT_MAX_GAMES,
    depth = DEFAULT_DEPTH,
    onProgress,
    fetchImpl,
    createEngineFn = createEngine,
  } = opts;

  const games = await fetchRecentGames(username, { maxGames, fetchImpl });
  const engine = await createEngineFn({ depth });

  try {
    const evals: MoveEval[] = [];
    for (let i = 0; i < games.length; i++) {
      await engine.newGame(); // resets the transposition table so per-game evals are order-independent
      const rows = await analyzeGame(games[i].pgn, username, engine.analyse, games[i].url);
      evals.push(...rows);
      onProgress?.(i + 1, games.length);
    }
    const puzzles = extractPuzzles(evals);
    tagMotifs(puzzles, evals);
    const summary = weaknessSummary(puzzles);
    return { puzzles, summary };
  } finally {
    engine.quit(); // tear down the worker even if fetch/analysis threw
  }
}

// Incremental, persistent counterpart to runPipeline: skips games already in
// the `analyses` store, re-extracts puzzles from ALL persisted evals (own +
// new) each call, and inserts only newly-seen puzzles (existing review state
// is preserved). Mirrors the Python CLI's pipeline command with sqlite
// persistence swapped for IndexedDB (analyze.py:pending_games' incremental
// skip + extract.py's INSERT OR IGNORE + profile.weakness_summary over all
// persisted puzzles).
export async function analyzeAndPersist(
  username: string,
  db: IDBPDatabase<TrainerSchema>,
  opts: RunPipelineOptions = {}
): Promise<{ newGames: number; newPuzzles: number; summary: WeaknessSummary }> {
  const {
    maxGames = DEFAULT_MAX_GAMES,
    depth = DEFAULT_DEPTH,
    onProgress,
    fetchImpl,
    createEngineFn = createEngine,
  } = opts;

  // Normalize once; db.ts's helpers don't lowercase, so every call below (and
  // the fetch/analyze calls, for consistency) must use this same `user`.
  const user = username.toLowerCase();

  const games = await fetchRecentGames(user, { maxGames, fetchImpl });
  const done = await getAnalyzedGameUrls(db, user);
  const pending = games.filter((g) => !done.has(g.url));

  // Re-extracts from ALL persisted evals, uniqueness-checks the puzzles not yet
  // persisted (new dedupeKeys can only come from newly analyzed games, so the
  // engine is available exactly when there's something to check), and inserts
  // first-wins. Without an engine (no pending games) the extraction is a no-op
  // against existing keys anyway.
  async function extractAndInsert(engine: Engine | null): Promise<number> {
    const allEvals = await getAllEvals(db, user);
    const puzzles = extractPuzzles(allEvals);
    tagMotifs(puzzles, allEvals);
    if (engine) {
      const existing = new Set((await getAllPuzzles(db, user)).map((p) => p.dedupeKey));
      for (const p of puzzles) {
        if (existing.has(p.dedupeKey)) continue;
        const { best, second } = await engine.analyseTop2(p.fen);
        p.ambiguous = second != null && boundedCp(best) - boundedCp(second) < UNIQUE_GAP_CP;
      }
    }
    return putPuzzlesIfAbsent(db, user, puzzles);
  }

  let newPuzzles: number;
  if (pending.length > 0) {
    // Only spin up the (WASM worker-backed) engine when there's actually work
    // to do -- a no-op run shouldn't pay for engine startup/teardown.
    const engine = await createEngineFn({ depth });
    try {
      for (let i = 0; i < pending.length; i++) {
        await engine.newGame(); // resets the transposition table so per-game evals are order-independent
        const evals = await analyzeGame(pending[i].pgn, user, engine.analyse, pending[i].url);
        await putAnalysis(db, user, pending[i].url, evals);
        onProgress?.(i + 1, pending.length);
      }
      newPuzzles = await extractAndInsert(engine);
    } finally {
      engine.quit(); // tear down the worker even if analysis threw
    }
  } else {
    newPuzzles = await extractAndInsert(null);
  }

  const summary = weaknessSummary(await getAllPuzzles(db, user));

  return { newGames: pending.length, newPuzzles, summary };
}
