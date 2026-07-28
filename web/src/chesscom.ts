import type { Provenance, RawGame } from "./types";

export const BASE_URL = "https://api.chess.com/pub";

const MAX_RETRIES = 3;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Port of ingest.py:_normalize_result.
export function normalizeResult(
  whiteResult: string | null | undefined,
  blackResult: string | null | undefined
): string | null {
  if (whiteResult === "win") return "1-0";
  if (blackResult === "win") return "0-1";
  if (whiteResult && blackResult) return "1/2-1/2";
  return null;
}

// Which side the user played and against whom, from the player's perspective.
// White is checked first (mirrors analysis.ts colorOf). Returns undefined —
// never a partial object — when the user isn't in the game or the opponent's
// username is missing.
export function provenanceFrom(game: RawGame, username: string): Provenance | undefined {
  const u = username.toLowerCase();
  let playerColor: "white" | "black";
  let opponent: string | null;
  if ((game.whiteUsername ?? "").toLowerCase() === u) {
    playerColor = "white";
    opponent = game.blackUsername;
  } else if ((game.blackUsername ?? "").toLowerCase() === u) {
    playerColor = "black";
    opponent = game.whiteUsername;
  } else {
    return undefined;
  }
  if (opponent === null) return undefined;

  let result: Provenance["result"] = null;
  if (game.result === "1/2-1/2") result = "draw";
  else if (game.result === "1-0") result = playerColor === "white" ? "win" : "loss";
  else if (game.result === "0-1") result = playerColor === "black" ? "win" : "loss";

  return { opponent, playerColor, endTime: game.endTime, timeClass: game.timeClass, result };
}

// Port of ingest.py:parse_games.
export function parseGames(archiveUrl: string, payload: any): RawGame[] {
  const games: RawGame[] = [];
  for (const g of payload.games ?? []) {
    const url = g.url;
    const pgn = g.pgn;
    if (!url || !pgn) continue; // pgn is required downstream; skip the rare object missing it
    const white = g.white ?? {};
    const black = g.black ?? {};
    games.push({
      url,
      archiveUrl,
      pgn,
      timeClass: g.time_class ?? null,
      timeControl: g.time_control ?? null,
      rules: g.rules ?? null,
      endTime: g.end_time ?? null,
      whiteUsername: white.username ?? null,
      blackUsername: black.username ?? null,
      whiteResult: white.result ?? null,
      blackResult: black.result ?? null,
      result: normalizeResult(white.result, black.result),
    });
  }
  return games;
}

// Port of ingest.py:fetch_archives.
export async function fetchArchives(username: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const resp = await fetchImpl(`${BASE_URL}/player/${username.toLowerCase()}/games/archives`);
  if (resp.status === 404) {
    throw new Error(`Chess.com user not found: ${username}`);
  }
  if (!resp.ok) {
    throw new Error(`Chess.com API error ${resp.status} fetching archives for ${username}`);
  }
  const json = await resp.json();
  return json.archives ?? [];
}

// Port of ingest.py:fetch_month (minus conditional-GET/ETag caching, dropped for Phase 3).
async function fetchMonth(
  archiveUrl: string,
  fetchImpl: typeof fetch,
  sleep: (ms: number) => Promise<void>
): Promise<RawGame[]> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const resp = await fetchImpl(archiveUrl);
    if (resp.status === 429) {
      const retryAfter = resp.headers.get("Retry-After");
      const retryAfterSeconds = retryAfter ? Number(retryAfter) : 2 ** attempt;
      await sleep(retryAfterSeconds * 1000);
      continue;
    }
    if (!resp.ok) {
      throw new Error(`Chess.com API error ${resp.status} fetching ${archiveUrl}`);
    }
    const json = await resp.json();
    return parseGames(archiveUrl, json);
  }
  throw new Error(`Repeated 429s fetching ${archiveUrl}`);
}

export interface FetchRecentGamesOptions {
  maxGames: number;
  skipTimeClasses?: string[];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

// Port of analyze.py:pending_games' filter/order/limit, applied to freshly
// fetched (not-yet-persisted) games instead of a raw_games table.
export async function fetchRecentGames(username: string, options: FetchRecentGamesOptions): Promise<RawGame[]> {
  const { maxGames, skipTimeClasses = ["bullet"], fetchImpl = fetch, sleep = defaultSleep } = options;
  const skipSet = new Set(skipTimeClasses);

  const archives = await fetchArchives(username, fetchImpl);
  const monthsNewestFirst = [...archives].reverse();

  const accumulated: RawGame[] = [];
  for (const archiveUrl of monthsNewestFirst) {
    const games = await fetchMonth(archiveUrl, fetchImpl, sleep);
    for (const g of games) {
      const rulesOk = g.rules === "chess" || g.rules == null;
      const timeClassOk = g.timeClass == null || !skipSet.has(g.timeClass);
      if (rulesOk && timeClassOk) accumulated.push(g);
    }
    if (accumulated.length >= maxGames) break;
  }

  const sorted = [...accumulated].sort((a, b) => (b.endTime ?? -Infinity) - (a.endTime ?? -Infinity));
  return sorted.slice(0, maxGames);
}
