// Pure chess-position helpers for the board wrapper (ui/board.ts). No chessground or DOM
// import here so this stays unit-testable in the node/vitest environment; ui/board.ts is the
// only place that touches the DOM/CSS.
//
// chessops (v0.15.1) APIs confirmed against node_modules/chessops/dist/types/*.d.ts:
// - parseFen(fen) -> Result<Setup, FenError> (chessops/fen); Chess.fromSetup(setup) ->
//   Result<Chess, PositionError> (chessops/chess). Both Results are @badrap/result, so
//   `.unwrap()` throws on error — acceptable here since callers only ever pass FENs already
//   validated upstream (puzzle FENs stored in IDB).
// - pos.turn: Color = "white" | "black" (chessops/types).
// - chessgroundDests(pos, opts?) -> Map<SquareName, SquareName[]> (chessops/compat):
//   the legal-move-destinations map in exactly the shape chessground's `Dests` expects
//   (SquareName is structurally chessground's Key, both "a1".."h8" string literals).
// - parseSquare(str: SquareName) -> Square (chessops/util); pos.board.get(square) ->
//   { role, color } | undefined (chessops/board).
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { chessgroundDests } from "chessops/compat";
import { parseSquare } from "chessops/util";
import type { Color, SquareName } from "chessops/types";

function position(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
}

export function turnColorOf(fen: string): Color {
  return position(fen).turn;
}

export function legalDests(fen: string): Map<SquareName, SquareName[]> {
  return chessgroundDests(position(fen));
}

// Builds the UCI move string for a drag-drop (orig, dest) pair. Auto-queen only: if the
// moved piece is a pawn landing on the back rank (rank "8" or "1"), the promotion suffix
// is always "q" — underpromotion is not supported, so underpromotion puzzles simply score
// as a miss (the played UCI won't match the puzzle's expected best move).
export function moveToUci(fen: string, orig: string, dest: string): string {
  const pos = position(fen);
  const movedPiece = pos.board.get(parseSquare(orig as SquareName));
  const backRank = dest[1] === "8" || dest[1] === "1";
  const promotes = movedPiece?.role === "pawn" && backRank;
  return `${orig}${dest}${promotes ? "q" : ""}`;
}
