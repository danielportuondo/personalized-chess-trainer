from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS raw_games (
    url            TEXT PRIMARY KEY,
    archive_url    TEXT NOT NULL,
    pgn            TEXT NOT NULL,
    time_class     TEXT,
    time_control   TEXT,
    rules          TEXT,
    end_time       INTEGER,
    white_username TEXT,
    black_username TEXT,
    white_result   TEXT,
    black_result   TEXT,
    result         TEXT,
    fetched_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_raw_games_end_time ON raw_games(end_time);
CREATE INDEX IF NOT EXISTS idx_raw_games_time_class ON raw_games(time_class);

CREATE TABLE IF NOT EXISTS http_cache (
    url           TEXT PRIMARY KEY,
    etag          TEXT,
    last_modified TEXT,
    fetched_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS move_evals (
    game_url             TEXT    NOT NULL REFERENCES raw_games(url),
    ply                  INTEGER NOT NULL,
    fullmove_no          INTEGER NOT NULL,
    player_color         TEXT    NOT NULL,
    fen_before           TEXT    NOT NULL,
    played_move_uci      TEXT    NOT NULL,
    best_move_uci        TEXT    NOT NULL,
    best_line_uci        TEXT    NOT NULL,
    eval_before_cp       INTEGER NOT NULL,
    eval_after_played_cp INTEGER NOT NULL,
    cpl                  INTEGER NOT NULL,
    phase                TEXT,
    PRIMARY KEY (game_url, ply)
);
CREATE INDEX IF NOT EXISTS idx_move_evals_cpl ON move_evals(cpl);

CREATE TABLE IF NOT EXISTS puzzles (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    fen               TEXT    NOT NULL,
    solution_line_uci TEXT    NOT NULL,
    played_move_uci   TEXT    NOT NULL,
    best_move_uci     TEXT    NOT NULL,
    cpl               INTEGER NOT NULL,
    eval_before_cp    INTEGER NOT NULL,
    phase             TEXT,
    motif             TEXT,
    source_game_url   TEXT    NOT NULL,
    source_ply        INTEGER NOT NULL,
    dedupe_key        TEXT    NOT NULL UNIQUE,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (source_game_url, source_ply) REFERENCES move_evals(game_url, ply)
);

CREATE TABLE IF NOT EXISTS review_state (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    puzzle_id     INTEGER NOT NULL UNIQUE REFERENCES puzzles(id),
    ease          REAL    NOT NULL DEFAULT 2.5,
    interval_days INTEGER NOT NULL DEFAULT 0,
    reps          INTEGER NOT NULL DEFAULT 0,
    lapses        INTEGER NOT NULL DEFAULT 0,
    due_date      TEXT    NOT NULL DEFAULT (date('now')),
    last_result   INTEGER,
    last_reviewed TEXT
);
CREATE INDEX IF NOT EXISTS idx_review_due ON review_state(due_date);
"""


def connect(db_path: Path | str) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def get_cache(conn: sqlite3.Connection, url: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT etag, last_modified, fetched_at FROM http_cache WHERE url = ?", (url,)
    ).fetchone()


def upsert_cache(
    conn: sqlite3.Connection, url: str, etag: str | None, last_modified: str | None
) -> None:
    conn.execute(
        "INSERT INTO http_cache (url, etag, last_modified, fetched_at) "
        "VALUES (?, ?, ?, datetime('now')) "
        "ON CONFLICT(url) DO UPDATE SET "
        "etag = excluded.etag, last_modified = excluded.last_modified, "
        "fetched_at = excluded.fetched_at",
        (url, etag, last_modified),
    )
