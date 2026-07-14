from __future__ import annotations

import datetime
import random

import chess

from . import db
from .config import Config
from .profile import REASON, weakness_summary


def sm2_update(state: dict, passed: bool, today: datetime.date) -> dict:
    ease = state.get("ease", 2.5)
    interval = state.get("interval_days", 0)
    reps = state.get("reps", 0)
    lapses = state.get("lapses", 0)

    if passed:
        reps += 1
        if reps == 1:
            interval = 1
        elif reps == 2:
            interval = 6
        else:
            interval = round(interval * ease)
        ease = min(3.0, ease + 0.10)
        last_result = 1
    else:
        reps = 0
        lapses += 1
        interval = 1  # collapse to tomorrow so missed puzzles resurface
        ease = max(1.3, ease - 0.20)
        last_result = 0

    due = today + datetime.timedelta(days=interval)
    return {
        "ease": round(ease, 3),
        "interval_days": interval,
        "reps": reps,
        "lapses": lapses,
        "due_date": due.isoformat(),
        "last_result": last_result,
        "last_reviewed": today.isoformat(),
    }


def record_result(puzzle_id: int, passed: bool, conn, today: datetime.date | None = None) -> dict:
    if today is None:
        today = datetime.date.today()
    row = conn.execute(
        "SELECT ease, interval_days, reps, lapses FROM review_state WHERE puzzle_id = ?",
        (puzzle_id,),
    ).fetchone()
    new = sm2_update(dict(row) if row else {}, passed, today)
    conn.execute(
        "INSERT INTO review_state "
        "(puzzle_id, ease, interval_days, reps, lapses, due_date, last_result, last_reviewed) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(puzzle_id) DO UPDATE SET "
        "ease = excluded.ease, interval_days = excluded.interval_days, reps = excluded.reps, "
        "lapses = excluded.lapses, due_date = excluded.due_date, "
        "last_result = excluded.last_result, last_reviewed = excluded.last_reviewed",
        (
            puzzle_id,
            new["ease"],
            new["interval_days"],
            new["reps"],
            new["lapses"],
            new["due_date"],
            new["last_result"],
            new["last_reviewed"],
        ),
    )
    conn.commit()
    return new


def _weighted_sample(items: list, weights: list[float], k: int) -> list:
    # Efraimidis-Spirakis weighted sampling without replacement.
    keyed = sorted(
        zip(items, weights, strict=True),
        key=lambda iw: random.random() ** (1.0 / iw[1]),
        reverse=True,
    )
    return [item for item, _ in keyed[:k]]


def select_due_puzzles(cfg: Config, conn, limit: int | None = None) -> list[dict]:
    limit = limit or cfg.session_size
    candidates = [
        dict(r)
        for r in conn.execute(
            "SELECT p.id, p.fen, p.solution_line_uci, p.played_move_uci, p.best_move_uci, "
            "       p.motif, p.phase "
            "FROM puzzles p LEFT JOIN review_state r ON r.puzzle_id = p.id "
            "WHERE r.puzzle_id IS NULL OR r.due_date <= date('now') "
            "ORDER BY (r.due_date IS NOT NULL), r.due_date"
        ).fetchall()
    ]
    if len(candidates) <= limit:
        return candidates

    summary = weakness_summary(cfg)
    phase_pct = {row["key"]: row["pct"] for row in summary["by_phase"]}
    motif_pct = {row["key"]: row["pct"] for row in summary["by_motif"]}

    def score(pz: dict) -> float:
        return 1.0 + phase_pct.get(pz["phase"], 0) / 100 + motif_pct.get(pz["motif"], 0) / 100

    return _weighted_sample(candidates, [score(p) for p in candidates], limit)


def _read_move(board: chess.Board):
    while True:
        try:
            raw = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            return None  # Ctrl-D or a non-interactive stdin -> end the session, don't crash
        if raw in ("q", "quit"):
            return None
        if raw in ("s", "skip"):
            return "skip"
        for parser in (board.parse_san, board.parse_uci):
            try:
                return parser(raw)
            except ValueError:
                continue
        print("Illegal/unrecognized — try SAN (Nf3) or UCI (g1f3), or 's' to skip, 'q' to quit.")


def review_session(cfg: Config) -> None:
    conn = db.connect(cfg.db_path)
    db.init_schema(conn)
    puzzles = select_due_puzzles(cfg, conn)
    if not puzzles:
        print("No puzzles due. Run the pipeline or come back later.")
        return

    correct = 0
    reviewed = 0
    for i, pz in enumerate(puzzles, 1):
        board = chess.Board(pz["fen"])
        side = "White" if board.turn == chess.WHITE else "Black"
        print(f"\nPuzzle {i}/{len(puzzles)}  (phase: {pz['phase']}, motif: {pz['motif']})")
        print(board.unicode(orientation=board.turn, borders=True))
        print(f"{side} to move.")

        move = _read_move(board)
        if move is None:
            print("Session ended.")
            break
        if move == "skip":
            continue

        reviewed += 1
        passed = move.uci() == pz["solution_line_uci"].split()[0]
        if passed:
            correct += 1
            print("Correct!")
        else:
            best = chess.Move.from_uci(pz["best_move_uci"])
            print(f"Miss. Best was {board.san(best)} — {REASON.get(pz['motif'], 'try again')}.")
        record_result(pz["id"], passed, conn)

    print(f"\nDone. {correct}/{reviewed} correct.")
