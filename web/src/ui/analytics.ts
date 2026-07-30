// Umami custom-event tracking. The tracker script (index.html) only runs on
// the production domain (data-domains), so in dev, vitest, and for ad-blocked
// visitors window.umami never exists and every call here is a silent no-op.
type EventData = Record<string, string | number | boolean>;

interface Umami {
  track: (event: string, data?: EventData) => void;
}

export function track(event: string, data?: EventData): void {
  const umami = (globalThis as { umami?: Umami }).umami;
  if (!umami) return;
  try {
    umami.track(event, data);
  } catch {
    // Analytics must never break the app.
  }
}

// Shapes an analysis-pipeline failure into analysis-error event properties.
// The stages mirror the known error messages thrown in src/chesscom.ts;
// anything else (engine, IndexedDB, bugs) lands in "other".
export function analysisErrorProps(err: unknown): { stage: string; message: string } {
  const message = (err as { message?: string } | undefined)?.message ?? "unknown";
  const stage = message.includes("user not found")
    ? "not-found"
    : message.includes("Chess.com API error") || message.includes("Repeated 429s")
      ? "chesscom-api"
      : "other";
  return { stage, message: message.slice(0, 100) };
}
