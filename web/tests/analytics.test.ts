import { describe, it, expect, vi, afterEach } from "vitest";
import { track } from "../src/ui/analytics";

// The Umami script defines window.umami in browsers; window === globalThis
// there, so the wrapper reads globalThis.umami — stubbable in node.
type G = typeof globalThis & {
  umami?: { track: (event: string, data?: Record<string, string | number | boolean>) => void };
};

afterEach(() => {
  delete (globalThis as G).umami;
});

describe("track", () => {
  it("no-ops without a umami global (node, dev, ad-blocked)", () => {
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
