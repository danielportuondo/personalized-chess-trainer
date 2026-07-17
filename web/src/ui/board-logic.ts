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
import { parseFen, makeFen } from "chessops/fen";
import { chessgroundDests } from "chessops/compat";
import { parseSquare, parseUci } from "chessops/util";
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

// Plays a single UCI move onto a position and returns the resulting FEN. Throws
// on an illegal/unparseable move — callers pass moves already known legal (engine
// PV tokens, or tokens validated by planSolutionLine).
export function applyUci(fen: string, uci: string): string {
  const pos = position(fen);
  const move = parseUci(uci);
  if (!move || !pos.isLegal(move)) throw new Error(`illegal move ${uci} in ${fen}`);
  pos.play(move);
  return makeFen(pos.toSetup());
}

// One user move in a multi-move puzzle: the position the user faces, the move they
// must play, and (for every move except the last) the opponent's scripted reply plus
// the position it produces. `reply` absent ⟺ this is the final move that solves the puzzle.
export interface UserMoveStep {
  fenBefore: string;
  expectedUci: string;
  reply?: { uci: string; fenAfter: string };
}

export interface SolutionPlan {
  moves: UserMoveStep[]; // 1..maxUserMoves, in play order
}

// Turns a stored `solutionLineUci` (engine PV: user, opponent, user, … alternating from
// the side to move) into the sequence the drill plays. Caps at `maxUserMoves` user moves;
// stops early on a short line or an illegal token (guards hand-authored data). The last
// move never carries a reply — the puzzle ends the instant the user completes it, so the
// opponent's response to it is irrelevant.
export function planSolutionLine(
  fen: string,
  solutionLineUci: string,
  maxUserMoves = 3,
): SolutionPlan {
  const pos = position(fen);
  const tokens = solutionLineUci.trim().split(/\s+/).filter(Boolean);
  const moves: UserMoveStep[] = [];

  for (let i = 0; i < tokens.length && moves.length < maxUserMoves; i += 2) {
    const userMove = parseUci(tokens[i]);
    if (!userMove || !pos.isLegal(userMove)) break;
    const fenBefore = makeFen(pos.toSetup());
    pos.play(userMove);
    const step: UserMoveStep = { fenBefore, expectedUci: tokens[i] };

    const replyUci = tokens[i + 1];
    if (replyUci !== undefined) {
      const replyMove = parseUci(replyUci);
      if (!replyMove || !pos.isLegal(replyMove)) {
        // Illegal opponent token: present this user move as the final one, stop here.
        moves.push(step);
        break;
      }
      pos.play(replyMove);
      step.reply = { uci: replyUci, fenAfter: makeFen(pos.toSetup()) };
    }
    moves.push(step);
  }

  // The user never sees the opponent respond to their final move.
  const last = moves[moves.length - 1];
  if (last) last.reply = undefined;

  return { moves };
}

// One position in the post-solve review walk: the FEN to show, the move that produced it
// (for the last-move highlight; null on the starting position), and a short caption.
export interface ReviewFrame {
  fen: string;
  lastMove: [string, string] | null;
  label: string;
}

// Flattens a planned line into the ply-by-ply positions the review steps through: the
// starting position, then after every user move and every scripted opponent reply, in
// play order. Captions are color-based (neutral) so they read correctly whether the puzzle
// was solved or missed — on a miss the line is the winning continuation, not "your" moves.
// For L user moves there are always 2L frames, and the position before user move m sits at
// frame index 2m.
export function buildReviewFrames(moves: UserMoveStep[]): ReviewFrame[] {
  if (moves.length === 0) return [];
  const label = (color: Color, uci: string) => `${color === "white" ? "White" : "Black"}: ${uci}`;
  const squares = (uci: string): [string, string] => [uci.slice(0, 2), uci.slice(2, 4)];

  const frames: ReviewFrame[] = [{ fen: moves[0].fenBefore, lastMove: null, label: "Start" }];
  for (const step of moves) {
    const mover = turnColorOf(step.fenBefore);
    frames.push({
      fen: applyUci(step.fenBefore, step.expectedUci),
      lastMove: squares(step.expectedUci),
      label: label(mover, step.expectedUci),
    });
    if (step.reply) {
      frames.push({
        fen: step.reply.fenAfter,
        lastMove: squares(step.reply.uci),
        label: label(mover === "white" ? "black" : "white", step.reply.uci),
      });
    }
  }
  return frames;
}
