// One-click demo data. A small set of deliberately BASIC, unambiguous tactics so
// a first-time visitor solves a few immediately and hits the celebration payoff —
// no Chess.com account, no ~40s analysis wait. Seeded into IndexedDB under a
// reserved sentinel username and surfaced through the real profile/drill screens
// unchanged (they read everything by username).
//
// Each puzzle's FEN + first solution move is verified legal (and mates verified as
// checkmate) by tests/demo-fixture.test.ts — that test guards the showcase.
import type { IDBPDatabase } from "idb";
import type { Meta, Puzzle } from "../types";
import type { TrainerSchema } from "../db";
import { putMeta, putPuzzlesIfAbsent } from "../db";
import { todayIso } from "../dates";

// Real handles are lowercased and won't collide with this bracketed sentinel.
export const DEMO_USERNAME = "__demo__";
export const DEMO_DISPLAY_NAME = "Demo";

export const DEMO_PUZZLES: Puzzle[] = [
  {
    // Scholar's mate — Qh5xf7#, supported by the Italian bishop on c4.
    fen: "r1bqk1nr/pppp1ppp/2n5/2b1p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1",
    solutionLineUci: "h5f7",
    playedMoveUci: "b1c3",
    bestMoveUci: "h5f7",
    cpl: 1000,
    evalBeforeCp: 750,
    phase: "opening",
    motif: "missed forced mate",
    sourceGameUrl: "demo://game/1",
    sourcePly: 8,
    dedupeKey: "demo-01-scholars-mate",
  },
  {
    // Back-rank mate — the king is boxed in by its own pawns.
    fen: "6k1/5ppp/8/8/8/8/8/R6K w - - 0 1",
    solutionLineUci: "a1a8",
    playedMoveUci: "h1g1",
    bestMoveUci: "a1a8",
    cpl: 950,
    evalBeforeCp: 600,
    phase: "endgame",
    motif: "missed forced mate",
    sourceGameUrl: "demo://game/2",
    sourcePly: 60,
    dedupeKey: "demo-02-back-rank",
  },
  {
    // Supported queen mate — Qg7#, defended by the bishop on h6.
    fen: "7k/8/7B/8/8/8/6Q1/6K1 w - - 0 1",
    solutionLineUci: "g2g7",
    playedMoveUci: "g1f2",
    bestMoveUci: "g2g7",
    cpl: 980,
    evalBeforeCp: 800,
    phase: "endgame",
    motif: "missed forced mate",
    sourceGameUrl: "demo://game/3",
    sourcePly: 44,
    dedupeKey: "demo-03-queen-mate",
  },
  {
    // The queen was left hanging on d5 — take it for free with the knight.
    fen: "r3k2r/ppp2ppp/2n5/3q4/8/2N5/PPPP1PPP/R3K2R w KQkq - 0 1",
    solutionLineUci: "c3d5",
    playedMoveUci: "e1g1",
    bestMoveUci: "c3d5",
    cpl: 880,
    evalBeforeCp: 90,
    phase: "middlegame",
    motif: "hanging piece",
    sourceGameUrl: "demo://game/4",
    sourcePly: 24,
    dedupeKey: "demo-04-hanging-queen",
  },
  {
    // Knight royal fork — Nd6+ hits the king and the queen; win the queen next.
    fen: "2q1k3/pp3ppp/8/8/2N5/8/PP3PPP/4K3 w - - 0 1",
    solutionLineUci: "c4d6 e8e7 d6c8",
    playedMoveUci: "e1e2",
    bestMoveUci: "c4d6",
    cpl: 700,
    evalBeforeCp: 40,
    phase: "endgame",
    motif: "missed win of material",
    sourceGameUrl: "demo://game/5",
    sourcePly: 30,
    dedupeKey: "demo-05-knight-fork",
  },
  {
    // Black to move — the rook on b1 is undefended. Rxb1+ wins it with check.
    fen: "1r3k2/8/8/8/8/8/8/1R3K2 b - - 0 1",
    solutionLineUci: "b8b1",
    playedMoveUci: "f8e7",
    bestMoveUci: "b8b1",
    cpl: 500,
    evalBeforeCp: 60,
    phase: "endgame",
    motif: "hanging piece",
    sourceGameUrl: "demo://game/6",
    sourcePly: 70,
    dedupeKey: "demo-06-hanging-rook",
  },
  {
    // The knight wandered to b4 and hung — axb4 wins a clean piece.
    fen: "r1bqkb1r/pppp1ppp/5n2/4p3/1n2P3/P7/1PPP1PPP/RNBQKBNR w KQkq - 0 1",
    solutionLineUci: "a3b4",
    playedMoveUci: "g1f3",
    bestMoveUci: "a3b4",
    cpl: 320,
    evalBeforeCp: 40,
    phase: "middlegame",
    motif: "hanging piece",
    sourceGameUrl: "demo://game/7",
    sourcePly: 12,
    dedupeKey: "demo-07-hanging-knight",
  },
  {
    // Classic bishop trap — the a5 bishop has no escape; bxa5 wins it.
    fen: "rnbqk1nr/ppp2ppp/8/b2pp3/1P1P4/8/P1P1PPPP/RNBQKBNR w KQkq - 0 1",
    solutionLineUci: "b4a5",
    playedMoveUci: "g1f3",
    bestMoveUci: "b4a5",
    cpl: 300,
    evalBeforeCp: 30,
    phase: "opening",
    motif: "hanging piece",
    sourceGameUrl: "demo://game/8",
    sourcePly: 10,
    dedupeKey: "demo-08-bishop-trap",
  },
];

// Baked so the demo profile looks lived-in (an active week, real progress).
export const DEMO_META: Omit<Meta, "lastActiveDate"> = {
  username: DEMO_USERNAME,
  xp: 42,
  currentStreak: 5,
  bestStreak: 12,
  bestRun: 8,
};

// Idempotent: puzzles are insert-if-absent (first-wins), and meta is only baked
// on first seed so re-entering the demo never clobbers accumulated progress.
export async function seedDemo(db: IDBPDatabase<TrainerSchema>): Promise<void> {
  await putPuzzlesIfAbsent(db, DEMO_USERNAME, DEMO_PUZZLES);
  const existing = await db.get("meta", DEMO_USERNAME);
  if (!existing) {
    await putMeta(db, { ...DEMO_META, lastActiveDate: todayIso() });
  }
}
