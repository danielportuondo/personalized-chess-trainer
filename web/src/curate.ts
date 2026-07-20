// Serve-time puzzle curation: decides whether a stored puzzle is drillable and
// where its solution line ends. Pure chessops over data every persisted puzzle
// already has (fen + solutionLineUci), so it retro-applies without migration —
// deliberately a web-only layer on top of the Python-parity core (extract/
// profile/review are untouched ports).
//
// A puzzle is drillable iff its line reaches a concrete payoff the solver can
// verify on the board: checkmate, or a banked material gain. Everything else
// (positional "other" mistakes, quiet defensive saves, mates too deep to show)
// is excluded from drills but still counts in the weakness profile.
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { opposite, parseUci } from "chessops/util";
import { material } from "./profile";
import type { Puzzle } from "./types";

const MOVE_CAP = 3; // max user moves for a material payoff
const MATE_MOVE_CAP = 4; // mates justify one extra move
const MATERIAL_GAIN_MIN = 2; // pawns of banked gain, matches profile.ts's motif threshold

export interface CuratedLine {
  lineUci: string; // trimmed line, ending on the final user move
  userMoves: number;
  goal: "mate" | "material";
  forcingRatio: number; // fraction of user moves that give check or capture
}

// Walks the stored PV and cuts it at the earliest payoff: checkmate after a
// user move, or a material gain that is still >= MATERIAL_GAIN_MIN once the
// opponent's scripted reply has landed (so an imminent recapture can't fake a
// banked gain; at line/game end the gain counts as settled). Returns null when
// no payoff exists within the caps — the puzzle is not drillable.
export function curateLine(fen: string, solutionLineUci: string): CuratedLine | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const posResult = Chess.fromSetup(setup.value);
  if (posResult.isErr) return null;
  const pos = posResult.value;

  const player = pos.turn;
  const opponent = opposite(player);
  const diff = () => material(pos.board, player) - material(pos.board, opponent);
  const startDiff = diff();

  const tokens = solutionLineUci.trim().split(/\s+/).filter(Boolean);
  let forcing = 0;

  const cut = (userMoves: number, goal: "mate" | "material"): CuratedLine => ({
    lineUci: tokens.slice(0, 2 * userMoves - 1).join(" "),
    userMoves,
    goal,
    forcingRatio: forcing / userMoves,
  });

  for (let k = 0; 2 * k < tokens.length && k < MATE_MOVE_CAP; k++) {
    const userMove = parseUci(tokens[2 * k]);
    if (!userMove || !pos.isLegal(userMove)) return null;
    const oppMaterialBefore = material(pos.board, opponent);
    pos.play(userMove);
    const captured = material(pos.board, opponent) < oppMaterialBefore;
    if (captured || pos.isCheck()) forcing++;

    const userMoves = k + 1;
    if (pos.isCheckmate()) return cut(userMoves, "mate");

    const replyToken = tokens[2 * k + 1];
    const lineEnds = replyToken === undefined || pos.isEnd();
    if (!lineEnds) {
      const reply = parseUci(replyToken);
      if (!reply || !pos.isLegal(reply)) return null;
      pos.play(reply);
    }
    if (userMoves <= MOVE_CAP && diff() - startDiff >= MATERIAL_GAIN_MIN) {
      return cut(userMoves, "material");
    }
    if (lineEnds || pos.isEnd()) return null;
  }
  return null;
}

export function curatePuzzle(puzzle: Puzzle): CuratedLine | null {
  if (puzzle.ambiguous) return null;
  return curateLine(puzzle.fen, puzzle.solutionLineUci);
}

// Shared drill/profile predicate so both screens gate on the exact same rule.
export function isDrillable(puzzle: Puzzle): boolean {
  return curatePuzzle(puzzle) !== null;
}

// Ordering-only difficulty: longer lines are harder, forcing moves (checks/
// captures) and bigger blunders are easier to spot. Tunable weights; sessions
// sort ascending so drills warm up before the deep ones.
export function difficultyScore(curated: CuratedLine, puzzle: Puzzle): number {
  return curated.userMoves * 10 - curated.forcingRatio * 5 - Math.min(puzzle.cpl, 500) / 100;
}
