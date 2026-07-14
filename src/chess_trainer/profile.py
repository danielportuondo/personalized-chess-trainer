from __future__ import annotations

import chess

from . import db
from .config import Config

PIECE_VALUES = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 100,  # only used for attacker valuation; a king never wins a defended piece
}
NONPAWN = {chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
MATERIAL = {chess.PAWN: 1, **NONPAWN}
MATE_CP_THRESHOLD = 9000
OPENING_MAX_MOVE = 10
ENDGAME_NPM_MAX = 20
# Walk the engine PV this many plies to measure the tactic's net material yield. Median PV is
# ~11 plies; forcing tactics resolve well within this, and capping bounds positional drift.
PV_PLY_CAP = 16
MATERIAL_GAIN_MIN = 2  # net pawns the best line must win to count as "missed win of material"

REASON = {
    "missed forced mate": "you missed a forced mate",
    "allowed forced mate": "you walked into a forced mate",
    "hanging piece": "you left a piece hanging",
    "missed win of material": "you missed winning material",
    "other": "a stronger move was available",
}


def game_phase(board: chess.Board) -> str:
    if board.fullmove_number <= OPENING_MAX_MOVE:
        return "opening"
    npm = sum(
        value * (len(board.pieces(pt, chess.WHITE)) + len(board.pieces(pt, chess.BLACK)))
        for pt, value in NONPAWN.items()
    )
    return "endgame" if npm <= ENDGAME_NPM_MAX else "middlegame"


def is_hanging(board: chess.Board, square: int, color: chess.Color) -> bool:
    piece = board.piece_at(square)
    if piece is None or piece.color != color:
        return False
    if not board.is_attacked_by(not color, square):
        return False
    if not board.is_attacked_by(color, square):
        return True
    cheapest = min(
        PIECE_VALUES[board.piece_at(a).piece_type] for a in board.attackers(not color, square)
    )
    return cheapest < PIECE_VALUES[piece.piece_type]


def _material(board: chess.Board, color: chess.Color) -> int:
    return sum(v * len(board.pieces(pt, color)) for pt, v in MATERIAL.items())


def pv_material_gain(fen: str, line_uci: str, player: chess.Color) -> int:
    """Net material (in pawns) the player gains by the end of the engine's best line.

    Playing out the whole PV — not just the first move — is what catches multi-move tactics
    (forks, pins, discoveries) whose opening move is a quiet or non-capturing check, which a
    1-ply capture check is blind to.
    """
    board = chess.Board(fen)
    before = _material(board, player) - _material(board, not player)
    for uci in line_uci.split()[:PV_PLY_CAP]:
        try:
            board.push_uci(uci)
        except ValueError:  # covers Invalid/IllegalMoveError (both subclass ValueError)
            break
        if board.is_game_over():
            break
    after = _material(board, player) - _material(board, not player)
    return after - before


def classify_motif(
    fen: str,
    played_uci: str,
    best_uci: str,
    eval_before_cp: int,
    eval_after_played_cp: int | None = None,
    best_line_uci: str | None = None,
) -> str:
    if eval_before_cp >= MATE_CP_THRESHOLD:
        return "missed forced mate"
    if eval_after_played_cp is not None and eval_after_played_cp <= -MATE_CP_THRESHOLD:
        return "allowed forced mate"

    board = chess.Board(fen)
    player = board.turn

    after = board.copy()
    try:
        after.push_uci(played_uci)
    except ValueError:
        after = None
    if after is not None:
        for sq in chess.SQUARES:
            p = after.piece_at(sq)
            if (
                p
                and p.color == player
                and p.piece_type not in (chess.PAWN, chess.KING)
                and is_hanging(after, sq, player)
            ):
                return "hanging piece"

    line = best_line_uci or best_uci
    if (
        line
        and best_uci
        and best_uci != played_uci
        and pv_material_gain(fen, line, player) >= MATERIAL_GAIN_MIN
    ):
        return "missed win of material"

    return "other"


def tag_phases(cfg: Config) -> int:
    conn = db.connect(cfg.db_path)
    db.init_schema(conn)
    rows = conn.execute(
        "SELECT game_url, ply, fen_before FROM move_evals WHERE phase IS NULL"
    ).fetchall()
    for r in rows:
        phase = game_phase(chess.Board(r["fen_before"]))
        conn.execute(
            "UPDATE move_evals SET phase = ? WHERE game_url = ? AND ply = ?",
            (phase, r["game_url"], r["ply"]),
        )
    conn.execute(
        "UPDATE puzzles SET phase = ("
        "  SELECT m.phase FROM move_evals m "
        "  WHERE m.game_url = puzzles.source_game_url AND m.ply = puzzles.source_ply"
        ") WHERE phase IS NULL"
    )
    conn.commit()
    return len(rows)


def tag_motifs(cfg: Config) -> int:
    conn = db.connect(cfg.db_path)
    db.init_schema(conn)
    rows = conn.execute(
        "SELECT p.id, p.fen, p.played_move_uci, p.best_move_uci, p.solution_line_uci, "
        "       p.eval_before_cp, m.eval_after_played_cp "
        "FROM puzzles p "
        "JOIN move_evals m ON m.game_url = p.source_game_url AND m.ply = p.source_ply "
        "WHERE p.motif IS NULL"
    ).fetchall()
    for r in rows:
        motif = classify_motif(
            r["fen"],
            r["played_move_uci"],
            r["best_move_uci"],
            r["eval_before_cp"],
            r["eval_after_played_cp"],
            r["solution_line_uci"],
        )
        conn.execute("UPDATE puzzles SET motif = ? WHERE id = ?", (motif, r["id"]))
    conn.commit()
    return len(rows)


def _grouped(conn, column: str) -> list[dict]:
    rows = conn.execute(
        f"WITH t AS (SELECT COUNT(*) AS c FROM puzzles) "
        f"SELECT COALESCE({column}, 'unknown') AS key, COUNT(*) AS n, "
        f"       ROUND(100.0 * COUNT(*) / (SELECT c FROM t), 1) AS pct, "
        f"       ROUND(AVG(cpl), 0) AS avg_cpl "
        f"FROM puzzles GROUP BY key ORDER BY n DESC"
    ).fetchall()
    return [dict(r) for r in rows]


def _by_move_bucket(conn) -> list[dict]:
    rows = conn.execute(
        "WITH bucketed AS ("
        "  SELECT cpl, source_ply, "
        "  CASE "
        "    WHEN source_ply / 2 + 1 BETWEEN 1  AND 10 THEN '1-10' "
        "    WHEN source_ply / 2 + 1 BETWEEN 11 AND 20 THEN '11-20' "
        "    WHEN source_ply / 2 + 1 BETWEEN 21 AND 30 THEN '21-30' "
        "    ELSE '31+' END AS bucket "
        "  FROM puzzles) "
        "SELECT bucket AS key, COUNT(*) AS n, "
        "       ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM puzzles), 1) AS pct, "
        "       ROUND(AVG(cpl), 0) AS avg_cpl "
        "FROM bucketed GROUP BY bucket ORDER BY MIN(source_ply)"
    ).fetchall()
    return [dict(r) for r in rows]


def weakness_summary(cfg: Config) -> dict:
    conn = db.connect(cfg.db_path)
    db.init_schema(conn)
    total_row = conn.execute("SELECT COUNT(*) AS c, AVG(cpl) AS avg_cpl FROM puzzles").fetchone()
    total = total_row["c"] or 0
    summary = {
        "total_mistakes": total,
        "avg_cpl": round(total_row["avg_cpl"], 1) if total else 0.0,
        "by_phase": [],
        "by_motif": [],
        "by_move_bucket": [],
    }
    if total:
        summary["by_phase"] = _grouped(conn, "phase")
        summary["by_motif"] = _grouped(conn, "motif")
        summary["by_move_bucket"] = _by_move_bucket(conn)
    return summary


def print_weakness_summary(cfg: Config) -> None:
    s = weakness_summary(cfg)
    if not s["total_mistakes"]:
        print("No puzzles yet — run ingest -> analyze -> extract first.")
        return

    print(f"\nWeakness profile: {s['total_mistakes']} mistakes, avg {s['avg_cpl']} CPL\n")
    for title, key in (
        ("By phase", "by_phase"),
        ("By motif", "by_motif"),
        ("By move number", "by_move_bucket"),
    ):
        print(f"{title}:")
        for row in s[key]:
            print(
                f"  {row['key']:<24}{row['pct']:>5}%  "
                f"({row['n']} mistakes, avg {int(row['avg_cpl'])} CPL)"
            )
        print()

    def top(rows):
        return max(rows, key=lambda r: r["n"]) if rows else None

    ph, mo, bu = top(s["by_phase"]), top(s["by_motif"]), top(s["by_move_bucket"])
    print("Highlights:")
    if ph:
        print(f"  - {ph['pct']}% of your rating-losing mistakes happen in the {ph['key']}.")
    if mo:
        print(f"  - Your most common mistake type is '{mo['key']}' ({mo['pct']}%).")
    if bu:
        print(f"  - You blunder most on moves {bu['key']} (avg {int(bu['avg_cpl'])} CPL).")
