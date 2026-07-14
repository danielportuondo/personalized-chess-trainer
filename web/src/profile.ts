// chessops (v0.15.1) APIs used here — confirmed against node_modules/chessops/dist/types/*.d.ts:
// - parseFen (chessops/fen) -> Result<Setup, FenError>; Chess.fromSetup (chessops/chess) -> Result<Chess, PositionError>
// - Board (chessops/board): board.get(sq), board.pieces(color, role), board.occupied,
//   board.rooksAndQueens(), board.bishopsAndQueens(), board[color]/board[role] SquareSet accessors
// - opposite, parseUci (chessops/util)
// - pawnAttacks, knightAttacks, bishopAttacks, rookAttacks, kingAttacks (chessops/attacks)
// - Position.isLegal(move) / .play(move) (mutates) / .isEnd() (chessops/chess)
// chessops has no direct "attacksTo"/"attackers" export, so attackersTo() below re-implements
// python-chess's board.attackers(color, square): union each piece-type's attack pattern computed
// FROM `square`, intersected with the matching piece-type set, then intersected with `color`.
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { opposite, parseUci } from "chessops/util";
import { bishopAttacks, kingAttacks, knightAttacks, pawnAttacks, rookAttacks } from "chessops/attacks";
import type { Board } from "chessops/board";
import type { SquareSet } from "chessops/squareSet";
import type { Color, Role, Square } from "chessops/types";
import type { GroupRow, Motif, Phase, Puzzle, WeaknessSummary } from "./types";
import { pyRound } from "./review";

const OPENING_MAX_MOVE = 10;
const ENDGAME_NPM_MAX = 20;
const PV_PLY_CAP = 16;
const MATE_CP_THRESHOLD = 9000;
const MATERIAL_GAIN_MIN = 2;

export const REASON: Record<Motif, string> = {
  "missed forced mate": "you missed a forced mate",
  "allowed forced mate": "you walked into a forced mate",
  "hanging piece": "you left a piece hanging",
  "missed win of material": "you missed winning material",
  other: "a stronger move was available",
};

const NONPAWN: Partial<Record<Role, number>> = { knight: 3, bishop: 3, rook: 5, queen: 9 };
const MATERIAL: Partial<Record<Role, number>> = { pawn: 1, ...NONPAWN };
const PIECE_VALUES: Record<Role, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 100, // attacker valuation only; a king never wins a defended piece
};

function attackersTo(board: Board, color: Color, square: Square): SquareSet {
  const occupied = board.occupied;
  const rookLike = rookAttacks(square, occupied).intersect(board.rooksAndQueens());
  const bishopLike = bishopAttacks(square, occupied).intersect(board.bishopsAndQueens());
  const knightLike = knightAttacks(square).intersect(board.knight);
  const kingLike = kingAttacks(square).intersect(board.king);
  const pawnLike = pawnAttacks(opposite(color), square).intersect(board.pawn);
  return rookLike.union(bishopLike).union(knightLike).union(kingLike).union(pawnLike).intersect(board[color]);
}

function isAttackedBy(board: Board, color: Color, square: Square): boolean {
  return attackersTo(board, color, square).nonEmpty();
}

export function gamePhase(fen: string): Phase {
  const setup = parseFen(fen).unwrap();
  if (setup.fullmoves <= OPENING_MAX_MOVE) return "opening";
  const board = setup.board;
  let npm = 0;
  for (const role of Object.keys(NONPAWN) as Role[]) {
    npm += NONPAWN[role]! * (board.pieces("white", role).size() + board.pieces("black", role).size());
  }
  return npm <= ENDGAME_NPM_MAX ? "endgame" : "middlegame";
}

export function material(board: Board, color: Color): number {
  let total = 0;
  for (const role of Object.keys(MATERIAL) as Role[]) {
    total += MATERIAL[role]! * board.pieces(color, role).size();
  }
  return total;
}

export function isHanging(board: Board, square: Square, color: Color): boolean {
  const piece = board.get(square);
  if (!piece || piece.color !== color) return false;
  const opponent = opposite(color);
  if (!isAttackedBy(board, opponent, square)) return false;
  if (!isAttackedBy(board, color, square)) return true;
  let cheapest = Infinity;
  for (const attacker of attackersTo(board, opponent, square)) {
    cheapest = Math.min(cheapest, PIECE_VALUES[board.get(attacker)!.role]);
  }
  return cheapest < PIECE_VALUES[piece.role];
}

export function pvMaterialGain(fen: string, lineUci: string, player: Color): number {
  const setup = parseFen(fen).unwrap();
  const pos = Chess.fromSetup(setup).unwrap();
  const opponent = opposite(player);
  const before = material(pos.board, player) - material(pos.board, opponent);
  for (const uci of lineUci.split(" ").filter(Boolean).slice(0, PV_PLY_CAP)) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) break;
    pos.play(move);
    if (pos.isEnd()) break;
  }
  const after = material(pos.board, player) - material(pos.board, opponent);
  return after - before;
}

export function classifyMotif(
  fen: string,
  playedUci: string,
  bestUci: string,
  evalBeforeCp: number,
  evalAfterPlayedCp?: number,
  bestLineUci?: string,
): Motif {
  if (evalBeforeCp >= MATE_CP_THRESHOLD) return "missed forced mate";
  if (evalAfterPlayedCp != null && evalAfterPlayedCp <= -MATE_CP_THRESHOLD) return "allowed forced mate";

  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const player = pos.turn;

  const move = parseUci(playedUci);
  if (move && pos.isLegal(move)) {
    const after = pos.clone();
    after.play(move);
    for (const sq of after.board[player]) {
      const role = after.board.get(sq)!.role;
      if (role !== "pawn" && role !== "king" && isHanging(after.board, sq, player)) {
        return "hanging piece";
      }
    }
  }

  const line = bestLineUci || bestUci;
  if (line && bestUci && bestUci !== playedUci && pvMaterialGain(fen, line, player) >= MATERIAL_GAIN_MIN) {
    return "missed win of material";
  }

  return "other";
}

// SQLite's ROUND() rounds half AWAY from zero (ROUND(2.5)=3, ROUND(12.5,0)=13,
// ROUND(6.25,1)=6.3) — NOT Python's builtin banker's round(). The GroupRow pct
// (1 dp) and avgCpl (0 dp) come from SQL ROUND() in _grouped/_by_move_bucket, so
// they must use this, not pyRound. All inputs here are non-negative, so JS's
// half-up Math.round equals half-away-from-zero. (The TOP-LEVEL summary avgCpl at
// profile.py:209 uses Python builtin round() and stays on pyRound below.)
function roundHalfAway(x: number, ndigits = 0): number {
  const f = 10 ** ndigits;
  return Math.round(x * f) / f;
}

// Port of profile.py:173-181's _grouped(): COALESCE(column, 'unknown'), grouped,
// ordered by n DESC (ties keep first-seen key order via a stable sort).
function groupBy(puzzles: Puzzle[], keyFn: (p: Puzzle) => string): GroupRow[] {
  const total = puzzles.length;
  const order: string[] = [];
  const counts = new Map<string, number>();
  const cplSums = new Map<string, number>();
  for (const p of puzzles) {
    const key = keyFn(p);
    if (!counts.has(key)) {
      counts.set(key, 0);
      cplSums.set(key, 0);
      order.push(key);
    }
    counts.set(key, counts.get(key)! + 1);
    cplSums.set(key, cplSums.get(key)! + p.cpl);
  }
  const rows: GroupRow[] = order.map((key) => {
    const n = counts.get(key)!;
    return {
      key,
      n,
      pct: roundHalfAway((100 * n) / total, 1),
      avgCpl: roundHalfAway(cplSums.get(key)! / n, 0),
    };
  });
  rows.sort((a, b) => b.n - a.n);
  return rows;
}

const MOVE_BUCKETS = ["1-10", "11-20", "21-30", "31+"] as const;

// Port of profile.py:184-199's _by_move_bucket(): CASE bucketing on
// source_ply/2+1, grouped, ordered by MIN(source_ply) — equivalently the
// fixed bucket order, since ply always increases with bucket.
function moveBucket(sourcePly: number): string {
  const moveNo = Math.floor(sourcePly / 2) + 1;
  if (moveNo <= 10) return "1-10";
  if (moveNo <= 20) return "11-20";
  if (moveNo <= 30) return "21-30";
  return "31+";
}

// Port of profile.py:202-218's weakness_summary().
export function weaknessSummary(puzzles: Puzzle[]): WeaknessSummary {
  const total = puzzles.length;
  if (!total) {
    return { totalMistakes: 0, avgCpl: 0, byPhase: [], byMotif: [], byMoveBucket: [] };
  }

  const avgCpl = pyRound(
    puzzles.reduce((sum, p) => sum + p.cpl, 0) / total,
    1
  );
  const byPhase = groupBy(puzzles, (p) => p.phase ?? "unknown");
  const byMotif = groupBy(puzzles, (p) => p.motif ?? "unknown");
  const byMoveBucket = groupBy(puzzles, (p) => moveBucket(p.sourcePly)).sort(
    (a, b) => MOVE_BUCKETS.indexOf(a.key as (typeof MOVE_BUCKETS)[number]) -
      MOVE_BUCKETS.indexOf(b.key as (typeof MOVE_BUCKETS)[number])
  );

  return { totalMistakes: total, avgCpl, byPhase, byMotif, byMoveBucket };
}
