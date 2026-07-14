from __future__ import annotations

import time
from collections.abc import Iterable
from dataclasses import dataclass

import httpx

from . import db
from .config import Config
from .models import RawGame

BASE_URL = "https://api.chess.com/pub"
POLITE_DELAY = 0.25
CACHE_TTL_HOURS = 12


@dataclass(frozen=True)
class MonthResult:
    games: list[RawGame]
    etag: str | None
    last_modified: str | None
    not_modified: bool


def _normalize_result(white_result: str | None, black_result: str | None) -> str | None:
    if white_result == "win":
        return "1-0"
    if black_result == "win":
        return "0-1"
    if white_result and black_result:
        return "1/2-1/2"
    return None


def parse_games(archive_url: str, payload: dict) -> list[RawGame]:
    games: list[RawGame] = []
    for g in payload.get("games", []):
        url = g.get("url")
        pgn = g.get("pgn")
        if not url or not pgn:  # pgn is NOT NULL; skip the rare object missing it
            continue
        white = g.get("white") or {}
        black = g.get("black") or {}
        games.append(
            RawGame(
                url=url,
                archive_url=archive_url,
                pgn=pgn,
                time_class=g.get("time_class"),
                time_control=g.get("time_control"),
                rules=g.get("rules"),
                end_time=g.get("end_time"),
                white_username=white.get("username"),
                black_username=black.get("username"),
                white_result=white.get("result"),
                black_result=black.get("result"),
                result=_normalize_result(white.get("result"), black.get("result")),
            )
        )
    return games


def fetch_archives(client: httpx.Client, username: str) -> list[str]:
    resp = client.get(f"/player/{username.lower()}/games/archives")
    if resp.status_code == 404:
        raise SystemExit(f"Chess.com user not found: {username}")
    resp.raise_for_status()
    return resp.json().get("archives", [])


def fetch_month(
    client: httpx.Client,
    archive_url: str,
    *,
    etag: str | None = None,
    last_modified: str | None = None,
    max_retries: int = 3,
) -> MonthResult:
    headers: dict[str, str] = {}
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified
    for attempt in range(max_retries):
        resp = client.get(archive_url, headers=headers)
        if resp.status_code == 429:
            retry_after = float(resp.headers.get("Retry-After", 2**attempt))
            time.sleep(retry_after)
            continue
        if resp.status_code == 304:
            return MonthResult([], etag, last_modified, not_modified=True)
        resp.raise_for_status()
        return MonthResult(
            parse_games(archive_url, resp.json()),
            resp.headers.get("ETag"),
            resp.headers.get("Last-Modified"),
            not_modified=False,
        )
    raise RuntimeError(f"Repeated 429s fetching {archive_url}")


def store_games(conn, games: Iterable[RawGame]) -> int:
    rows = [
        (
            g.url,
            g.archive_url,
            g.pgn,
            g.time_class,
            g.time_control,
            g.rules,
            g.end_time,
            g.white_username,
            g.black_username,
            g.white_result,
            g.black_result,
            g.result,
        )
        for g in games
    ]
    before = conn.total_changes
    conn.executemany(
        "INSERT OR IGNORE INTO raw_games "
        "(url, archive_url, pgn, time_class, time_control, rules, end_time, "
        " white_username, black_username, white_result, black_result, result) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    return conn.total_changes - before


def _within_ttl(conn, fetched_at: str) -> bool:
    row = conn.execute(
        "SELECT (julianday('now') - julianday(?)) * 24 < ?", (fetched_at, CACHE_TTL_HOURS)
    ).fetchone()
    return bool(row[0])


def ingest_all(cfg: Config) -> int:
    conn = db.connect(cfg.db_path)
    db.init_schema(conn)
    total_new = 0
    headers = {"User-Agent": cfg.user_agent()}
    with httpx.Client(base_url=BASE_URL, headers=headers, timeout=30.0) as client:
        archives = fetch_archives(client, cfg.username)
        current_month_url = archives[-1] if archives else None
        for archive_url in archives:
            cache = db.get_cache(conn, archive_url)
            is_current = archive_url == current_month_url
            # Past months are effectively immutable within the TTL; the current month is
            # mutable (still being played) so it is always conditionally re-fetched.
            if cache and not is_current and _within_ttl(conn, cache["fetched_at"]):
                continue
            etag = cache["etag"] if cache else None
            last_modified = cache["last_modified"] if cache else None
            res = fetch_month(client, archive_url, etag=etag, last_modified=last_modified)
            if not res.not_modified:
                total_new += store_games(conn, res.games)
            db.upsert_cache(conn, archive_url, res.etag, res.last_modified)
            conn.commit()
            time.sleep(POLITE_DELAY)
    conn.commit()
    return total_new
