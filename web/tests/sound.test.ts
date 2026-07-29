import { describe, it, expect } from "vitest";
import { initSounds, isSoundEnabled, playSound, soundForMove, soundPrefFromStorage } from "../src/ui/sound";

describe("soundForMove", () => {
  it("maps special move classes side-agnostically", () => {
    for (const mover of ["self", "opponent"] as const) {
      expect(soundForMove("Qxf7#", mover)).toBe("checkmate");
      expect(soundForMove("Qh5+", mover)).toBe("check");
      expect(soundForMove("e8=Q", mover)).toBe("promote");
      expect(soundForMove("O-O", mover)).toBe("castle");
      expect(soundForMove("exd5", mover)).toBe("capture");
    }
  });

  it("splits plain moves by mover", () => {
    expect(soundForMove("e4", "self")).toBe("move-self");
    expect(soundForMove("Nf3", "opponent")).toBe("move-opponent");
  });
});

describe("soundPrefFromStorage", () => {
  it("defaults to ON when nothing is stored", () => {
    expect(soundPrefFromStorage(null)).toBe(true);
  });

  it('reads "0" as muted and anything else as on', () => {
    expect(soundPrefFromStorage("0")).toBe(false);
    expect(soundPrefFromStorage("1")).toBe(true);
    expect(soundPrefFromStorage("garbage")).toBe(true);
  });
});

describe("node import safety", () => {
  // vitest runs environment:"node" — the module must import and no-op without
  // window/AudioContext/localStorage, like animate.ts's guards.
  it("every entry point no-ops without a browser", () => {
    expect(isSoundEnabled()).toBe(true);
    expect(() => initSounds()).not.toThrow();
    expect(() => playSound("move-self")).not.toThrow();
  });
});
