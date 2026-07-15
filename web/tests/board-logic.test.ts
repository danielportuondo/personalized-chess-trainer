import { describe, it, expect } from "vitest";
import { turnColorOf, legalDests, moveToUci } from "../src/ui/board-logic";

const STARTPOS = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";
const WHITE_PROMOTION_FEN = "4k3/4P3/8/8/8/8/8/4K3 w - - 0 1";
const BLACK_PROMOTION_FEN = "4k3/8/8/8/8/8/4p3/4K3 b - - 0 1";
// Rook on a1 can walk to a8 (empty file): tests that reaching the back rank alone
// doesn't trigger the auto-queen suffix — only a pawn move does.
const ROOK_TO_BACK_RANK_FEN = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";

describe("turnColorOf", () => {
  it("startpos is white to move", () => expect(turnColorOf(STARTPOS)).toBe("white"));
  it("reports black to move", () => expect(turnColorOf(BLACK_TO_MOVE)).toBe("black"));
});

describe("legalDests", () => {
  const dests = legalDests(STARTPOS);
  it("has 10 origin squares with moves (8 pawns + 2 knights)", () => expect(dests.size).toBe(10));
  it("e2 can advance one or two squares", () => expect(dests.get("e2")).toEqual(expect.arrayContaining(["e3", "e4"])));
  it("g1 knight can hop to f3 or h3", () => expect(dests.get("g1")).toEqual(expect.arrayContaining(["f3", "h3"])));
  it("totals 20 legal moves across all origins", () => {
    const total = [...dests.values()].reduce((sum, d) => sum + d.length, 0);
    expect(total).toBe(20);
  });
});

describe("moveToUci", () => {
  it("plain pawn push is not suffixed", () => expect(moveToUci(STARTPOS, "e2", "e4")).toBe("e2e4"));
  it("plain knight move is not suffixed", () => expect(moveToUci(STARTPOS, "g1", "f3")).toBe("g1f3"));
  it("white pawn promotes on rank 8 -> auto-queen", () =>
    expect(moveToUci(WHITE_PROMOTION_FEN, "e7", "e8")).toBe("e7e8q"));
  it("black pawn promotes on rank 1 -> auto-queen", () =>
    expect(moveToUci(BLACK_PROMOTION_FEN, "e2", "e1")).toBe("e2e1q"));
  it("a non-pawn move onto the back rank is not suffixed", () =>
    expect(moveToUci(ROOK_TO_BACK_RANK_FEN, "a1", "a8")).toBe("a1a8"));
});
