// Sound effects for board moves and puzzle feedback — the chess.com sound
// vocabulary (distinct self/opponent/capture/check/... sounds) reimplemented
// with Kenney's CC0 samples (public/sound/SOURCES.txt, REFERENCES.md).
//
// Web Audio over <audio> elements: one shared AudioContext with a fresh
// AudioBufferSourceNode per play gives overlap-safe, low-latency one-shots and
// needs a single gesture unlock. Browsers refuse audio before a user gesture;
// every path into the drill is a click, so the capture-phase unlock below
// always precedes the first intro animation. Like animate.ts/celebrate.ts,
// every entry point is a safe no-op outside a browser (node vitest) and the
// enabled gate lives inside playSound so callers never check the preference.
import { classifySan } from "./board-logic";

export type SoundName =
  | "move-self"
  | "move-opponent"
  | "capture"
  | "castle"
  | "check"
  | "checkmate"
  | "promote"
  | "puzzle-correct"
  | "puzzle-incorrect";

// Wooden thocks land harder than the bell/chime samples; tune by ear here.
const GAIN: Record<SoundName, number> = {
  "move-self": 0.8,
  "move-opponent": 0.8,
  capture: 0.8,
  castle: 0.8,
  check: 0.6,
  checkmate: 0.6,
  promote: 0.6,
  "puzzle-correct": 0.6,
  "puzzle-incorrect": 0.6,
};

const NAMES = Object.keys(GAIN) as SoundName[];
const PREF_KEY = "chess-trainer:soundEnabled";

// Pure: default ON — only an explicit "0" mutes (unknown junk must not).
export function soundPrefFromStorage(raw: string | null): boolean {
  return raw !== "0";
}

// node 22+ ships a localStorage global whose methods only work when the
// process opts in, so a typeof check alone isn't enough.
function storage(): Storage | null {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      return localStorage;
    }
  } catch {
    // SecurityError in storage-restricted embeds
  }
  return null;
}

export function isSoundEnabled(): boolean {
  const store = storage();
  return store ? soundPrefFromStorage(store.getItem(PREF_KEY)) : true;
}

export function setSoundEnabled(on: boolean): void {
  storage()?.setItem(PREF_KEY, on ? "1" : "0");
}

// Pure: special classes map 1:1 to their sample (side-agnostic, like
// chess.com); only a plain move distinguishes who played it.
export function soundForMove(san: string, mover: "self" | "opponent"): SoundName {
  const cls = classifySan(san);
  if (cls === "move") return mover === "self" ? "move-self" : "move-opponent";
  return cls;
}

let fetched: Promise<Map<SoundName, ArrayBuffer>> | null = null;
let ctx: AudioContext | null = null;
const buffers = new Map<SoundName, AudioBuffer>();

async function unlock(): Promise<void> {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  if (buffers.size || !fetched) return;
  const raw = await fetched;
  await Promise.all(
    [...raw].map(async ([name, buf]) => {
      try {
        // slice(): decodeAudioData detaches its input, keep the fetch reusable
        buffers.set(name, await ctx!.decodeAudioData(buf.slice(0)));
      } catch {
        // an undecodable sample just stays silent
      }
    }),
  );
}

// Idempotent; called once from bootApp. Eagerly fetches the samples (~28KB
// total) but defers AudioContext creation + decode to the first gesture,
// avoiding the "AudioContext was not allowed to start" console warning.
export function initSounds(): void {
  if (typeof window === "undefined" || fetched) return;
  fetched = Promise.all(
    NAMES.map(async (name) => {
      const res = await fetch(`/sound/${name}.mp3`);
      return [name, await res.arrayBuffer()] as const;
    }),
  ).then(
    (entries) => new Map(entries),
    () => new Map(), // offline/404: sounds stay silent, app unaffected
  );
  const onGesture = () => void unlock();
  window.addEventListener("pointerdown", onGesture, { capture: true, once: true });
  window.addEventListener("keydown", onGesture, { capture: true, once: true });
}

// Fire-and-forget: silently no-ops when muted, locked (no gesture yet), or the
// sample isn't decoded. Dispatches a DOM event per actual play so live checks
// can assert playback without hearing it (Web Audio is invisible to spies).
export function playSound(name: SoundName): void {
  if (!isSoundEnabled() || !ctx) return;
  const buffer = buffers.get(name);
  if (!buffer) return;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = GAIN[name];
  source.connect(gain).connect(ctx.destination);
  source.start();
  document.dispatchEvent(new CustomEvent("chess-trainer:sound", { detail: { name } }));
}
