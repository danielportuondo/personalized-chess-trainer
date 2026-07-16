// Small motion helpers. The interpolation math is a pure function (unit-tested);
// countUp() is a thin requestAnimationFrame driver over it that honors
// prefers-reduced-motion by jumping straight to the final value.

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Rounded value along an eased from→to path at progress fraction t (clamped to [0,1]).
export function countUpValue(from: number, to: number, t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return Math.round(from + (to - from) * easeOutCubic(clamped));
}

export interface CountUpOptions {
  from?: number;
  to: number;
  durationMs?: number;
  format?: (n: number) => string;
  onDone?: () => void;
}

// Animates el.textContent from `from` to `to`. Under reduced motion (or a
// zero-length / no-op range) it sets the final value immediately. Returns a
// cancel function so callers can stop it if the screen is torn down mid-flight.
export function countUp(el: HTMLElement, opts: CountUpOptions): () => void {
  const from = opts.from ?? 0;
  const { to } = opts;
  const duration = opts.durationMs ?? 900;
  const format = opts.format ?? ((n) => String(n));

  if (prefersReducedMotion() || duration <= 0 || from === to) {
    el.textContent = format(to);
    opts.onDone?.();
    return () => {};
  }

  let raf = 0;
  let start = 0;
  let cancelled = false;

  const step = (ts: number): void => {
    if (cancelled) return;
    if (!start) start = ts;
    const t = (ts - start) / duration;
    el.textContent = format(countUpValue(from, to, t));
    if (t < 1) {
      raf = requestAnimationFrame(step);
    } else {
      el.textContent = format(to);
      opts.onDone?.();
    }
  };
  raf = requestAnimationFrame(step);

  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}
