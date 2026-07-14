from __future__ import annotations

from . import db
from .config import Config


def dedupe_key(fen: str) -> str:
    # Position-only key: drop halfmove clock + fullmove number so a recurring
    # position (or a transposition) is not drilled dozens of times.
    return " ".join(fen.split(" ")[:4])


def extract_puzzles(cfg: Config) -> int:
    conn = db.connect(cfg.db_path)
    db.init_schema(conn)
    rows = conn.execute(
        "SELECT game_url, ply, fen_before, played_move_uci, best_move_uci, best_line_uci, "
        "       cpl, eval_before_cp, eval_after_played_cp, phase "
        "FROM move_evals "
        "WHERE cpl >= ? "
        "  AND eval_before_cp > ? "  # not already lost (nothing to teach)
        "  AND eval_after_played_cp < ? "  # you did real damage, not a slip while still winning
        "ORDER BY cpl DESC",
        (cfg.cpl_threshold, -cfg.eval_cap, cfg.eval_cap),
    ).fetchall()

    before = conn.total_changes
    for row in rows:
        solution = row["best_line_uci"] or row["best_move_uci"]
        conn.execute(
            "INSERT OR IGNORE INTO puzzles "
            "(fen, solution_line_uci, played_move_uci, best_move_uci, cpl, eval_before_cp, "
            " phase, source_game_url, source_ply, dedupe_key) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                row["fen_before"],
                solution,
                row["played_move_uci"],
                row["best_move_uci"],
                row["cpl"],
                row["eval_before_cp"],
                row["phase"],
                row["game_url"],
                row["ply"],
                dedupe_key(row["fen_before"]),
            ),
        )
    conn.commit()
    return conn.total_changes - before
