import { describe, it, expect, afterEach } from "vitest";
import type { Engine } from "../src/engine";
import { refutationLine, refuteWrongMove, resetRefuteEngine } from "../src/ui/refute";

// Scholar's-mate trap after 1.e4 e5 2.Qh5 Nc6 3.Bc4, black to move: 3...Nf6??
// allows Qxf7# (or Bxf7+ as a slower mating start).
const SCHOLAR_FEN = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3";
// Black to move: ...Nxe4?? abandons the d8 queen to Rxd8.
const HANGS_QUEEN_FEN = "3q4/6k1/5n2/8/4P3/8/8/3RK3 b - - 0 1";
const AFTER_NXE4_FEN = "3q4/6k1/8/8/4n3/8/8/3RK3 w - - 0 2";
const AFTER_RXD8_FEN = "3R4/6k1/8/8/4n3/8/8/4K3 b - - 0 2";
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const nextTick = () => new Promise((r) => setTimeout(r, 0));

describe("refutationLine", () => {
  it("reply that itself mates carries the SAN glyph, no mate-in suffix", () => {
    expect(refutationLine(SCHOLAR_FEN, "g8f6", "h5f7", { cp: null, mate: 1 })).toBe(
      "Nf6 runs into Qxf7#.",
    );
  });

  it("forced mate further out names the distance", () => {
    expect(refutationLine(SCHOLAR_FEN, "g8f6", "c4f7", { cp: null, mate: 2 })).toBe(
      "Nf6 runs into Bxf7+ — mate in 2.",
    );
  });

  it("decisive swing (cp >= 150) states the reply plainly", () => {
    expect(refutationLine(HANGS_QUEEN_FEN, "f6e4", "d1d8", { cp: 620, mate: null })).toBe(
      "Nxe4 runs into Rxd8.",
    );
  });

  it("cp exactly at the threshold is still decisive", () => {
    expect(refutationLine(HANGS_QUEEN_FEN, "f6e4", "d1d8", { cp: 150, mate: null })).toBe(
      "Nxe4 runs into Rxd8.",
    );
  });

  it("small swing gets the soft phrasing", () => {
    expect(refutationLine(START_FEN, "g1f3", "d7d5", { cp: 30, mate: null })).toBe(
      "Nf3 lets it slip — d5 holds; the puzzle line was stronger.",
    );
  });

  it("a negative mate score (side to move is getting mated) is not the mate tier", () => {
    expect(refutationLine(START_FEN, "g1f3", "d7d5", { cp: null, mate: -3 })).toBe(
      "Nf3 lets it slip — d5 holds; the puzzle line was stronger.",
    );
  });
});

function stubEngine(overrides: Partial<Engine> = {}): Engine {
  return {
    analyse: async () => ({ cp: 620, mate: null, pv: ["d1d8"] }),
    analyseTop2: () => Promise.reject(new Error("unused")),
    newGame: async () => {},
    quit: () => {},
    ...overrides,
  };
}

describe("refuteWrongMove (stubbed engine factory)", () => {
  afterEach(resetRefuteEngine);

  it("searches the position after the wrong move and returns the full refutation", async () => {
    const searched: string[] = [];
    const engine = stubEngine({
      analyse: async (fen) => {
        searched.push(fen);
        return { cp: 620, mate: null, pv: ["d1d8", "g7f6"] };
      },
    });

    const ref = await refuteWrongMove(HANGS_QUEEN_FEN, "f6e4", {
      createEngineFn: async () => engine,
    });

    expect(searched).toEqual([AFTER_NXE4_FEN]);
    expect(ref).toEqual({
      fenAfterWrong: AFTER_NXE4_FEN,
      replyUci: "d1d8",
      fenAfterReply: AFTER_RXD8_FEN,
      line: "Nxe4 runs into Rxd8.",
    });
  });

  it("boots the engine once and reuses it across calls", async () => {
    let boots = 0;
    const createEngineFn = async () => {
      boots++;
      return stubEngine();
    };

    await refuteWrongMove(HANGS_QUEEN_FEN, "f6e4", { createEngineFn });
    await refuteWrongMove(HANGS_QUEEN_FEN, "f6e4", { createEngineFn });

    expect(boots).toBe(1);
  });

  it("a boot failure resets the singleton so the next call retries", async () => {
    const failing = async (): Promise<Engine> => {
      throw new Error("wasm load failed");
    };
    await expect(
      refuteWrongMove(HANGS_QUEEN_FEN, "f6e4", { createEngineFn: failing }),
    ).rejects.toThrow(/wasm load failed/);

    let boots = 0;
    const working = async () => {
      boots++;
      return stubEngine();
    };
    await expect(
      refuteWrongMove(HANGS_QUEEN_FEN, "f6e4", { createEngineFn: working }),
    ).resolves.toMatchObject({ replyUci: "d1d8" });
    expect(boots).toBe(1);
  });

  it("rejects when the search exceeds searchTimeoutMs", async () => {
    const engine = stubEngine({ analyse: () => new Promise(() => {}) });
    await expect(
      refuteWrongMove(HANGS_QUEEN_FEN, "f6e4", {
        createEngineFn: async () => engine,
        searchTimeoutMs: 10,
      }),
    ).rejects.toThrow(/timed out/i);
  });

  it("a timed-out search does not poison the singleton", async () => {
    let call = 0;
    const engine = stubEngine({
      analyse: () =>
        ++call === 1
          ? new Promise(() => {})
          : Promise.resolve({ cp: 620, mate: null, pv: ["d1d8"] }),
    });
    let boots = 0;
    const createEngineFn = async () => {
      boots++;
      return engine;
    };

    await expect(
      refuteWrongMove(HANGS_QUEEN_FEN, "f6e4", { createEngineFn, searchTimeoutMs: 10 }),
    ).rejects.toThrow(/timed out/i);
    await expect(
      refuteWrongMove(HANGS_QUEEN_FEN, "f6e4", { createEngineFn }),
    ).resolves.toMatchObject({ replyUci: "d1d8" });
    expect(boots).toBe(1); // a timeout is not a boot failure — the engine survives
  });

  it("rejects on an empty pv (no reply exists after the wrong move)", async () => {
    const engine = stubEngine({ analyse: async () => ({ cp: 0, mate: null, pv: [] }) });
    await expect(
      refuteWrongMove(HANGS_QUEEN_FEN, "f6e4", { createEngineFn: async () => engine }),
    ).rejects.toThrow(/no reply/i);
  });

  it("an illegal wrong move rejects without booting the engine", async () => {
    let boots = 0;
    const createEngineFn = async () => {
      boots++;
      return stubEngine();
    };
    await expect(refuteWrongMove(START_FEN, "e2e5", { createEngineFn })).rejects.toThrow(
      /illegal/,
    );
    expect(boots).toBe(0);
  });

  it("resetRefuteEngine quits the booted engine and forces a fresh boot", async () => {
    let boots = 0;
    let quits = 0;
    const createEngineFn = async () => {
      boots++;
      return stubEngine({
        quit: () => {
          quits++;
        },
      });
    };

    await refuteWrongMove(HANGS_QUEEN_FEN, "f6e4", { createEngineFn });
    resetRefuteEngine();
    await nextTick();
    expect(quits).toBe(1);

    await refuteWrongMove(HANGS_QUEEN_FEN, "f6e4", { createEngineFn });
    expect(boots).toBe(2);
  });
});
