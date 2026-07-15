// Real Stockfish engine client: spawns the shipped lite-single WASM build
// (web/public/engine/, gitignored — see scripts/copy-engine.mjs) as a classic
// Worker and speaks UCI over postMessage. Fulfills the `AnalyseFn` contract
// from analysis.ts, whose analyzeGame() consumes it — score/pv are relative
// to the side to move, exactly what povCp() expects.
import type { AnalyseFn, AnalysisInfo } from "./analysis";

export interface Engine {
  analyse: AnalyseFn;
  newGame(): Promise<void>;
  quit(): void;
}

export interface EngineOptions {
  depth?: number;
}

const DEFAULT_DEPTH = 12;
const ENGINE_URL = "/engine/stockfish-18-lite-single.js";

export interface ParsedInfo {
  cp: number | null;
  mate: number | null;
  pv: string[];
}

const SCORE_RE = /\bscore\s+(cp|mate)\s+(-?\d+)/;
const PV_RE = /\spv\s+(.+)$/;

// Pure: no score -> null (info string / currmove-only / bestmove lines all lack `score`).
export function parseInfoLine(line: string): ParsedInfo | null {
  const scoreMatch = line.match(SCORE_RE);
  if (!scoreMatch) return null;
  const kind = scoreMatch[1];
  const value = parseInt(scoreMatch[2], 10);
  const pvMatch = line.match(PV_RE);
  const pv = pvMatch ? pvMatch[1].trim().split(/\s+/) : [];
  return {
    cp: kind === "cp" ? value : null,
    mate: kind === "mate" ? value : null,
    pv,
  };
}

export async function createEngine(opts?: EngineOptions): Promise<Engine> {
  const depth = opts?.depth ?? DEFAULT_DEPTH;
  const worker = new Worker(ENGINE_URL);

  // Single choke point for every line the engine posts back; whoever is
  // currently awaiting a reply (handshake / newGame / analyse) owns it.
  let lineHandler: ((line: string) => void) | null = null;
  worker.onmessage = (e: MessageEvent) => {
    lineHandler?.(String(e.data));
  };

  function send(cmd: string): void {
    worker.postMessage(cmd);
  }

  function waitForLine(isMatch: (line: string) => boolean): Promise<void> {
    return new Promise((resolve) => {
      lineHandler = (line) => {
        if (isMatch(line)) {
          lineHandler = null;
          resolve();
        }
      };
    });
  }

  const uciok = waitForLine((line) => line === "uciok");
  send("uci");
  await uciok;

  // Internal serial queue: only one `go` in flight at a time, regardless of
  // how many analyse()/newGame() calls are already pending.
  let queue: Promise<void> = Promise.resolve();
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = queue.then(job, job);
    queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function analyseOnce(fen: string): Promise<AnalysisInfo> {
    const infoPromise = new Promise<ParsedInfo>((resolve, reject) => {
      let lastInfo: ParsedInfo | null = null;
      lineHandler = (line) => {
        if (line.startsWith("bestmove")) {
          lineHandler = null;
          if (lastInfo === null || (lastInfo.cp === null && lastInfo.mate === null)) {
            reject(new Error(`stockfish: no scored "info" line before bestmove (fen: ${fen})`));
            return;
          }
          resolve(lastInfo);
          return;
        }
        const parsed = parseInfoLine(line);
        if (parsed) lastInfo = parsed;
      };
    });
    send(`position fen ${fen}`);
    send(`go depth ${depth}`);
    const info = await infoPromise;
    return { cp: info.cp, mate: info.mate, pv: info.pv };
  }

  async function newGameOnce(): Promise<void> {
    const readyok = waitForLine((line) => line === "readyok");
    send("ucinewgame");
    send("isready");
    await readyok;
  }

  return {
    analyse: (fen: string) => enqueue(() => analyseOnce(fen)),
    newGame: () => enqueue(newGameOnce),
    quit: () => worker.terminate(),
  };
}
