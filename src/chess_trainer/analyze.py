from __future__ import annotations

import contextlib
import io
import multiprocessing as mp
import os
import sys
import time
from dataclasses import astuple

import chess
import chess.engine
import chess.pgn

from . import db
from .config import Config
from .models import MoveEval
from .profile import game_phase

MATE_SCORE = 10000

# One thread per engine: benchmarks show multi-threaded Stockfish is ~2.6x SLOWER for
# these short fixed-depth searches (Lazy-SMP overhead), so throughput comes from running
# many single-threaded engines across games, not one multi-threaded engine.
ENGINE_OPTIONS = {"Threads": 1, "Hash": 256}

INSERT_SQL = (
    "INSERT OR IGNORE INTO move_evals "
    "(game_url, ply, fullmove_no, player_color, fen_before, played_move_uci, "
    " best_move_uci, best_line_uci, eval_before_cp, eval_after_played_cp, cpl, phase) "
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
)


def pov_cp(pov_score: chess.engine.PovScore, color: chess.Color) -> int:
    # Single choke point: convert Mate(n) -> bounded int BEFORE any arithmetic.
    return pov_score.pov(color).score(mate_score=MATE_SCORE)


def color_of(game: chess.pgn.Game, username: str) -> chess.Color | None:
    u = username.lower()
    if (game.headers.get("White") or "").lower() == u:
        return chess.WHITE
    if (game.headers.get("Black") or "").lower() == u:
        return chess.BLACK
    return None


def analyze_game(engine: chess.engine.SimpleEngine, game_row, cfg: Config) -> list[MoveEval]:
    game = chess.pgn.read_game(io.StringIO(game_row["pgn"]))
    if game is None or game.headers.get("Variant"):
        return []
    board = game.board()
    if board.fen() != chess.STARTING_FEN:  # non-standard start (Chess960 etc.)
        return []
    player_color = color_of(game, cfg.username)
    if player_color is None:
        return []

    limit = cfg.limit()
    # Per-game id -> python-chess sends `ucinewgame` at each game boundary, clearing the
    # transposition table. Makes evals reproducible and independent of how many games an
    # engine saw before, so parallel (many engines) == serial (one engine), bit for bit.
    game_id = game_row["url"]
    evals: list[MoveEval] = []
    for ply, move in enumerate(game.mainline_moves()):
        if board.turn == player_color:
            fen_before = board.fen()
            fullmove_no = board.fullmove_number
            info = engine.analyse(board, limit, game=game_id)
            eval_before = pov_cp(info["score"], player_color)
            pv = info.get("pv") or []
            best_move = pv[0] if pv else move
            best_line = " ".join(m.uci() for m in pv) if pv else best_move.uci()

            after = board.copy()
            after.push(move)
            if after.is_game_over():
                eval_after = MATE_SCORE if after.is_checkmate() else 0
            else:
                eval_after = pov_cp(
                    engine.analyse(after, limit, game=game_id)["score"], player_color
                )

            evals.append(
                MoveEval(
                    game_url=game_row["url"],
                    ply=ply,
                    fullmove_no=fullmove_no,
                    player_color="white" if player_color == chess.WHITE else "black",
                    fen_before=fen_before,
                    played_move_uci=move.uci(),
                    best_move_uci=best_move.uci(),
                    best_line_uci=best_line,
                    eval_before_cp=eval_before,
                    eval_after_played_cp=eval_after,
                    cpl=max(0, eval_before - eval_after),
                    phase=game_phase(board),
                )
            )
        board.push(move)
    return evals


def default_workers() -> int:
    return max(1, (os.cpu_count() or 2) - 1)


def pending_games(conn, cfg: Config, limit: int | None = None) -> list[tuple[str, str]]:
    done = {r[0] for r in conn.execute("SELECT DISTINCT game_url FROM move_evals")}
    conditions = ["(rules = 'chess' OR rules IS NULL)"]
    params: list = []
    if cfg.skip_time_classes:
        placeholders = ",".join("?" for _ in cfg.skip_time_classes)
        conditions.append(f"(time_class IS NULL OR time_class NOT IN ({placeholders}))")
        params.extend(cfg.skip_time_classes)
    query = (
        "SELECT url, pgn FROM raw_games WHERE "
        + " AND ".join(conditions)
        + " ORDER BY end_time DESC"  # analyze most recent games first
    )
    rows = conn.execute(query, params).fetchall()
    pending = [(r["url"], r["pgn"]) for r in rows if r["url"] not in done]
    return pending[:limit] if limit is not None else pending


_SENTINEL = None


def _worker_loop(stockfish_path: str, cfg: Config, in_q, out_q) -> None:
    """Pull games from in_q, push (url, rows | None, err) to out_q; quit engine cleanly.

    Explicitly closing the engine in `finally` (before this process returns) shuts down
    python-chess's non-daemon engine thread, so the worker exits and join() never hangs.
    """
    engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)
    engine.configure(ENGINE_OPTIONS)
    try:
        while True:
            game = in_q.get()
            if game is _SENTINEL:
                break
            url, pgn = game
            try:
                evals = analyze_game(engine, {"url": url, "pgn": pgn}, cfg)
                out_q.put((url, [astuple(e) for e in evals], None))
            except Exception as exc:  # one bad game must not kill the worker
                out_q.put((url, None, str(exc)))
    finally:
        with contextlib.suppress(Exception):
            engine.quit()


def _report(done: int, n: int, moves: int, t0: float, every: int = 25) -> None:
    if done % every and done != n:
        return
    elapsed = time.perf_counter() - t0
    rate = done / elapsed if elapsed else 0.0
    eta = (n - done) / rate / 60 if rate else 0.0
    print(
        f"  {done}/{n} games · {moves} moves · {rate:.1f} g/s · ETA {eta:.1f} min",
        file=sys.stderr,
        flush=True,
    )


def analyze_all(
    cfg: Config,
    limit: int | None = None,
    workers: int | None = None,
    progress: bool = True,
) -> int:
    conn = db.connect(cfg.db_path)
    db.init_schema(conn)
    pending = pending_games(conn, cfg, limit)
    if not pending:
        return 0

    n = len(pending)
    workers = default_workers() if workers is None else max(1, workers)
    workers = min(workers, n)
    total = 0
    t0 = time.perf_counter()

    if workers == 1:
        with chess.engine.SimpleEngine.popen_uci(cfg.stockfish_path) as engine:
            engine.configure(ENGINE_OPTIONS)
            for i, game in enumerate(pending, 1):
                evals = analyze_game(engine, {"url": game[0], "pgn": game[1]}, cfg)
                if evals:
                    conn.executemany(INSERT_SQL, [astuple(e) for e in evals])
                    conn.commit()  # per-game commit -> resumable
                    total += len(evals)
                if progress:
                    _report(i, n, total, t0)
        return total

    # Parallel: N single-threaded engine processes analyze games; the main process is the
    # sole SQLite writer, committing per game -> no lock contention, still resumable.
    ctx = mp.get_context("spawn")
    in_q: mp.Queue = ctx.Queue()
    out_q: mp.Queue = ctx.Queue()
    for game in pending:
        in_q.put(game)
    for _ in range(workers):
        in_q.put(_SENTINEL)  # one poison pill per worker -> clean stop
    procs = [
        ctx.Process(target=_worker_loop, args=(cfg.stockfish_path, cfg, in_q, out_q), daemon=True)
        for _ in range(workers)
    ]
    try:
        for p in procs:
            p.start()
        for done in range(1, n + 1):
            url, rows, err = out_q.get()
            if err is not None:
                print(f"  ! skipped {url}: {err}", file=sys.stderr, flush=True)
            elif rows:
                conn.executemany(INSERT_SQL, rows)
                conn.commit()
                total += len(rows)
            if progress:
                _report(done, n, total, t0)
    finally:
        for p in procs:
            p.join(timeout=15)
        for p in procs:
            if p.is_alive():
                p.terminate()
    return total
