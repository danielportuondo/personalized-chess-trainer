import datetime

import chess

from chess_trainer.config import Config
from chess_trainer.extract import dedupe_key
from chess_trainer.profile import classify_motif, weakness_summary
from chess_trainer.train import _read_move, sm2_update

TODAY = datetime.date(2026, 1, 1)


def test_sm2_new_pass():
    s = sm2_update({}, passed=True, today=TODAY)
    assert s["reps"] == 1
    assert s["interval_days"] == 1
    assert s["due_date"] == "2026-01-02"


def test_sm2_growth():
    s = sm2_update({"ease": 2.5, "interval_days": 6, "reps": 2}, passed=True, today=TODAY)
    assert s["reps"] == 3
    assert s["interval_days"] == 15  # round(6 * 2.5)
    assert s["ease"] == 2.6


def test_sm2_fail_collapses_and_is_sooner():
    far = {"ease": 2.5, "interval_days": 15, "reps": 3}
    passed = sm2_update(far, passed=True, today=TODAY)
    failed = sm2_update(far, passed=False, today=TODAY)
    assert failed["interval_days"] == 1
    assert failed["reps"] == 0
    assert failed["lapses"] == 1
    assert failed["ease"] == 2.3
    assert failed["due_date"] < passed["due_date"]  # missed puzzle resurfaces sooner


def test_sm2_ease_floor():
    s = {"ease": 1.3, "interval_days": 5, "reps": 2}
    for _ in range(3):
        s = sm2_update(s, passed=False, today=TODAY)
        assert s["ease"] == 1.3  # never drops below the SM-2 floor


def test_motif_missed_forced_mate():
    assert classify_motif(chess.STARTING_FEN, "e2e4", "e2e4", 9500) == "missed forced mate"


def test_motif_allowed_forced_mate():
    # The played move leaves the player in a lost-to-mate position (eval_after <= -MATE).
    assert (
        classify_motif(chess.STARTING_FEN, "e2e4", "d2d4", 0, eval_after_played_cp=-9800)
        == "allowed forced mate"
    )


def test_motif_hanging_piece():
    # White rook plays to a5 where a black pawn on b6 attacks it and nothing defends it.
    fen = "6k1/8/1p6/8/8/8/6K1/R7 w - - 0 1"
    assert classify_motif(fen, "a1a5", "g2f2", 0) == "hanging piece"


def test_motif_missed_win_of_material():
    # White pawn on e4 could take an undefended knight on d5; instead White plays a quiet king move.
    fen = "7k/8/8/3n4/4P3/8/8/6K1 w - - 0 1"
    assert classify_motif(fen, "g1f1", "e4d5", 0) == "missed win of material"


def test_motif_missed_material_via_pv():
    # A knight fork whose first move is a non-capturing check: Nd5-e7+ forks Kg8 and Rc6,
    # winning the rook on the next move. The 1-ply-capture heuristic can't see this; the PV can.
    fen = "6k1/8/2r5/3N4/8/8/8/6K1 w - - 0 1"
    assert (
        classify_motif(fen, "g1g2", "d5e7", 0, best_line_uci="d5e7 g8f7 e7c6")
        == "missed win of material"
    )


def test_motif_quiet_error_is_other():
    # No mate, no hanging piece, no material swing in the best line -> genuinely "other".
    fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"
    assert classify_motif(fen, "e1d1", "e2e4", 0, best_line_uci="e2e4") == "other"


def test_read_move_eof_ends_session(monkeypatch):
    # Non-interactive stdin (or Ctrl-D) must end the session cleanly, not raise EOFError.
    def raise_eof(_prompt):
        raise EOFError

    monkeypatch.setattr("builtins.input", raise_eof)
    assert _read_move(chess.Board()) is None


def test_weakness_summary_caps_mate_sentinel_cpl(tmp_path):
    # A missed mate carries cpl ~9900 (mate sentinel minus a small eval); uncapped
    # it would dominate every average. Counts must stay uncapped.
    from chess_trainer import db as ct_db

    cfg = Config(
        username="t",
        stockfish_path="stockfish",
        contact_email="t@example.com",
        db_path=tmp_path / "t.db",
    )
    conn = ct_db.connect(cfg.db_path)
    ct_db.init_schema(conn)
    # puzzles FK-chains to move_evals -> raw_games, so seed minimal parents first.
    conn.execute("INSERT INTO raw_games (url, archive_url, pgn) VALUES ('g', 'a', '1. e4 *')")
    conn.executemany(
        "INSERT INTO move_evals (game_url, ply, fullmove_no, player_color, fen_before,"
        " played_move_uci, best_move_uci, best_line_uci, eval_before_cp, eval_after_played_cp,"
        " cpl) VALUES ('g', ?, 1, 'white', 'f', 'e2e4', 'e2e4', 'e2e4', 0, 0, ?)",
        [(1, 9900), (3, 100)],
    )
    rows = [
        ("f1", "e2e4", "e2e4", "e2e4", 9900, 9500, "opening", "missed forced mate", "g", 1, "k1"),
        ("f2", "e2e4", "e2e4", "e2e4", 100, 0, "opening", "hanging piece", "g", 3, "k2"),
    ]
    conn.executemany(
        "INSERT INTO puzzles (fen, solution_line_uci, played_move_uci, best_move_uci, cpl,"
        " eval_before_cp, phase, motif, source_game_url, source_ply, dedupe_key)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    conn.close()

    s = weakness_summary(cfg)
    assert s["avg_cpl"] == 550.0  # (1000 + 100) / 2, not (9900 + 100) / 2
    assert s["by_phase"] == [{"key": "opening", "n": 2, "pct": 100.0, "avg_cpl": 550.0}]
    mate_row = next(r for r in s["by_motif"] if r["key"] == "missed forced mate")
    assert mate_row["avg_cpl"] == 1000.0
    assert mate_row["n"] == 1


def test_dedupe_key_collapses_move_counters():
    a = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    b = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 5 12"
    c = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w Kkq - 0 1"  # different castling rights
    assert dedupe_key(a) == dedupe_key(b)
    assert dedupe_key(a) != dedupe_key(c)
