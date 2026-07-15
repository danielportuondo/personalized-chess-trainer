import { describe, it, expect, vi } from "vitest";
import { runPipeline } from "../src/pipeline";
import { BASE_URL } from "../src/chesscom";
import type { AnalysisInfo, AnalyseFn } from "../src/analysis";
import type { createEngine, Engine } from "../src/engine";

// Fake fetchImpl: archives list + one month payload with two games where
// "dportuondo" plays (once as White, once as Black) — mirrors chesscom.test.ts's style.
const ARCHIVES_URL = `${BASE_URL}/player/dportuondo/games/archives`;
const JAN = `${BASE_URL}/player/dportuondo/games/2024/01`;

const GAME1_PGN = '[White "dportuondo"]\n[Black "opp"]\n\n1. e4 *';
const GAME2_PGN = '[White "opp2"]\n[Black "dportuondo"]\n\n1. d4 d5 2. c4 *';

function fakeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
  };
}

function rawGame(overrides: Record<string, unknown> = {}) {
  return {
    url: `game-${Math.random()}`,
    pgn: GAME1_PGN,
    white: { username: "dportuondo", result: "win" },
    black: { username: "opp", result: "resigned" },
    time_class: "rapid",
    time_control: "600",
    rules: "chess",
    end_time: 1000,
    ...overrides,
  };
}

function fakeFetch(): typeof fetch {
  const payload = {
    games: [
      rawGame({ url: "game-1", pgn: GAME1_PGN, end_time: 200 }),
      rawGame({
        url: "game-2",
        pgn: GAME2_PGN,
        white: { username: "opp2", result: "win" },
        black: { username: "dportuondo", result: "resigned" },
        end_time: 100,
      }),
    ],
  };
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url === ARCHIVES_URL) return fakeResponse(200, { archives: [JAN] });
    if (url === JAN) return fakeResponse(200, payload);
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

// Fake createEngineFn: analyse() plays back a scripted AnalysisInfo sequence
// (call-ordered, like analysis-game.test.ts's fakeAnalyse); newGame/quit are spies.
function fakeEngineFactory(infos: AnalysisInfo[]): {
  createEngineFn: typeof createEngine;
  engine: Engine;
} {
  let idx = 0;
  const analyse: AnalyseFn = vi.fn(async (_fen: string) => infos[idx++]);
  const newGame = vi.fn(async () => {});
  const quit = vi.fn();
  const engine: Engine = { analyse, newGame, quit };
  const createEngineFn = vi.fn(async () => engine) as unknown as typeof createEngine;
  return { createEngineFn, engine };
}

describe("runPipeline", () => {
  it("wires fetch -> per-game newGame+analyze -> extract -> summary end to end", async () => {
    // game1 (White=dportuondo, 1 player move: e4): before=40 (white pov), after=9000 (black
    // pov, since it's black to move post-e4) -> flips to -9000 white pov -> cpl=9040 (blunder,
    // and evalAfterPlayedCp <= -9000 classifies as "allowed forced mate").
    // game2 (Black=dportuondo, 1 player move: ...d5): before=10 (black pov), after=5 (white
    // pov post-d5) -> flips to -5 black pov -> cpl=15 (not a puzzle).
    const infos: AnalysisInfo[] = [
      { cp: 40, mate: null, pv: ["e2e4"] },
      { cp: 9000, mate: null, pv: [] },
      { cp: 10, mate: null, pv: ["d7d5"] },
      { cp: 5, mate: null, pv: [] },
    ];
    const { createEngineFn, engine } = fakeEngineFactory(infos);
    const onProgress = vi.fn();

    const result = await runPipeline("dportuondo", {
      maxGames: 2,
      depth: 12,
      fetchImpl: fakeFetch(),
      createEngineFn,
      onProgress,
    });

    expect(result.puzzles.length).toBeGreaterThanOrEqual(1);
    expect(result.summary.totalMistakes).toBeGreaterThan(0);
    expect(result.puzzles[0].cpl).toBe(9040);
    expect(result.puzzles[0].motif).toBe("allowed forced mate");
    expect(result.summary.byMotif).toContainEqual(
      expect.objectContaining({ key: "allowed forced mate", n: 1 })
    );
    expect(result.summary.byMotif.some((row) => row.key === "unknown")).toBe(false);

    expect(engine.newGame).toHaveBeenCalledTimes(2); // once per game
    expect(engine.quit).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("still calls quit() when analyse throws mid-pipeline (finally teardown)", async () => {
    const analyse: AnalyseFn = vi.fn(async (_fen: string) => {
      throw new Error("engine exploded");
    });
    const newGame = vi.fn(async () => {});
    const quit = vi.fn();
    const engine: Engine = { analyse, newGame, quit };
    const createEngineFn = vi.fn(async () => engine) as unknown as typeof createEngine;

    await expect(
      runPipeline("dportuondo", {
        maxGames: 2,
        fetchImpl: fakeFetch(),
        createEngineFn,
      })
    ).rejects.toThrow("engine exploded");

    expect(quit).toHaveBeenCalledTimes(1);
  });
});
