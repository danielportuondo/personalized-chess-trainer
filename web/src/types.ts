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

export interface Puzzle {
  fen: string;
  solutionLineUci: string;
  playedMoveUci: string;
  bestMoveUci: string;
  cpl: number;
  evalBeforeCp: number;
  phase?: Phase;
  motif?: Motif;
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
