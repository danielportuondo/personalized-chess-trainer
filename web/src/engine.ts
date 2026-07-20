// Real Stockfish engine client: spawns the shipped lite-single WASM build
// (web/public/engine/, gitignored — see scripts/copy-engine.mjs) as a classic
// Worker and speaks UCI over postMessage. Fulfills the `AnalyseFn` contract
// from analysis.ts, whose analyzeGame() consumes it — score/pv are relative
// to the side to move, exactly what povCp() expects.
//
// The Worker is created through an injectable factory (opts.createWorker) so the
// whole UCI protocol — including timeout/onerror/quit failure paths — is
// unit-testable with a scripted fake, without a browser (see tests/engine.test.ts).
// It also leaves room to swap in the threaded build later without touching callers.
import type { AnalyseFn, AnalysisInfo } from "./analysis";

// Best and second-best lines from a single MultiPV=2 search. `second` is
// undefined when the engine reports only one line (e.g. a single legal move).
export interface Top2 {
  best: AnalysisInfo;
  second?: AnalysisInfo;
}

export interface Engine {
  analyse: AnalyseFn;
  analyseTop2(fen: string): Promise<Top2>;
  newGame(): Promise<void>;
  quit(): void;
}

export interface EngineOptions {
  depth?: number;
  readyTimeoutMs?: number;
  createWorker?: () => Worker;
}

const DEFAULT_DEPTH = 12;
const DEFAULT_READY_TIMEOUT_MS = 20000;
export const ENGINE_URL = "/engine/stockfish-18-lite-single.js";

export interface ParsedInfo {
  cp: number | null;
  mate: number | null;
  pv: string[];
  multipv: number; // 1 when the engine omits the token (single-PV mode)
}

const SCORE_RE = /\bscore\s+(cp|mate)\s+(-?\d+)/;
const PV_RE = /\spv\s+(.+)$/;
const MULTIPV_RE = /\bmultipv\s+(\d+)/;

// Pure: no score -> null (info string / currmove-only / bestmove lines all lack `score`).
export function parseInfoLine(line: string): ParsedInfo | null {
  const scoreMatch = line.match(SCORE_RE);
  if (!scoreMatch) return null;
  const kind = scoreMatch[1];
  const value = parseInt(scoreMatch[2], 10);
  const pvMatch = line.match(PV_RE);
  const pv = pvMatch ? pvMatch[1].trim().split(/\s+/) : [];
  const multipvMatch = line.match(MULTIPV_RE);
  return {
    cp: kind === "cp" ? value : null,
    mate: kind === "mate" ? value : null,
    pv,
    multipv: multipvMatch ? parseInt(multipvMatch[1], 10) : 1,
  };
}

export async function createEngine(opts?: EngineOptions): Promise<Engine> {
  const depth = opts?.depth ?? DEFAULT_DEPTH;
  const readyTimeoutMs = opts?.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const createWorker = opts?.createWorker ?? (() => new Worker(ENGINE_URL));
  const worker = createWorker();

  // Exactly one operation (handshake / analyse / newGame) awaits worker output at
  // a time (searches are serialized below). `currentReject` is its reject fn, so a
  // worker error, a handshake timeout, or quit() can fail-fast the pending waiter
  // instead of leaving it to hang forever.
  let lineHandler: ((line: string) => void) | null = null;
  let currentReject: ((err: Error) => void) | null = null;
  let terminated = false;

  worker.onmessage = (e: MessageEvent) => {
    lineHandler?.(String(e.data));
  };
  worker.onerror = (e: ErrorEvent) => {
    // Symmetric with quit()/timeout: mark terminated + tear down the worker so an
    // error that fires between queued jobs (no waiter pending) can't leave the next
    // enqueue() posting to a dead worker and hanging — it short-circuit-rejects.
    terminated = true;
    currentReject?.(new Error(`stockfish: worker error: ${e?.message || "unknown"}`));
    worker.terminate();
  };

  function send(cmd: string): void {
    worker.postMessage(cmd);
  }

  // Registers the sole pending waiter. `onLine` decides when to resolve/reject;
  // settling clears both `lineHandler` and `currentReject` so no stale reference
  // can fire twice.
  function awaitReply<T>(
    onLine: (line: string, resolve: (v: T) => void, reject: (e: Error) => void) => void
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const settle =
        <A>(fn: (a: A) => void) =>
        (a: A) => {
          lineHandler = null;
          currentReject = null;
          fn(a);
        };
      const settleResolve = settle(resolve);
      const settleReject = settle(reject);
      currentReject = settleReject;
      lineHandler = (line) => onLine(line, settleResolve, settleReject);
    });
  }

  const handshake = awaitReply<void>((line, resolve) => {
    if (line === "uciok") resolve();
  });
  send("uci");
  const timer = setTimeout(() => {
    currentReject?.(
      new Error(`stockfish: engine handshake timed out after ${readyTimeoutMs}ms (no uciok)`)
    );
  }, readyTimeoutMs);
  try {
    await handshake;
  } catch (err) {
    worker.terminate();
    throw err;
  } finally {
    clearTimeout(timer);
  }

  // Internal serial queue: only one `go` in flight at a time, regardless of how
  // many analyse()/newGame() calls are already pending. A job that runs after
  // quit() rejects immediately rather than talking to a terminated worker.
  let queue: Promise<void> = Promise.resolve();
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = () =>
      terminated ? Promise.reject(new Error("stockfish: engine quit")) : job();
    const result = queue.then(run, run);
    queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function analyseOnce(fen: string): Promise<AnalysisInfo> {
    let lastInfo: ParsedInfo | null = null;
    const infoPromise = awaitReply<ParsedInfo>((line, resolve, reject) => {
      if (line.startsWith("bestmove")) {
        if (lastInfo === null || (lastInfo.cp === null && lastInfo.mate === null)) {
          reject(new Error(`stockfish: no scored "info" line before bestmove (fen: ${fen})`));
          return;
        }
        resolve(lastInfo);
        return;
      }
      const parsed = parseInfoLine(line);
      if (parsed) lastInfo = parsed;
    });
    send(`position fen ${fen}`);
    send(`go depth ${depth}`);
    const info = await infoPromise;
    return { cp: info.cp, mate: info.mate, pv: info.pv };
  }

  // One MultiPV=2 search inside a single queued job; the option is restored to
  // 1 before resolving so interleaved analyse() calls are unaffected. setoption
  // has no UCI acknowledgement, so no extra waits are needed around it.
  async function analyseTop2Once(fen: string): Promise<Top2> {
    const lastByIndex = new Map<number, ParsedInfo>();
    const donePromise = awaitReply<void>((line, resolve, reject) => {
      if (line.startsWith("bestmove")) {
        const best = lastByIndex.get(1);
        if (!best || (best.cp === null && best.mate === null)) {
          reject(new Error(`stockfish: no scored "info" line before bestmove (fen: ${fen})`));
          return;
        }
        resolve();
        return;
      }
      const parsed = parseInfoLine(line);
      if (parsed) lastByIndex.set(parsed.multipv, parsed);
    });
    send("setoption name MultiPV value 2");
    send(`position fen ${fen}`);
    send(`go depth ${depth}`);
    try {
      await donePromise;
    } finally {
      send("setoption name MultiPV value 1");
    }
    const toInfo = (p: ParsedInfo): AnalysisInfo => ({ cp: p.cp, mate: p.mate, pv: p.pv });
    const second = lastByIndex.get(2);
    return { best: toInfo(lastByIndex.get(1)!), second: second ? toInfo(second) : undefined };
  }

  function newGameOnce(): Promise<void> {
    const readyok = awaitReply<void>((line, resolve) => {
      if (line === "readyok") resolve();
    });
    send("ucinewgame");
    send("isready");
    return readyok;
  }

  function quit(): void {
    terminated = true;
    currentReject?.(new Error("stockfish: engine quit")); // fail the in-flight job (if any)
    worker.terminate();
  }

  return {
    analyse: (fen: string) => enqueue(() => analyseOnce(fen)),
    analyseTop2: (fen: string) => enqueue(() => analyseTop2Once(fen)),
    newGame: () => enqueue(newGameOnce),
    quit,
  };
}
