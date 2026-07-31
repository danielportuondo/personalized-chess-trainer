import { describe, it, expect, vi, afterEach } from "vitest";
import { track, analysisErrorProps } from "../src/ui/analytics";

// The Umami script defines window.umami in browsers; window === globalThis
// there, so the wrapper reads globalThis.umami — stubbable in node.
type G = typeof globalThis & {
  umami?: { track: (event: string, data?: Record<string, string | number | boolean>) => void };
};

afterEach(() => {
  delete (globalThis as G).umami;
});

describe("track", () => {
  it("no-ops without a umami global (vitest, ad-blocked)", () => {
    expect(() => track("analyze", { username: "magnuscarlsen" })).not.toThrow();
  });

  it("forwards event name and data to umami.track", () => {
    const spy = vi.fn();
    (globalThis as G).umami = { track: spy };
    track("analyze", { username: "magnuscarlsen" });
    expect(spy).toHaveBeenCalledWith("analyze", { username: "magnuscarlsen" });
  });

  it("forwards a data-less event", () => {
    const spy = vi.fn();
    (globalThis as G).umami = { track: spy };
    track("demo-start");
    expect(spy).toHaveBeenCalledWith("demo-start", undefined);
  });

  it("swallows a throwing tracker", () => {
    (globalThis as G).umami = {
      track: () => {
        throw new Error("boom");
      },
    };
    expect(() => track("analyze")).not.toThrow();
  });
});

describe("analysisErrorProps", () => {
  it("classifies unknown-user errors as not-found", () => {
    expect(analysisErrorProps(new Error("Chess.com user not found: xyzzy"))).toEqual({
      stage: "not-found",
      message: "Chess.com user not found: xyzzy",
    });
  });

  it("classifies chess.com API failures", () => {
    expect(analysisErrorProps(new Error("Chess.com API error 503 fetching archives for x")).stage).toBe(
      "chesscom-api",
    );
    expect(analysisErrorProps(new Error("Repeated 429s fetching https://api.chess.com/x")).stage).toBe(
      "chesscom-api",
    );
  });

  it("falls back to other and truncates the message to 100 chars", () => {
    const props = analysisErrorProps(new Error("x".repeat(150)));
    expect(props.stage).toBe("other");
    expect(props.message).toHaveLength(100);
  });

  it("handles non-Error values", () => {
    expect(analysisErrorProps(undefined)).toEqual({ stage: "other", message: "unknown" });
  });
});
