import { describe, it, expect } from "vitest";
import { dedupeKey } from "../src/extract";

describe("dedupeKey", () => {
  const a = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const b = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 5 12";
  const c = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w Kkq - 0 1";
  it("collapses move counters", () => expect(dedupeKey(a)).toBe(dedupeKey(b)));
  it("keeps castling rights", () => expect(dedupeKey(a)).not.toBe(dedupeKey(c)));
});
