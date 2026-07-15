import { describe, it, expect, vi } from "vitest";
import { fetchArchives, parseGames, fetchRecentGames, normalizeResult, BASE_URL } from "../src/chesscom";

// Minimal fake matching the Response surface chesscom.ts actually reads:
// ok, status, json(), headers.get(name). Nothing richer.
function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (name: string) => headers[name] ?? null },
  };
}

const ARCHIVES_URL = `${BASE_URL}/player/bob/games/archives`;
const JAN = `${BASE_URL}/player/bob/games/2024/01`;
const FEB = `${BASE_URL}/player/bob/games/2024/02`;
const MAR = `${BASE_URL}/player/bob/games/2024/03`;

function rawGame(overrides: Record<string, unknown> = {}) {
  return {
    url: `https://www.chess.com/game/live/${Math.floor(Math.random() * 1e9)}`,
    pgn: "1. e4 e5 2. Nf3",
    white: { username: "bob", result: "win" },
    black: { username: "alice", result: "checkmated" },
    time_class: "rapid",
    time_control: "600",
    rules: "chess",
    end_time: 1000,
    ...overrides,
  };
}

describe("fetchArchives", () => {
  it("throws a clear error on 404 (user not found)", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(404, {}));
    await expect(fetchArchives("nouser", fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      "Chess.com user not found: nouser"
    );
  });

  it("throws on other non-ok statuses", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(500, {}));
    await expect(fetchArchives("bob", fetchImpl as unknown as typeof fetch)).rejects.toThrow();
  });

  it("returns the archives array (chronological) on success", async () => {
    const archives = [JAN, FEB];
    const fetchImpl = vi.fn(async () => fakeResponse(200, { archives }));
    await expect(fetchArchives("bob", fetchImpl as unknown as typeof fetch)).resolves.toEqual(archives);
  });

  it("lowercases the username in the request URL", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(200, { archives: [] }));
    await fetchArchives("BobRoss", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(`${BASE_URL}/player/bobross/games/archives`);
  });
});

describe("normalizeResult", () => {
  it("white win -> 1-0", () => expect(normalizeResult("win", "checkmated")).toBe("1-0"));
  it("black win -> 0-1", () => expect(normalizeResult("checkmated", "win")).toBe("0-1"));
  it("both present (draw) -> 1/2-1/2", () => expect(normalizeResult("agreed", "agreed")).toBe("1/2-1/2"));
  it("neither present -> null", () => expect(normalizeResult(null, null)).toBe(null));
});

describe("parseGames", () => {
  const archiveUrl = JAN;

  it("maps fields and normalizes result (white win)", () => {
    const payload = { games: [rawGame()] };
    const [g] = parseGames(archiveUrl, payload);
    expect(g.result).toBe("1-0");
    expect(g.timeClass).toBe("rapid");
    expect(g.timeControl).toBe("600");
    expect(g.rules).toBe("chess");
    expect(g.endTime).toBe(1000);
    expect(g.whiteUsername).toBe("bob");
    expect(g.blackUsername).toBe("alice");
    expect(g.whiteResult).toBe("win");
    expect(g.blackResult).toBe("checkmated");
    expect(g.archiveUrl).toBe(archiveUrl);
    expect(g.pgn).toBe("1. e4 e5 2. Nf3");
  });

  it("normalizes black win -> 0-1", () => {
    const payload = {
      games: [rawGame({ white: { username: "bob", result: "checkmated" }, black: { username: "alice", result: "win" } })],
    };
    expect(parseGames(archiveUrl, payload)[0].result).toBe("0-1");
  });

  it("normalizes draw (both present) -> 1/2-1/2", () => {
    const payload = {
      games: [rawGame({ white: { username: "bob", result: "agreed" }, black: { username: "alice", result: "agreed" } })],
    };
    expect(parseGames(archiveUrl, payload)[0].result).toBe("1/2-1/2");
  });

  it("skips games missing url or pgn", () => {
    const payload = {
      games: [
        rawGame({ url: undefined }),
        rawGame({ pgn: undefined }),
        rawGame({ url: "keep-me", pgn: "keep-pgn" }),
      ],
    };
    const games = parseGames(archiveUrl, payload);
    expect(games.length).toBe(1);
    expect(games[0].url).toBe("keep-me");
  });

  it("returns [] when payload.games is missing", () => {
    expect(parseGames(archiveUrl, {})).toEqual([]);
  });
});

describe("fetchRecentGames filtering", () => {
  it("drops bullet games and non-chess variants; keeps null rules/timeClass", async () => {
    const payload = {
      games: [
        rawGame({ url: "bullet-game", time_class: "bullet", end_time: 5 }),
        rawGame({ url: "variant-game", rules: "chess960", end_time: 4 }),
        rawGame({ url: "null-rules-game", rules: null, end_time: 3 }),
        rawGame({ url: "null-timeclass-game", time_class: null, end_time: 2 }),
        rawGame({ url: "plain-rapid-game", time_class: "rapid", rules: "chess", end_time: 1 }),
      ],
    };
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === ARCHIVES_URL) return fakeResponse(200, { archives: [JAN] });
      if (url === JAN) return fakeResponse(200, payload);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const games = await fetchRecentGames("bob", { maxGames: 10, fetchImpl: fetchImpl as unknown as typeof fetch });
    const urls = games.map((g) => g.url).sort();
    expect(urls).toEqual(["null-rules-game", "null-timeclass-game", "plain-rapid-game"].sort());
  });
});

describe("fetchRecentGames selection", () => {
  it("returns the most-recent maxGames in endTime DESC order across months", async () => {
    const febPayload = { games: [rawGame({ url: "feb-1", end_time: 500 }), rawGame({ url: "feb-2", end_time: 400 })] };
    const janPayload = { games: [rawGame({ url: "jan-1", end_time: 300 }), rawGame({ url: "jan-2", end_time: 200 })] };
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === ARCHIVES_URL) return fakeResponse(200, { archives: [JAN, FEB] }); // chronological oldest->newest
      if (url === FEB) return fakeResponse(200, febPayload);
      if (url === JAN) return fakeResponse(200, janPayload);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const games = await fetchRecentGames("bob", { maxGames: 3, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(games.map((g) => g.url)).toEqual(["feb-1", "feb-2", "jan-1"]);
  });

  it("stops fetching older months once maxGames worth of passing games is collected", async () => {
    const marPayload = { games: [rawGame({ url: "mar-1", end_time: 900 }), rawGame({ url: "mar-2", end_time: 800 })] };
    const febPayload = { games: [rawGame({ url: "feb-1", end_time: 700 }), rawGame({ url: "feb-2", end_time: 600 })] };
    const janPayload = { games: [rawGame({ url: "jan-1", end_time: 500 })] };
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === ARCHIVES_URL) return fakeResponse(200, { archives: [JAN, FEB, MAR] });
      if (url === MAR) return fakeResponse(200, marPayload);
      if (url === FEB) return fakeResponse(200, febPayload);
      if (url === JAN) return fakeResponse(200, janPayload);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const games = await fetchRecentGames("bob", { maxGames: 3, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(games.map((g) => g.url)).toEqual(["mar-1", "mar-2", "feb-1"]);
    expect(fetchImpl).not.toHaveBeenCalledWith(JAN);
  });

  it("treats missing endTime as sorting last", async () => {
    const payload = {
      games: [rawGame({ url: "no-end-time", end_time: undefined }), rawGame({ url: "has-end-time", end_time: 100 })],
    };
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === ARCHIVES_URL) return fakeResponse(200, { archives: [JAN] });
      if (url === JAN) return fakeResponse(200, payload);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const games = await fetchRecentGames("bob", { maxGames: 2, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(games.map((g) => g.url)).toEqual(["has-end-time", "no-end-time"]);
  });
});

describe("fetchRecentGames 429 retry", () => {
  it("retries after a 429 honoring Retry-After, then succeeds", async () => {
    const payload = { games: [rawGame({ url: "retried-game", end_time: 1 })] };
    let janCalls = 0;
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === ARCHIVES_URL) return fakeResponse(200, { archives: [JAN] });
      if (url === JAN) {
        janCalls += 1;
        if (janCalls === 1) return fakeResponse(429, {}, { "Retry-After": "0" });
        return fakeResponse(200, payload);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const games = await fetchRecentGames("bob", {
      maxGames: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    expect(games.map((g) => g.url)).toEqual(["retried-game"]);
    expect(janCalls).toBe(2);
  });
});
