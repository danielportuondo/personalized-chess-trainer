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
import type { Phase } from "./types";

const OPENING_MAX_MOVE = 10;
const ENDGAME_NPM_MAX = 20;
const PV_PLY_CAP = 16;

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
