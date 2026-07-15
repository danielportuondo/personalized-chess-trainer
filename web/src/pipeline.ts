// Orchestrates the full client-side analysis flow: fetch -> per-game engine
// analysis -> flatten -> puzzle extraction -> weakness summary. Port of
// __main__.py's `pipeline` command (ingest -> analyze -> extract -> profile),
// minus persistence: everything here is in-memory, computed fresh per call.
import type { MoveEval, Puzzle, WeaknessSummary } from "./types";
import { fetchRecentGames } from "./chesscom";
import { analyzeGame } from "./analysis";
import { createEngine } from "./engine";
import { extractPuzzles } from "./extract";
import { weaknessSummary } from "./profile";

export interface RunPipelineOptions {
  maxGames?: number;
  depth?: number;
  onProgress?: (done: number, total: number) => void;
  fetchImpl?: typeof fetch;
  createEngineFn?: typeof createEngine;
}

const DEFAULT_MAX_GAMES = 20;
const DEFAULT_DEPTH = 12;

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
    const summary = weaknessSummary(puzzles);
    return { puzzles, summary };
  } finally {
    engine.quit(); // tear down the worker even if fetch/analysis threw
  }
}
