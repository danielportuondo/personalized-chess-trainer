import { describe, it, expect } from "vitest";
import { gamePhase, pvMaterialGain } from "../src/profile";
// chessops Color is the string literal "white" | "black" (no WHITE constant).

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
