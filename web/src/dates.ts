export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Coarse "how long ago" for provenance lines. Day diff is computed in UTC
// against the caller's local calendar date, so a game near local midnight can
// read one day off — cosmetic, accepted for determinism.
export function timeAgo(epochSeconds: number, today: string): string {
  const gameDay = Math.floor((epochSeconds * 1000) / DAY_MS);
  const todayDay = Math.floor(Date.parse(today + "T00:00:00Z") / DAY_MS);
  const diff = todayDay - gameDay;
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return `${diff} days ago`;
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (diff < 30) return unit(Math.floor(diff / 7), "week");
  if (diff < 365) return unit(Math.floor(diff / 30), "month");
  return unit(Math.floor(diff / 365), "year");
}

export function monthYear(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Local (not UTC) calendar date, so a user's streak follows their own day
// boundary rather than UTC's.
export function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
