import { describe, it, expect } from "vitest";
import { createEngine } from "../src/engine";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Scripts UCI replies without a real Worker/WASM, so the whole protocol
// (handshake, analyse, newGame, timeout, onerror, quit) is unit-testable.
type Handler = (cmd: string, emit: (line: string) => void, failWith: (msg: string) => void) => void;

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  sent: string[] = [];
  constructor(private handler: Handler) {}
  postMessage(cmd: string): void {
    this.sent.push(cmd);
    this.handler(
      cmd,
      (line) => queueMicrotask(() => this.onmessage?.({ data: line } as MessageEvent)),
      (msg) => queueMicrotask(() => this.onerror?.({ message: msg } as ErrorEvent))
    );
  }
  terminate(): void {
    this.terminated = true;
  }
}

function fakeFactory(handler: Handler): { createWorker: () => Worker; last: () => FakeWorker } {
  let instance: FakeWorker | undefined;
  return {
    createWorker: () => {
      instance = new FakeWorker(handler);
      return instance as unknown as Worker;
    },
    last: () => instance as FakeWorker,
  };
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));

describe("createEngine (injected FakeWorker)", () => {
  it("happy path: handshake, analyse, newGame", async () => {
    const { createWorker } = fakeFactory((cmd, emit) => {
      if (cmd === "uci") emit("uciok");
      else if (cmd === "isready") emit("readyok");
      else if (cmd.startsWith("go")) {
        emit("info depth 12 seldepth 18 score cp 34 nodes 1000 pv e2e4 e7e5 g1f3");
        emit("bestmove e2e4 ponder e7e5");
      }
    });

    const engine = await createEngine({ createWorker });

    const info = await engine.analyse(START_FEN);
    expect(info).toEqual({ cp: 34, mate: null, pv: ["e2e4", "e7e5", "g1f3"] });

    await expect(engine.newGame()).resolves.toBeUndefined();
  });

  it("rejects when uciok never arrives (handshake timeout)", async () => {
    const { createWorker, last } = fakeFactory(() => {
      /* never replies */
    });
    await expect(createEngine({ createWorker, readyTimeoutMs: 20 })).rejects.toThrow(/timed out/i);
    expect(last().terminated).toBe(true);
  });

  it("rejects on worker onerror during handshake and terminates the worker", async () => {
    const { createWorker, last } = fakeFactory((cmd, _emit, failWith) => {
      if (cmd === "uci") failWith("wasm load failed");
    });
    await expect(createEngine({ createWorker })).rejects.toThrow(/wasm load failed/);
    expect(last().terminated).toBe(true);
  });

  it("quit() rejects an in-flight analyse (no hang)", async () => {
    const { createWorker, last } = fakeFactory((cmd, emit) => {
      if (cmd === "uci") emit("uciok");
      else if (cmd.startsWith("go")) emit("info depth 1 score cp 10 pv e2e4"); // no bestmove
    });

    const engine = await createEngine({ createWorker });
    const pending = engine.analyse(START_FEN);
    await nextTick(); // let the queued job start and send `go`
    expect(last().sent).toContain("go depth 12");

    engine.quit();
    await expect(pending).rejects.toThrow(/quit/i);
    expect(last().terminated).toBe(true);
  });
});
