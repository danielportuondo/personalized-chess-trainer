import { describe, it, expect } from "vitest";
import { turnColorOf, legalDests, moveToUci, applyUci, planSolutionLine } from "../src/ui/board-logic";

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

describe("applyUci", () => {
  it("plays a pawn push and yields the resulting FEN (black to move)", () =>
    expect(applyUci(STARTPOS, "e2e4")).toBe(
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    ));
  it("plays an auto-queen promotion", () =>
    expect(applyUci("8/4P3/8/8/8/8/8/4K1k1 w - - 0 1", "e7e8q")).toBe(
      "4Q3/8/8/8/8/8/8/4K1k1 b - - 0 1",
    ));
  it("throws on an illegal move", () =>
    expect(() => applyUci(STARTPOS, "e2e5")).toThrow());
});

describe("planSolutionLine", () => {
  // Knight royal fork (demo-05): white forks king+queen, black king steps, white takes queen.
  const FORK_FEN = "2q1k3/pp3ppp/8/8/2N5/8/PP3PPP/4K3 w - - 0 1";

  it("builds an interleaved 2-move line: user, opponent reply, final user move", () => {
    const { moves } = planSolutionLine(FORK_FEN, "c4d6 e8e7 d6c8");
    expect(moves).toHaveLength(2);
    expect(moves[0].fenBefore).toBe(FORK_FEN);
    expect(moves[0].expectedUci).toBe("c4d6");
    expect(moves[0].reply?.uci).toBe("e8e7");
    // The opponent's reply lands on exactly the position the next user move faces.
    expect(moves[1].fenBefore).toBe(moves[0].reply?.fenAfter);
    expect(moves[1].expectedUci).toBe("d6c8");
    expect(moves[1].reply).toBeUndefined(); // final move never carries a reply
  });

  it("treats a single-move line as one user move with no reply", () => {
    const mate = "r1bqk1nr/pppp1ppp/2n5/2b1p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1";
    const { moves } = planSolutionLine(mate, "h5f7");
    expect(moves).toHaveLength(1);
    expect(moves[0].expectedUci).toBe("h5f7");
    expect(moves[0].reply).toBeUndefined();
  });

  it("collapses a line ending on an opponent move to a single replyless user move", () => {
    const { moves } = planSolutionLine(STARTPOS, "e2e4 e7e5");
    expect(moves).toHaveLength(1);
    expect(moves[0].expectedUci).toBe("e2e4");
    expect(moves[0].reply).toBeUndefined();
  });

  it("caps at 3 user moves and strips the reply from the capped final move", () => {
    // 4 user (white) knight shuffles interleaved with 3 black shuffles.
    const line = "g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1";
    const { moves } = planSolutionLine(STARTPOS, line);
    expect(moves).toHaveLength(3);
    expect(moves.map((m) => m.expectedUci)).toEqual(["g1f3", "f3g1", "g1f3"]);
    expect(moves[2].reply).toBeUndefined();
  });

  it("respects a custom cap", () => {
    const line = "g1f3 g8f6 f3g1 f6g8 g1f3";
    expect(planSolutionLine(STARTPOS, line, 2).moves).toHaveLength(2);
  });

  it("truncates cleanly at an illegal token", () => {
    const { moves } = planSolutionLine(STARTPOS, "e2e4 e7e5 zzzz");
    expect(moves).toHaveLength(1);
    expect(moves[0].expectedUci).toBe("e2e4");
  });
});
