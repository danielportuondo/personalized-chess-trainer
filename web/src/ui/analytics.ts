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
