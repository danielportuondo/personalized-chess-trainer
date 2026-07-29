export interface MoveEval {
  gameUrl: string;
  ply: number;
  fullmoveNo: number;
  playerColor: "white" | "black";
  fenBefore: string;
  playedMoveUci: string;
  bestMoveUci: string;
  bestLineUci: string;
  evalBeforeCp: number;
  evalAfterPlayedCp: number;
  cpl: number;
  phase?: Phase;
}

export type Phase = "opening" | "middlegame" | "endgame";

export type Motif =
  | "missed forced mate"
  | "allowed forced mate"
  | "hanging piece"
  | "missed win of material"
  | "other";

// Where a puzzle came from, told from the player's side of the board.
export interface Provenance {
  opponent: string;
  playerColor: "white" | "black";
  endTime: number | null; // unix seconds (chess.com end_time)
  timeClass: string | null; // "rapid" | "blitz" | "daily" | ...
  result: "win" | "loss" | "draw" | null; // the player's result, not the board score
}

// The opponent's move that led into a puzzle, so the drill can play it before
// arming input.
export interface PuzzleIntro {
  uci: string; // the opponent's move (normalized castling UCI)
  fenBefore: string; // position before that move; playing uci from here yields pz.fen
}

export interface Puzzle {
  fen: string;
  solutionLineUci: string;
  playedMoveUci: string;
  bestMoveUci: string;
  cpl: number;
  evalBeforeCp: number;
  phase?: Phase;
  motif?: Motif;
  // MultiPV=2 verdict from analysis time: true = a second move nearly as good
  // exists, so the puzzle has no unique solution. undefined = never checked
  // (analyzed before the gate existed, or a line curation doesn't serve).
  ambiguous?: boolean;
  // undefined = minted before provenance existed (healed when the source game
  // re-enters the fetch window) or the game is outside that window / a demo
  // fixture (stays absent; UI falls back to the bare game link).
  provenance?: Provenance;
  // undefined = minted before intros existed (healed when the source game
  // re-enters the fetch window), sourcePly 0 (no preceding move), or the game
  // is outside that window / a demo fixture (stays absent; the drill skips
  // the intro).
  intro?: PuzzleIntro;
  sourceGameUrl: string;
  sourcePly: number;
  dedupeKey: string;
}

export interface ReviewState {
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
  dueDate: string;
  lastResult?: 0 | 1;
  lastReviewed?: string;
}

export interface Meta {
  username: string;
  xp: number; // lifetime puzzles solved (passed)
  currentStreak: number; // consecutive active days
  bestStreak: number;
  bestRun: number; // longest consecutive correct-solve run within a session, ever
  lastActiveDate: string; // ISO YYYY-MM-DD; "" when never active
}

export interface GroupRow {
  key: string;
  n: number;
  pct: number;
  avgCpl: number;
}

export interface WeaknessSummary {
  totalMistakes: number;
  avgCpl: number;
  byPhase: GroupRow[];
  byMotif: GroupRow[];
  byMoveBucket: GroupRow[];
}

export interface RawGame {
  url: string;
  archiveUrl: string;
  pgn: string;
  timeClass: string | null;
  timeControl: string | null;
  rules: string | null;
  endTime: number | null;
  whiteUsername: string | null;
  blackUsername: string | null;
  whiteResult: string | null;
  blackResult: string | null;
  result: string | null;
}
