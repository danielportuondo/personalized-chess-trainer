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
  api.set({ fen: fenAfter, lastMove: [orig, dest] });
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
