import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { analyzeAndPersist } from "../src/pipeline";
import {
  openTrainerDb,
  DB_NAME,
  getAnalyzedGameUrls,
  getAllPuzzles,
  putPuzzlesIfAbsent,
  getReviewByKey,
  recordResult,
} from "../src/db";
import { BASE_URL } from "../src/chesscom";
import type { AnalysisInfo, AnalyseFn } from "../src/analysis";
import type { createEngine, Engine, Top2 } from "../src/engine";
import type { Puzzle } from "../src/types";

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
function makeEngineFn(infos: AnalysisInfo[], top2s: Top2[] = []) {
  let idx = 0;
  let top2Idx = 0;
  const fensSeen: string[] = [];
  const top2FensSeen: string[] = [];
  const createEngineFn = vi.fn(async () => {
    const analyse: AnalyseFn = vi.fn(async (fen: string) => {
      fensSeen.push(fen);
      return infos[idx++];
    });
    const analyseTop2 = vi.fn(async (fen: string) => {
      top2FensSeen.push(fen);
      // Default = clearly unique, so tests that don't care about ambiguity pass unchanged.
      return top2s[top2Idx++] ?? { best: { cp: 0, mate: null, pv: [] }, second: undefined };
    });
    const newGame = vi.fn(async () => {});
    const quit = vi.fn();
    const engine: Engine = { analyse, analyseTop2, newGame, quit };
    return engine;
  }) as unknown as typeof createEngine;
  return { createEngineFn, fensSeen, top2FensSeen };
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

  // Curate-passing fixtures for the ambiguity gate: the MultiPV check only runs
  // on puzzles curation would serve, so these games' best lines must reach a
  // concrete payoff. dportuondo (Black) misses a hanging bishop (2...gxh6) and
  // a mate-in-1 (2...Qh4#), blundering with ...a6 instead.
  const GAME_MATERIAL_PGN = '[White "opp1"]\n[Black "dportuondo"]\n\n1. d4 d5 2. Bh6 a6 *';
  const GAME_MATE_PGN = '[White "opp3"]\n[Black "dportuondo"]\n\n1. f3 e5 2. g4 a6 *';

  // 2 player moves x (before, after) per game.
  const MATERIAL_INFOS: AnalysisInfo[] = [
    { cp: 0, mate: null, pv: ["d7d5"] },
    { cp: 0, mate: null, pv: [] },
    { cp: 300, mate: null, pv: ["g7h6"] }, // gxh6 banks the bishop -> drillable
    { cp: 0, mate: null, pv: [] },
  ];
  const QUIET_INFOS: AnalysisInfo[] = [
    { cp: 10, mate: null, pv: ["e7e5"] },
    { cp: 800, mate: null, pv: [] }, // cpl 810 -> puzzle, but the quiet line isn't drillable
  ];
  const MATE_INFOS: AnalysisInfo[] = [
    { cp: 0, mate: null, pv: ["e7e5"] },
    { cp: 0, mate: null, pv: [] },
    { cp: null, mate: 1, pv: ["d8h4"] }, // Qh4# missed -> drillable mate
    { cp: 0, mate: null, pv: [] },
  ];

  it("uniqueness-checks only curate-passing puzzles (50cp gap, dual mates exempt) and heals stored verdicts", async () => {
    const db = await openTrainerDb();

    const gamesRef = {
      games: [
        rawGame({ url: "game-material", pgn: GAME_MATERIAL_PGN, end_time: 300, white: { username: "opp1", result: "win" } }),
        rawGame({ url: "game-quiet", pgn: GAME1_PGN, end_time: 200, white: { username: "opp2", result: "win" } }),
      ],
    };
    const fetchImpl = fakeFetch(gamesRef);

    const infos: AnalysisInfo[] = [...MATERIAL_INFOS, ...QUIET_INFOS, ...MATE_INFOS];
    const top2s: Top2[] = [
      // run 1, game-material's puzzle: runner-up 30cp behind -> ambiguous at 50
      { best: { cp: 850, mate: null, pv: ["g7h6"] }, second: { cp: 820, mate: null, pv: ["g8f6"] } },
      // run 2, game-mate's puzzle: both top moves mate -> either wins, NOT ambiguous
      { best: { cp: null, mate: 1, pv: ["d8h4"] }, second: { cp: null, mate: 3, pv: ["g8f6"] } },
      // run 2, healing re-check of game-material: gap exactly 50 -> unique now
      { best: { cp: 850, mate: null, pv: ["g7h6"] }, second: { cp: 800, mate: null, pv: ["g8f6"] } },
    ];
    const { createEngineFn, top2FensSeen } = makeEngineFn(infos, top2s);
    const byGame = (puzzles: Puzzle[], url: string) => puzzles.find((p) => p.sourceGameUrl === url)!;

    await analyzeAndPersist("dportuondo", db, { fetchImpl, createEngineFn });

    const afterRun1 = await getAllPuzzles(db, "dportuondo");
    expect(afterRun1).toHaveLength(2);
    // The quiet puzzle is skipped outright: curation would never serve it.
    expect(top2FensSeen).toEqual([byGame(afterRun1, "game-material").fen]);
    expect(byGame(afterRun1, "game-material").ambiguous).toBe(true);
    expect(byGame(afterRun1, "game-quiet").ambiguous).toBeUndefined();

    gamesRef.games.push(
      rawGame({ url: "game-mate", pgn: GAME_MATE_PGN, end_time: 100, white: { username: "opp3", result: "win" } })
    );
    await analyzeAndPersist("dportuondo", db, { fetchImpl, createEngineFn });

    const afterRun2 = await getAllPuzzles(db, "dportuondo");
    // New puzzle checked first, then the stored flagged one re-checked (healed).
    expect(top2FensSeen).toHaveLength(3);
    expect(top2FensSeen[1]).toBe(byGame(afterRun2, "game-mate").fen);
    expect(top2FensSeen[2]).toBe(byGame(afterRun2, "game-material").fen);
    expect(byGame(afterRun2, "game-mate").ambiguous).toBe(false);
    expect(byGame(afterRun2, "game-material").ambiguous).toBe(false);
    expect(byGame(afterRun2, "game-quiet").ambiguous).toBeUndefined();

    // Idempotent run: no pending games -> no engine -> no checks, no healing.
    await analyzeAndPersist("dportuondo", db, { fetchImpl, createEngineFn });
    expect(top2FensSeen).toHaveLength(3);

    db.close();
  });

  it("heals legacy flagged verdicts only for puzzles curation serves, preserving review state", async () => {
    const db = await openTrainerDb();

    // Legacy rows: the old gate flagged puzzles regardless of drillability.
    const MATE_IN_1_FEN = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    const RECAPTURE_FEN = "6k1/8/4p3/3n4/8/8/8/3R2K1 w - - 0 1";
    const legacy = (fen: string, line: string): Puzzle => ({
      fen,
      solutionLineUci: line,
      playedMoveUci: "a2a3",
      bestMoveUci: line.split(" ")[0],
      cpl: 500,
      evalBeforeCp: 100,
      ambiguous: true,
      sourceGameUrl: "old-game",
      sourcePly: 1,
      dedupeKey: fen.split(" ").slice(0, 4).join(" "),
    });
    await putPuzzlesIfAbsent(db, "dportuondo", [
      legacy(MATE_IN_1_FEN, "h5f7"), // drillable -> re-checked
      legacy(RECAPTURE_FEN, "d1d5 e6d5 g1f1 g8f7"), // recapture voids the gain -> not drillable, left alone
    ]);
    const mateKey = MATE_IN_1_FEN.split(" ").slice(0, 4).join(" ");
    await recordResult(db, "dportuondo", mateKey, true, "2026-01-01");

    const gamesRef = {
      games: [rawGame({ url: "game-1", pgn: GAME1_PGN, end_time: 300, white: { username: "opp1", result: "win" } })],
    };
    // cpl 10: the pending game yields no puzzle; it exists to spin the engine up.
    const infos: AnalysisInfo[] = [
      { cp: 10, mate: null, pv: ["e7e5"] },
      { cp: 0, mate: null, pv: [] },
    ];
    const top2s: Top2[] = [
      { best: { cp: 900, mate: null, pv: ["h5f7"] }, second: { cp: 100, mate: null, pv: ["c4f7"] } },
    ];
    const { createEngineFn, top2FensSeen } = makeEngineFn(infos, top2s);

    await analyzeAndPersist("dportuondo", db, { fetchImpl: fakeFetch(gamesRef), createEngineFn });

    expect(top2FensSeen).toEqual([MATE_IN_1_FEN]);
    const puzzles = await getAllPuzzles(db, "dportuondo");
    const byFen = (fen: string) => puzzles.find((p) => p.fen === fen)!;
    expect(byFen(MATE_IN_1_FEN).ambiguous).toBe(false);
    expect(byFen(RECAPTURE_FEN).ambiguous).toBe(true);
    const byKey = await getReviewByKey(db, "dportuondo");
    expect(byKey[mateKey].reps).toBe(1);

    db.close();
  });
});
