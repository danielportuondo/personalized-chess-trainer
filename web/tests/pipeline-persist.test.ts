import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { analyzeAndPersist } from "../src/pipeline";
import { openTrainerDb, DB_NAME, getAnalyzedGameUrls, getAllPuzzles } from "../src/db";
import { BASE_URL } from "../src/chesscom";
import type { AnalysisInfo, AnalyseFn } from "../src/analysis";
import type { createEngine, Engine } from "../src/engine";

afterEach(async () => {
  await indexedDB.deleteDatabase(DB_NAME);
});

// Fake fetch: archives list + one month payload, same shape as pipeline.test.ts's
// fakeFetch, but reads from a mutable `gamesRef` so the "second run" scenario can
// push a 3rd game onto the SAME fetchImpl instance between calls.
const ARCHIVES_URL = `${BASE_URL}/player/dportuondo/games/archives`;
const JAN = `${BASE_URL}/player/dportuondo/games/2024/01`;

// dportuondo plays Black in all three so fenBefore (captured after White's
// first move) differs by opening move -> distinct dedupeKeys -> distinct puzzles.
const GAME1_PGN = '[White "opp1"]\n[Black "dportuondo"]\n\n1. e4 e5 *';
const GAME2_PGN = '[White "opp2"]\n[Black "dportuondo"]\n\n1. d4 d5 *';
const GAME3_PGN = '[White "opp3"]\n[Black "dportuondo"]\n\n1. c4 c5 *';

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
    white: { username: "opp", result: "win" },
    black: { username: "dportuondo", result: "resigned" },
    time_class: "rapid",
    time_control: "600",
    rules: "chess",
    end_time: 1000,
    ...overrides,
  };
}

function fakeFetch(gamesRef: { games: ReturnType<typeof rawGame>[] }): typeof fetch {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url === ARCHIVES_URL) return fakeResponse(200, { archives: [JAN] });
    if (url === JAN) return fakeResponse(200, { games: gamesRef.games });
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
}

// Fake engine factory: analyse() logs every fen it's asked about (so tests can
// prove exactly which games were touched) and drains a single scripted
// AnalysisInfo queue whose index survives across engine instances/runs --
// analyzeAndPersist creates one engine per call, so the shared `idx` lets us
// assert precisely how many (and which) analyse() calls happened per run.
function makeEngineFn(infos: AnalysisInfo[]) {
  let idx = 0;
  const fensSeen: string[] = [];
  const createEngineFn = vi.fn(async () => {
    const analyse: AnalyseFn = vi.fn(async (fen: string) => {
      fensSeen.push(fen);
      return infos[idx++];
    });
    const newGame = vi.fn(async () => {});
    const quit = vi.fn();
    const engine: Engine = { analyse, newGame, quit };
    return engine;
  }) as unknown as typeof createEngine;
  return { createEngineFn, fensSeen };
}

describe("analyzeAndPersist", () => {
  it("incrementally analyzes only pending games, grows the puzzle union, and is idempotent with no new games", async () => {
    const db = await openTrainerDb();

    const gamesRef = {
      games: [
        rawGame({ url: "game-1", pgn: GAME1_PGN, end_time: 300, white: { username: "opp1", result: "win" } }),
        rawGame({ url: "game-2", pgn: GAME2_PGN, end_time: 200, white: { username: "opp2", result: "win" } }),
      ],
    };
    const fetchImpl = fakeFetch(gamesRef);

    // 2 analyse() calls per game (evalBefore, evalAfter), in fetch order (game1, game2, game3).
    const infos: AnalysisInfo[] = [
      { cp: 10, mate: null, pv: ["e7e5"] },
      { cp: 800, mate: null, pv: [] },
      { cp: 20, mate: null, pv: ["d7d5"] },
      { cp: 900, mate: null, pv: [] },
      { cp: 30, mate: null, pv: ["c7c5"] },
      { cp: 1000, mate: null, pv: [] },
    ];
    const { createEngineFn, fensSeen } = makeEngineFn(infos);

    // --- Phase 1: first run, 2 fresh games. Username is mixed-case to prove
    // analyzeAndPersist normalizes it once and uses that for every db call. ---
    const run1 = await analyzeAndPersist("DPortuondo", db, { fetchImpl, createEngineFn });

    expect(run1.newGames).toBe(2);
    expect(run1.newPuzzles).toBe(2);
    expect(run1.summary.byPhase.length).toBeGreaterThan(0);
    expect(run1.summary.byMotif.length).toBeGreaterThan(0);
    expect(run1.summary.byMoveBucket.length).toBeGreaterThan(0);
    expect(run1.summary.byPhase.some((r) => r.key === "unknown")).toBe(false);
    expect(run1.summary.byMotif.some((r) => r.key === "unknown")).toBe(false);

    const urlsAfterRun1 = await getAnalyzedGameUrls(db, "dportuondo");
    expect(urlsAfterRun1).toEqual(new Set(["game-1", "game-2"]));

    const puzzlesAfterRun1 = await getAllPuzzles(db, "dportuondo");
    expect(puzzlesAfterRun1).toHaveLength(2);
    const dedupeKeysAfterRun1 = new Set(puzzlesAfterRun1.map((p) => p.dedupeKey));

    expect(fensSeen).toHaveLength(4); // 2 games x (before, after)
    expect(createEngineFn).toHaveBeenCalledTimes(1);

    // --- Phase 2: second run, 3rd game added to the SAME fetchImpl/db. Games
    // 1 & 2 must NOT be re-analyzed. ---
    gamesRef.games.push(
      rawGame({ url: "game-3", pgn: GAME3_PGN, end_time: 100, white: { username: "opp3", result: "win" } })
    );

    const run2 = await analyzeAndPersist("DPortuondo", db, { fetchImpl, createEngineFn });

    expect(run2.newGames).toBe(1);
    expect(run2.newPuzzles).toBe(1);
    expect(createEngineFn).toHaveBeenCalledTimes(2); // new engine only for the new pending game

    // Proof games 1 & 2 weren't re-analyzed: total analyse() calls only grew by
    // exactly 2 (game-3's before/after), not 6 (all three re-run).
    expect(fensSeen).toHaveLength(4 + 2);

    const urlsAfterRun2 = await getAnalyzedGameUrls(db, "dportuondo");
    expect(urlsAfterRun2).toEqual(new Set(["game-1", "game-2", "game-3"]));

    const puzzlesAfterRun2 = await getAllPuzzles(db, "dportuondo");
    const dedupeKeysAfterRun2 = new Set(puzzlesAfterRun2.map((p) => p.dedupeKey));
    expect(dedupeKeysAfterRun2.size).toBe(3);
    for (const key of dedupeKeysAfterRun1) {
      expect(dedupeKeysAfterRun2.has(key)).toBe(true); // union is a superset of run 1
    }

    // --- Phase 3: idempotent re-run, no new games. Engine must not be created
    // at all, and nothing new should be analyzed or inserted. ---
    const run3 = await analyzeAndPersist("DPortuondo", db, { fetchImpl, createEngineFn });

    expect(run3.newGames).toBe(0);
    expect(run3.newPuzzles).toBe(0);
    expect(createEngineFn).toHaveBeenCalledTimes(2); // NOT called a 3rd time
    expect(fensSeen).toHaveLength(4 + 2); // no new analyse() calls either

    const puzzlesAfterRun3 = await getAllPuzzles(db, "dportuondo");
    expect(new Set(puzzlesAfterRun3.map((p) => p.dedupeKey))).toEqual(dedupeKeysAfterRun2);

    db.close();
  });
});
