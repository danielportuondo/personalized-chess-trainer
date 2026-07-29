// Engine-backed refutation of a wrong drill move: asks Stockfish for the best
// reply to the move the user actually played, so the "Why?" flow can animate
// it and phrase the consequence. The engine is a lazy module-level singleton —
// booted on the first call (first "Why?" click), kept for the session, never
// quit by this module itself. Injection seam mirrors pipeline.ts's
// createEngineFn: tests stub the factory, never a raw Worker.
import { createEngine, type Engine } from "../engine";
import { applyUci, uciToSan } from "./board-logic";

export interface Refutation {
  fenAfterWrong: string; // wrong move applied to fenBefore
  replyUci: string; // engine best reply (pv[0])
  fenAfterReply: string; // reply applied — what the board animates to
  line: string; // user-facing sentence
}

const DECISIVE_CP = 150;
const DEFAULT_SEARCH_TIMEOUT_MS = 8000;

// Phrases the refutation. `score` is the engine's verdict on the position
// AFTER the wrong move in UCI side-to-move convention — i.e. the OPPONENT's
// POV: mate > 0 / cp > 0 mean the replier is winning. Pass analyse()'s result
// straight through; do NOT pre-negate.
export function refutationLine(
  fenBefore: string,
  wrongUci: string,
  replyUci: string,
  score: { cp: number | null; mate: number | null },
): string {
  const wrongSan = uciToSan(fenBefore, wrongUci);
  const replySan = uciToSan(applyUci(fenBefore, wrongUci), replyUci);
  if (score.mate !== null && score.mate > 0) {
    if (replySan.endsWith("#")) return `${wrongSan} runs into ${replySan}.`; // glyph already says mate
    return `${wrongSan} runs into ${replySan} — mate in ${score.mate}.`;
  }
  if (score.cp !== null && score.cp >= DECISIVE_CP) {
    return `${wrongSan} runs into ${replySan}.`;
  }
  return `${wrongSan} lets it slip — ${replySan} holds; the puzzle line was stronger.`;
}

let enginePromise: Promise<Engine> | null = null;

// Rejects after `ms` without cancelling the search: the engine's serial queue
// keeps running, and the late settle is explicitly ignored (not unhandled), so
// a timeout never leaves the singleton broken for the next click.
function raceTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      work.catch(() => {});
      reject(new Error(`refute: engine search timed out after ${ms}ms`));
    }, ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// Throws on ANY failure (illegal move, boot, timeout, terminal position) —
// the caller falls back to its canned copy.
export async function refuteWrongMove(
  fenBefore: string,
  wrongUci: string,
  opts?: { createEngineFn?: typeof createEngine; searchTimeoutMs?: number },
): Promise<Refutation> {
  const fenAfterWrong = applyUci(fenBefore, wrongUci); // bad input fails before paying for a boot

  const booting = (enginePromise ??= (opts?.createEngineFn ?? createEngine)());
  let engine: Engine;
  try {
    engine = await booting;
  } catch (err) {
    // A transient boot failure must not poison later clicks. Only clear our own
    // promise — a newer boot may already have replaced it.
    if (enginePromise === booting) enginePromise = null;
    throw err;
  }

  const info = await raceTimeout(
    engine.analyse(fenAfterWrong),
    opts?.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
  );
  const replyUci = info.pv[0];
  if (!replyUci) {
    // Stalemate/checkmate after the wrong move: nothing to animate.
    throw new Error(`refute: engine found no reply for ${fenAfterWrong}`);
  }

  return {
    fenAfterWrong,
    replyUci,
    fenAfterReply: applyUci(fenAfterWrong, replyUci),
    line: refutationLine(fenBefore, wrongUci, replyUci, { cp: info.cp, mate: info.mate }),
  };
}

// Quits the booted engine (if any) and forgets it; the next refuteWrongMove
// boots fresh. Swallows boot/quit errors — a reset must never throw.
export function resetRefuteEngine(): void {
  const pending = enginePromise;
  enginePromise = null;
  pending?.then((e) => e.quit()).catch(() => {});
}
