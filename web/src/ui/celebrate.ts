// Confetti celebrations (canvas-confetti). Every entry point is a no-op under
// prefers-reduced-motion. Colors are the app's chess move-quality palette.
import confetti from "canvas-confetti";
import { prefersReducedMotion } from "./animate";

type ConfettiOptions = NonNullable<Parameters<typeof confetti>[0]>;

const COLORS = ["#81b64c", "#16a394", "#e8752a", "#d99a00", "#ffffff"];

// Big multi-burst for a strong session finish.
export function celebrateBurst(): void {
  if (prefersReducedMotion()) return;
  const fire = (particleRatio: number, opts: ConfettiOptions): void => {
    confetti({
      origin: { y: 0.65 },
      colors: COLORS,
      ...opts,
      particleCount: Math.floor(220 * particleRatio),
    });
  };
  fire(0.25, { spread: 26, startVelocity: 55 });
  fire(0.2, { spread: 60 });
  fire(0.35, { spread: 100, decay: 0.91, scalar: 0.9 });
  fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
  fire(0.1, { spread: 120, startVelocity: 45 });
}

// Small pop at a viewport point (x,y in [0,1]) — used on a correct move.
export function celebratePop(x = 0.5, y = 0.5): void {
  if (prefersReducedMotion()) return;
  confetti({
    particleCount: 44,
    spread: 72,
    startVelocity: 30,
    scalar: 0.85,
    ticks: 110,
    gravity: 1.1,
    origin: { x, y },
    colors: ["#81b64c", "#16a394", "#d99a00"],
  });
}

// Viewport-fraction center of a DOM element — feed into celebratePop so the pop
// originates from the board the user just moved on.
export function elementOrigin(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  return { x: (r.left + r.width / 2) / w, y: (r.top + r.height / 2) / h };
}
