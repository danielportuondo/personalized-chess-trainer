// Port of src/chess_trainer/analyze.py's MATE_SCORE and pov_cp (lines 20, 35-37).
// python-chess's PovScore.pov(color).score(mate_score=...) does two things in
// one call: convert Mate(n) -> a bounded int, then flip sign if `color` isn't
// the side the raw score was reported for. We split those into mateScore()
// (the bounded-int conversion) and povCp() (the perspective flip), since the
// TS engine wrapper reports {cp, mate} relative to the side to move rather
// than a PovScore object.
import type { Color } from "chessops/types";

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
