import { describe, it, expect } from "vitest";
import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import type { Move } from "chessops/types";
import { DEMO_PUZZLES, DEMO_META } from "../src/demo/demoFixture";

function position(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
}

function firstMove(line: string): string {
  return line.split(" ")[0];
}

describe("demo fixture", () => {
  it("ships enough puzzles for a demo session", () => {
    expect(DEMO_PUZZLES.length).toBeGreaterThanOrEqual(6);
  });

  it("has unique dedupeKeys", () => {
    const keys = new Set(DEMO_PUZZLES.map((p) => p.dedupeKey));
    expect(keys.size).toBe(DEMO_PUZZLES.length);
  });

  it("seeds a lived-in best-run high-score", () => {
    expect(DEMO_META.bestRun).toBe(8);
  });

  for (const p of DEMO_PUZZLES) {
    describe(p.dedupeKey, () => {
      it("has a legal FEN with a definite side to move", () => {
        expect(() => position(p.fen)).not.toThrow();
        expect(["white", "black"]).toContain(position(p.fen).turn);
      });

      it("first solution move is legal and equals bestMoveUci", () => {
        const board = position(p.fen);
        const move = parseUci(firstMove(p.solutionLineUci));
        expect(move, "solution UCI parses").toBeTruthy();
        expect(board.isLegal(move as Move)).toBe(true);
        expect(firstMove(p.solutionLineUci)).toBe(p.bestMoveUci);
      });

      it("playedMoveUci is legal and is not the solution", () => {
        const board = position(p.fen);
        const move = parseUci(p.playedMoveUci);
        expect(move, "played UCI parses").toBeTruthy();
        expect(board.isLegal(move as Move)).toBe(true);
        expect(p.playedMoveUci).not.toBe(firstMove(p.solutionLineUci));
      });

      if (p.motif === "missed forced mate") {
        it("the solution move delivers checkmate", () => {
          const board = position(p.fen);
          board.play(parseUci(firstMove(p.solutionLineUci)) as Move);
          expect(board.isCheckmate()).toBe(true);
        });
      }
    });
  }
});
