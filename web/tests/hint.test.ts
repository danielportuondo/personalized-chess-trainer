import { describe, it, expect } from "vitest";
import { HINT, REASON } from "../src/profile";
import type { Motif } from "../src/types";

// `satisfies Record<Motif, true>` makes this a COMPILE error if a motif is added
// or removed without updating the list — keeps the runtime checks exhaustive.
const MOTIFS = Object.keys({
  "missed forced mate": true,
  "allowed forced mate": true,
  "hanging piece": true,
  "missed win of material": true,
  other: true,
} satisfies Record<Motif, true>) as Motif[];

describe("HINT (pre-move coach copy)", () => {
  it("covers every motif with a non-empty line", () => {
    for (const m of MOTIFS) {
      expect(HINT[m], m).toBeTruthy();
      expect(HINT[m].trim().length, m).toBeGreaterThan(0);
    }
  });

  it("reads differently from the post-mortem REASON copy", () => {
    for (const m of MOTIFS) {
      expect(HINT[m], m).not.toBe(REASON[m]);
    }
  });
});
