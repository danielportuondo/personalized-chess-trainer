// Derives the opponent's move leading into a puzzle (for the drill's intro
// animation) from the source game's PGN and the puzzle's sourcePly. Pure
// chessops over data every re-fetched game already has, so it retro-applies
// without migration — deliberately a web-only layer on top of the
// Python-parity core (analysis/extract are untouched ports; only playedUci's
// castling normalization is reused).
import { parsePgn, startingPosition } from "chessops/pgn";
import { parseSan } from "chessops/san";
import { makeFen, INITIAL_FEN } from "chessops/fen";
import { playedUci } from "./analysis";
import type { PuzzleIntro } from "./types";

// Absent-not-partial (mirrors provenanceFrom): any underivable case — no
// preceding move, variant/custom start, corrupt or too-short mainline —
// returns undefined, never a partial object.
export function introFrom(pgn: string, sourcePly: number): PuzzleIntro | undefined {
  if (sourcePly <= 0) return undefined;
  const games = parsePgn(pgn);
  if (!games.length) return undefined;
  const game = games[0];

  // Same rejections as analyzeGame: unparseable start, variant, custom start.
  const startResult = startingPosition(game.headers);
  if (startResult.isErr) return undefined;
  const pos = startResult.value;
  if (game.headers.get("Variant")) return undefined;
  if (makeFen(pos.toSetup()) !== INITIAL_FEN) return undefined;

  let ply = 0;
  for (const node of game.moves.mainline()) {
    const move = parseSan(pos, node.san);
    if (!move) return undefined;
    if (ply === sourcePly - 1) {
      const fenBefore = makeFen(pos.toSetup());
      // pos.turn is the MOVER's color here — what playedUci needs to
      // normalize castling to king-two-square UCI.
      return { uci: playedUci(pos.board, move, pos.turn), fenBefore };
    }
    pos.play(move);
    ply++;
  }
  return undefined;
}
