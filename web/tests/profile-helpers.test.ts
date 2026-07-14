import { describe, it, expect } from "vitest";
import { parseFen } from "chessops/fen";
import { gamePhase, isHanging, pvMaterialGain } from "../src/profile";
// chessops Color is the string literal "white" | "black" (no WHITE constant).
// Square indices are 0-63, a1=0 .. h8=63 (index = file + 8*rank).

const boardOf = (fen: string) => parseFen(fen).unwrap().board;

describe("gamePhase", () => {
  it("opening by move number", () =>
    expect(gamePhase("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toBe("opening"));
  it("endgame when non-pawn material is low", () =>
    expect(gamePhase("6k1/8/8/8/8/8/8/R5K1 w - - 0 30")).toBe("endgame")); // lone rook: npm=5 ≤ 20
  it("middlegame otherwise", () =>
    expect(gamePhase("r1bqk2r/pppp1ppp/2n2n2/8/8/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 12")).toBe("middlegame"));
});
describe("pvMaterialGain", () => {
  it("wins a rook via a quiet-check knight fork", () =>
    // Nd5-e7+ then captures Rc6: net +5 for White (player to move = White).
    expect(pvMaterialGain("6k1/8/2r5/3N4/8/8/8/6K1 w - - 0 1", "d5e7 g8f7 e7c6", "white")).toBeGreaterThanOrEqual(2));
  it("no swing in a quiet line", () =>
    expect(pvMaterialGain("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", "e2e4", "white")).toBe(0));
});
// Regression coverage for the one hand-rolled, non-mechanical piece of the port:
// attackersTo() (used by isHanging). These lock the pawn-direction term, queen
// coverage in rooksAndQueens/bishopsAndQueens, and the strict `cheapest < value`
// + "defended" branch so a future refactor can't silently break them.
describe("isHanging (locks attackersTo)", () => {
  it("white pawn hangs an undefended black knight (pawn direction)", () =>
    // Black Nd5 (35) attacked by white Pe4 (28), undefended.
    expect(isHanging(boardOf("4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1"), 35, "black")).toBe(true));
  it("black pawn hangs an undefended white knight (pawn direction, other color)", () =>
    // White Nd4 (27) attacked by black Pe5 (36), undefended.
    expect(isHanging(boardOf("4k3/8/8/4p3/3N4/8/8/4K3 w - - 0 1"), 27, "white")).toBe(true));
  it("queen hangs an undefended piece via the rook axis (queen in rooksAndQueens)", () =>
    // Black Rd8 (59) attacked by white Qd1 (3) down the open d-file, undefended.
    expect(isHanging(boardOf("3r3k/8/8/8/8/8/8/3Q3K w - - 0 1"), 59, "black")).toBe(true));
  it("queen hangs an undefended piece via the bishop axis (queen in bishopsAndQueens)", () =>
    // Black Rh8 (63) attacked by white Qa1 (0) along the a1-h8 diagonal, undefended.
    expect(isHanging(boardOf("k6r/8/8/8/8/8/8/Q6K w - - 0 1"), 63, "black")).toBe(true));
  it("defended piece with equal-value cheapest attacker is not hanging (strict < value)", () =>
    // Black Rd5 (35) attacked by white Rd1 (5), defended by black Rd8; cheapest attacker 5 is not < 5.
    expect(isHanging(boardOf("3r3k/8/8/3r4/8/8/8/3R3K w - - 0 1"), 35, "black")).toBe(false));
});
