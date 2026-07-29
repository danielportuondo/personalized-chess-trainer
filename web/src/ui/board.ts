// DOM/chessground mount wrapper around board-logic.ts's pure helpers. Not unit-tested here
// (jsdom/node has no real board layout); exercised live in Task 8. Must tsc --noEmit cleanly.
//
// chessground (v9.2.1) APIs confirmed against node_modules/chessground/package.json `exports`
// (".": "./dist/chessground.js", "./*": "./dist/*.js", "./assets/*": "./assets/*") and
// node_modules/chessground/dist/{api,config,draw}.d.ts:
// - Chessground(element, config?) -> Api (chessground's default/main export).
// - Api.setShapes(shapes: DrawShape[]): void — confirmed present (alongside setAutoShapes,
//   which is for engine-driven auto-hints; setShapes is the one-shot "draw this" call we want).
// - Config/Api types live at "chessground/config" and "chessground/api" per the `"./*"` subpath
//   export entry. DrawShape lives at "chessground/draw".
// - Board/piece CSS ships as self-contained base64 data-URI SVGs; importing these three
//   (base layout + brown board + cburnett pieces) is sufficient, no extra asset fetches.
import { Chessground } from "chessground";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { legalDests, turnColorOf } from "./board-logic";
import type { ReviewFrame } from "./board-logic";

export interface PuzzleBoardOpts {
  fen: string;
  onMove: (orig: string, dest: string) => void;
}

// Mounts an interactive board oriented to the side to move, restricting drags to that
// side's legal moves (computed via chessops through board-logic's legalDests/turnColorOf).
export function mountPuzzleBoard(el: HTMLElement, opts: PuzzleBoardOpts): Api {
  const color = turnColorOf(opts.fen);
  const config: Config = {
    fen: opts.fen,
    orientation: color,
    turnColor: color,
    coordinates: true,
    movable: {
      free: false,
      color,
      dests: legalDests(opts.fen),
      showDests: true,
      events: { after: opts.onMove },
    },
    draggable: { enabled: true },
    drawable: { enabled: false },
    animation: { enabled: true, duration: 200 },
  };
  return Chessground(el, config);
}

export interface StaticShape {
  orig: string;
  dest?: string; // omit for a square highlight (circle); include for an arrow
  brush: "green" | "red" | "blue" | "yellow";
}

// Mounts a non-interactive display board (hero / illustration) with annotation
// shapes drawn on top — used for the landing's "find the better move" thesis.
export function mountStaticBoard(
  el: HTMLElement,
  opts: { fen: string; orientation?: "white" | "black"; shapes?: StaticShape[] },
): Api {
  const api = Chessground(el, {
    fen: opts.fen,
    orientation: opts.orientation ?? "white",
    viewOnly: true,
    coordinates: false,
    drawable: { enabled: false, visible: true },
    animation: { enabled: false },
  });
  const shapes: DrawShape[] = (opts.shapes ?? []).map((s) => ({
    orig: s.orig as Key,
    ...(s.dest ? { dest: s.dest as Key } : {}),
    brush: s.brush,
  }));
  if (shapes.length) api.setAutoShapes(shapes);
  return api;
}

// Disables further input once the puzzle has been answered: no movable side, no legal
// destinations, dragging off.
export function lockBoard(api: Api): void {
  api.set({ movable: { color: undefined, dests: new Map() }, draggable: { enabled: false } });
}

// Animates the opponent's scripted reply in a multi-move puzzle. Sets the resulting FEN
// (rather than a piece hop) so castling/en passant/promotion render correctly, and
// highlights the moved squares. The board stays locked — the caller re-arms input via
// armForMove once the animation settles.
export function playOpponentReply(api: Api, fenAfter: string, moveUci: string): void {
  const orig = moveUci.slice(0, 2) as Key;
  const dest = moveUci.slice(2, 4) as Key;
  // Duration pinned because chessground config merges persist: a preceding
  // snapTo leaves duration 0 in the state, which would swallow this animation.
  api.set({ fen: fenAfter, lastMove: [orig, dest], animation: { duration: 200 } });
}

// Instantly snaps the board to `fen` — no animation, no last-move highlight.
// Used to rewind for the intro replay; playOpponentReply restores the duration.
export function snapTo(api: Api, fen: string): void {
  api.set({ fen, lastMove: undefined, animation: { duration: 0 } });
}

// Renders one post-solve review frame on the (already-locked) board: sets the position and
// highlights the move that produced it, clearing any annotation shapes (e.g. a miss's
// best-move arrow). lastMove null on the starting frame leaves no highlight.
export function showFrame(api: Api, fen: string, lastMove: [string, string] | null): void {
  api.setShapes([]);
  api.set({
    fen,
    lastMove: lastMove ? [lastMove[0] as Key, lastMove[1] as Key] : undefined,
  });
}

// Corner badge on the destination square of a wrong move (chess.com idiom): the piece
// stays visible under it. customSvg html is injected inside chessground's square-local
// <svg viewBox="0 0 100 100">, so coordinates below are percent-of-square.
const WRONG_BADGE =
  `<circle cx="75" cy="25" r="18" fill="#d33" stroke="#fff" stroke-width="2"/>` +
  `<path d="M68 18l14 14M82 18l-14 14" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`;

export function markWrongMove(api: Api, dest: string): void {
  api.setShapes([{ orig: dest as Key, customSvg: { html: WRONG_BADGE } }]);
}

// Circles a single square in the hint's gold — chess convention for "this piece
// moves", deliberately never the destination.
export function hintSquare(api: Api, square: string): void {
  api.setShapes([{ orig: square as Key, brush: "yellow" }]);
}

// setShapes always REPLACES the shape set (a miss badge correctly evicts a hint
// circle); this is the explicit "nothing drawn" case.
export function clearShapes(api: Api): void {
  api.setShapes([]);
}

// Plays review frames onto the (locked) board one per stepMs, starting by showing
// frames[fromIdx] immediately. The chain dies silently when alive() goes false
// (navigation/re-mount), so callers need no cancellation token. onFrame fires for
// each ADVANCED-to frame — not the immediate frames[fromIdx] display, which is a
// rewind re-show of a position already seen (the caller uses it for move sounds).
export function autoplayFrames(
  api: Api,
  frames: ReviewFrame[],
  fromIdx: number,
  alive: () => boolean,
  onDone: () => void,
  onFrame?: (idx: number) => void,
  stepMs = 700,
): void {
  showFrame(api, frames[fromIdx].fen, frames[fromIdx].lastMove);
  function step(idx: number): void {
    if (idx >= frames.length) {
      onDone();
      return;
    }
    setTimeout(() => {
      if (!alive()) return;
      showFrame(api, frames[idx].fen, frames[idx].lastMove);
      onFrame?.(idx);
      step(idx + 1);
    }, stepMs);
  }
  step(fromIdx + 1);
}

// Re-enables input for the side to move at `fen`, restricting drags to its legal moves.
// The events.after handler wired at mount survives chessground's config merge, so the same
// onMove callback keeps firing for every move in the line.
export function armForMove(api: Api, fen: string): void {
  const color = turnColorOf(fen);
  api.set({
    turnColor: color,
    movable: { color, dests: legalDests(fen), showDests: true },
    draggable: { enabled: true },
  });
}
