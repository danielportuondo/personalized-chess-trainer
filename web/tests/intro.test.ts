import { describe, it, expect } from "vitest";
import { Chess } from "chessops/chess";
import { parseFen, makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { parsePgn, startingPosition } from "chessops/pgn";
import { parseSan } from "chessops/san";
import { introFrom } from "../src/intro";

// The exact operation the drill's intro animation performs — playing the
// intro's uci from its fenBefore — so the sanity test asserts that invariant.
function applyUci(fen: string, uci: string): string {
  const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  pos.play(parseUci(uci)!);
  return makeFen(pos.toSetup());
}

// Independent PGN walk: the fen at the puzzle's decision point (before the
// move at `ply`), computed without introFrom.
function fenAtPly(pgn: string, ply: number): string {
  const game = parsePgn(pgn)[0];
  const pos = startingPosition(game.headers).unwrap();
  let i = 0;
  for (const node of game.moves.mainline()) {
    if (i === ply) break;
    pos.play(parseSan(pos, node.san)!);
    i++;
  }
  return makeFen(pos.toSetup());
}

describe("introFrom", () => {
  it("derives the opponent's move for a white-user puzzle (sourcePly 2 -> opponent ply 1)", () => {
    const pgn = '[White "user"]\n[Black "opp"]\n\n1. e4 e5 2. Nf3 Nc6 *';
    expect(introFrom(pgn, 2)).toEqual({
      uci: "e7e5",
      fenBefore: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    });
  });

  it("derives the opponent's move for a black-user puzzle (opponent moved at an even ply)", () => {
    const pgn = '[White "opp"]\n[Black "user"]\n\n1. d4 d5 2. c4 e6 *';
    expect(introFrom(pgn, 3)).toEqual({
      uci: "c2c4",
      fenBefore: "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2",
    });
  });

  it("normalizes the opponent's short castle to king-two-square UCI (e1g1, not e1h1)", () => {
    const pgn = "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 *";
    const intro = introFrom(pgn, 7);
    expect(intro?.uci).toBe("e1g1");
    expect(intro?.fenBefore).toBe(
      "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
    );
  });

  it("normalizes the opponent's long castle as Black (e8c8, not e8a8)", () => {
    const pgn = "1. d4 d5 2. Nc3 Nc6 3. Bf4 Bf5 4. Qd2 Qd7 5. Nf3 O-O-O 6. e3 *";
    expect(introFrom(pgn, 10)?.uci).toBe("e8c8");
  });

  it("captures an en-passant intro whose fenBefore carries the ep square", () => {
    const pgn = "1. e4 d5 2. e5 f5 3. exf6 gxf6 *";
    const intro = introFrom(pgn, 5);
    expect(intro?.uci).toBe("e5f6");
    expect(intro?.fenBefore.split(" ")[3]).toBe("f6");
  });

  it("keeps the promotion suffix on the opponent's promoting move", () => {
    const pgn = "1. g4 h5 2. gxh5 g6 3. hxg6 Bh6 4. g7 Bg5 5. gxh8=Q Nc6 *";
    expect(introFrom(pgn, 9)?.uci).toBe("g7h8q");
  });

  it("returns undefined at sourcePly 0 (no preceding move)", () => {
    expect(introFrom("1. e4 e5 *", 0)).toBeUndefined();
  });

  it("returns undefined when sourcePly is beyond the game length", () => {
    expect(introFrom("1. e4 e5 *", 3)).toBeUndefined();
  });

  it("returns undefined for an empty PGN", () => {
    expect(introFrom("", 1)).toBeUndefined();
  });

  it("returns undefined on an illegal SAN before the opponent's move", () => {
    const pgn = "1. e4 e5 2. Ke3 Nc6 3. d4 d5 *"; // Ke3 is illegal at ply 2
    expect(introFrom(pgn, 5)).toBeUndefined();
  });

  it("returns undefined for a Variant game, exactly like analyzeGame", () => {
    const pgn = '[Variant "Chess960"]\n\n1. e4 e5 *';
    expect(introFrom(pgn, 2)).toBeUndefined();
  });

  it("returns undefined for a custom-start FEN game, exactly like analyzeGame", () => {
    const pgn = '[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]\n\n1. Rh8+ Kf7 *';
    expect(introFrom(pgn, 1)).toBeUndefined();
  });

  it("yields intros whose uci applied to fenBefore reproduces the puzzle fen", () => {
    const cases: Array<[string, number]> = [
      ["1. e4 e5 2. Nf3 Nc6 *", 2],
      ["1. d4 d5 2. c4 e6 *", 3],
      ["1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 *", 7], // castling
      ["1. d4 d5 2. Nc3 Nc6 3. Bf4 Bf5 4. Qd2 Qd7 5. Nf3 O-O-O 6. e3 *", 10], // castling
      ["1. e4 d5 2. e5 f5 3. exf6 gxf6 *", 5], // en passant
      ["1. g4 h5 2. gxh5 g6 3. hxg6 Bh6 4. g7 Bg5 5. gxh8=Q Nc6 *", 9], // promotion
    ];
    for (const [pgn, sourcePly] of cases) {
      const intro = introFrom(pgn, sourcePly);
      expect(intro).toBeDefined();
      expect(applyUci(intro!.fenBefore, intro!.uci)).toBe(fenAtPly(pgn, sourcePly));
    }
  });
});
