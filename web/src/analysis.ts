// Port of src/chess_trainer/analyze.py's MATE_SCORE and pov_cp (lines 20, 35-37).
// python-chess's PovScore.pov(color).score(mate_score=...) does two things in
// one call: convert Mate(n) -> a bounded int, then flip sign if `color` isn't
// the side the raw score was reported for. We split those into mateScore()
// (the bounded-int conversion) and povCp() (the perspective flip), since the
// TS engine wrapper reports {cp, mate} relative to the side to move rather
// than a PovScore object.
//
// chessops (v0.15.1) PGN-walk API used by analyzeGame below, confirmed against
// node_modules/chessops/src/pgn.ts (matches its own documented usage example):
// - parsePgn(pgn) -> Game<PgnNodeData>[]; game.headers: Map<string,string>;
//   game.moves: Node<PgnNodeData> (chessops/pgn).
// - startingPosition(headers) -> Result<Position, FenError | PositionError>
//   (chessops/pgn); Result has `.isErr`/`.value` (@badrap/result).
// - game.moves.mainline(): Iterable<PgnNodeData> — Node.mainlineNodes() walks
//   node.children[0] recursively until a childless node, i.e. exactly the
//   mainline; mainline() yields each node's `.data` (here `{ san }`) directly,
//   so no manual children[0] walk is needed.
// - parseSan(pos, san) -> Move | undefined (chessops/san).
// - makeUci(move) (chessops/util); makeFen(setup), INITIAL_FEN (chessops/fen).
import { parsePgn, startingPosition } from "chessops/pgn";
import { parseSan } from "chessops/san";
import { makeFen, INITIAL_FEN } from "chessops/fen";
import { makeUci } from "chessops/util";
import type { Color } from "chessops/types";
import type { MoveEval } from "./types";
import { gamePhase } from "./profile";

export interface AnalysisInfo {
  cp: number | null;
  mate: number | null;
  pv: string[];
}

export type AnalyseFn = (fen: string) => Promise<AnalysisInfo>;

export const MATE_SCORE = 10000;

// Single choke point: convert Mate(n) -> bounded int BEFORE any arithmetic.
export function mateScore(m: number): number {
  return m > 0 ? MATE_SCORE - m : -MATE_SCORE - m;
}

export function povCp(info: AnalysisInfo, sideToMove: Color, playerColor: Color): number {
  const raw = info.mate != null ? mateScore(info.mate) : (info.cp as number);
  return sideToMove === playerColor ? raw : -raw;
}

// Port of analyze.py:40-46's color_of.
function colorOf(headers: Map<string, string>, username: string): Color | null {
  const u = username.toLowerCase();
  if ((headers.get("White") ?? "").toLowerCase() === u) return "white";
  if ((headers.get("Black") ?? "").toLowerCase() === u) return "black";
  return null;
}

// Port of analyze.py:49-102's analyze_game. `engine.analyse(board, limit, game=id)` +
// the per-game transposition-table reset (see analyze.py's `game_id` comment) become
// the injected `analyse(fen)` here — a pure fen -> AnalysisInfo function; call-scoping
// (per-game state, engine lifecycle) is the caller's concern, not this orchestration's.
export async function analyzeGame(
  pgn: string,
  username: string,
  analyse: AnalyseFn,
  gameUrl = ""
): Promise<MoveEval[]> {
  const games = parsePgn(pgn);
  if (!games.length) return [];
  const game = games[0];

  const startResult = startingPosition(game.headers);
  if (startResult.isErr) return [];
  const pos = startResult.value;
  if (game.headers.get("Variant")) return [];
  if (makeFen(pos.toSetup()) !== INITIAL_FEN) return []; // non-standard start (Chess960 etc.)

  const playerColor = colorOf(game.headers, username);
  if (playerColor === null) return [];

  const evals: MoveEval[] = [];
  let ply = 0;
  for (const node of game.moves.mainline()) {
    const move = parseSan(pos, node.san);
    if (!move) break; // illegal move in the mainline; stop here

    if (pos.turn === playerColor) {
      const fenBefore = makeFen(pos.toSetup());
      const fullmoveNo = pos.fullmoves;
      const playedMoveUci = makeUci(move);

      const info = await analyse(fenBefore);
      const evalBefore = povCp(info, pos.turn, playerColor); // pos.turn === playerColor here (see the `if` above)
      const bestMoveUci = info.pv[0] ?? playedMoveUci;
      const bestLineUci = info.pv.length ? info.pv.join(" ") : bestMoveUci;

      pos.play(move);

      const evalAfter = pos.isEnd()
        ? pos.isCheckmate()
          ? MATE_SCORE
          : 0
        : povCp(await analyse(makeFen(pos.toSetup())), pos.turn, playerColor);

      evals.push({
        gameUrl,
        ply,
        fullmoveNo,
        playerColor,
        fenBefore,
        playedMoveUci,
        bestMoveUci,
        bestLineUci,
        evalBeforeCp: evalBefore,
        evalAfterPlayedCp: evalAfter,
        cpl: Math.max(0, evalBefore - evalAfter),
        phase: gamePhase(fenBefore),
      });
    } else {
      pos.play(move);
    }
    ply++;
  }
  return evals;
}
