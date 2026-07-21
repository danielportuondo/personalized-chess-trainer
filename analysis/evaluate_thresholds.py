"""Threshold evaluation for the chess-trainer pipeline.

Regenerates every number in docs/evaluation.md from the local chess_trainer.db.
Run from the repo root:

    uv run python analysis/evaluate_thresholds.py [--skip-engine] [--sample-size N]

Dependencies: stdlib sqlite3 + python-chess (already a project dep) + a local
Stockfish binary (STOCKFISH_PATH env var, else `stockfish` on PATH) for the
MultiPV section only.

Motif/phase logic is imported from the reference implementation
(src/chess_trainer/profile.py). curate_line/difficulty_score are a Python port
of web/src/curate.ts (which has no Python counterpart); the port is verified at
startup against the exact fixture positions in web/tests/curate.test.ts and the
script aborts if any case disagrees.
"""

from __future__ import annotations

import argparse
import os
import random
import sqlite3
import sys
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import chess
import chess.engine

from chess_trainer.profile import _material as material
from chess_trainer.profile import classify_motif

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "chess_trainer.db"

# Pipeline constants under evaluation (extract.py/extract.ts, pipeline.ts, curate.ts).
CPL_THRESHOLDS = (100, 150, 200, 300)
CPL_THRESHOLD_LIVE = 150
EVAL_CAP = 700
GAP_LEVELS = (50, 75, 100, 150)
UNIQUE_GAP_LIVE = 100
MOVE_CAP = 3
MATE_MOVE_CAP = 4
MATERIAL_GAIN_MIN = 2
DEPTH = 12
MATE_SCORE = 10000  # analyze.py MATE_SCORE; web mateScore() uses the same bound
ENGINE_OPTIONS = {"Threads": 1, "Hash": 256}  # matches analyze.py ENGINE_OPTIONS


# ---------------------------------------------------------------------------
# Port of web/src/curate.ts (curateLine + difficultyScore), chessops -> python-chess
# ---------------------------------------------------------------------------


@dataclass
class CuratedLine:
    line_uci: str
    user_moves: int
    goal: str  # "mate" | "material"
    forcing_ratio: float


def _parse_legal(board: chess.Board, token: str) -> chess.Move | None:
    try:
        move = chess.Move.from_uci(token)
    except ValueError:
        return None
    return move if move in board.legal_moves else None


def _is_end(board: chess.Board) -> bool:
    # chessops Position.isEnd(): insufficient material or no legal moves.
    return board.is_insufficient_material() or not any(board.generate_legal_moves())


def curate_line(fen: str, solution_line_uci: str) -> CuratedLine | None:
    try:
        board = chess.Board(fen)
    except ValueError:
        return None
    player = board.turn
    opponent = not player
    start_diff = material(board, player) - material(board, opponent)
    tokens = solution_line_uci.split()
    forcing = 0

    def cut(user_moves: int, goal: str) -> CuratedLine:
        return CuratedLine(
            " ".join(tokens[: 2 * user_moves - 1]), user_moves, goal, forcing / user_moves
        )

    k = 0
    while 2 * k < len(tokens) and k < MATE_MOVE_CAP:
        user_move = _parse_legal(board, tokens[2 * k])
        if user_move is None:
            return None
        opp_material_before = material(board, opponent)
        board.push(user_move)
        captured = material(board, opponent) < opp_material_before
        if captured or board.is_check():
            forcing += 1

        user_moves = k + 1
        if board.is_checkmate():
            return cut(user_moves, "mate")

        reply_token = tokens[2 * k + 1] if 2 * k + 1 < len(tokens) else None
        line_ends = reply_token is None or _is_end(board)
        if not line_ends:
            reply = _parse_legal(board, reply_token)
            if reply is None:
                return None
            board.push(reply)
        gained = (material(board, player) - material(board, opponent)) - start_diff
        if user_moves <= MOVE_CAP and gained >= MATERIAL_GAIN_MIN:
            return cut(user_moves, "material")
        if line_ends or _is_end(board):
            return None
        k += 1
    return None


def difficulty_score(curated: CuratedLine, cpl: int) -> float:
    return curated.user_moves * 10 - curated.forcing_ratio * 5 - min(cpl, 500) / 100


# Fixture positions copied verbatim from web/tests/curate.test.ts. The port must
# reproduce the TypeScript suite's expected outputs exactly.
_MATE_IN_1 = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4"
_MATE_IN_2 = "7k/8/5K2/8/8/8/8/1Q6 w - - 0 1"
_FORK = "r3k3/8/8/3N4/8/8/8/6K1 w - - 0 1"
_SMOTHERED = "5r1k/6pp/8/6N1/2Q5/8/8/6K1 w - - 0 1"
_RECAPTURE = "6k1/8/4p3/3n4/8/8/8/3R2K1 w - - 0 1"
_LATE_GAIN = "1n4k1/7p/8/8/8/8/8/R5K1 w - - 0 1"
_LADDER_4 = "8/8/8/4k3/R7/1R6/8/6K1 w - - 0 1"
_LADDER_5 = "8/8/8/8/4k3/R7/1R6/6K1 w - - 0 1"
_START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

_PARITY_CASES = [
    (_MATE_IN_1, "h5f7", ("h5f7", 1, "mate", 1.0)),
    (_MATE_IN_2, "f6g6 h8g8 b1b8", ("f6g6 h8g8 b1b8", 2, "mate", 0.5)),
    (_FORK, "d5c7 e8d7 c7a8", ("d5c7 e8d7 c7a8", 2, "material", 1.0)),
    (_SMOTHERED, "c4g8 f8g8 g5f7", ("c4g8 f8g8 g5f7", 2, "mate", 1.0)),
    (_FORK, "d5c7 e8d7 c7a8 d7c8 a8c7 c8d8", ("d5c7 e8d7 c7a8", 2, "material", 1.0)),
    (_RECAPTURE, "d1d5 e6d5 g1f1 g8f7", None),
    (_START, "g1f3 g8f6 d2d4 d7d5 c1f4 e7e6", None),
    (_LATE_GAIN, "a1a2 h7h6 a2a3 h6h5 a3b3 h5h4 b3b8", None),
    # every ladder move is a rook check, so forcingRatio = 1.0 (TS test asserts
    # only userMoves/goal here; ratio verified by hand)
    (
        _LADDER_4,
        "a4a5 e5e6 b3b6 e6e7 a5a7 e7e8 b6b8",
        ("a4a5 e5e6 b3b6 e6e7 a5a7 e7e8 b6b8", 4, "mate", 1.0),
    ),
    (_LADDER_5, "a3a4 e4e5 b2b5 e5e6 a4a6 e6e7 b5b7 e7e8 a6a8", None),
    (_MATE_IN_1, "", None),
    (_START, "g1f3 zz9 e2e4", None),
]


def run_parity_checks() -> None:
    failures = []
    for fen, line, expected in _PARITY_CASES:
        got = curate_line(fen, line)
        got_tuple = (
            None if got is None else (got.line_uci, got.user_moves, got.goal, got.forcing_ratio)
        )
        if got_tuple != expected:
            failures.append((fen, line, expected, got_tuple))
    # difficultyScore ordering assertions from the same test file.
    mate1 = curate_line(_MATE_IN_1, "h5f7")
    smothered = curate_line(_SMOTHERED, "c4g8 f8g8 g5f7")
    ladder = curate_line(_LADDER_4, "a4a5 e5e6 b3b6 e6e7 a5a7 e7e8 b6b8")
    ok = difficulty_score(mate1, 800) < difficulty_score(smothered, 400) < difficulty_score(
        ladder, 200
    ) and difficulty_score(mate1, 900) < difficulty_score(mate1, 160)
    if not ok:
        failures.append(("difficultyScore ordering", "", "ordered", "unordered"))
    if failures:
        for f in failures:
            print(f"PARITY FAILURE: {f}", file=sys.stderr)
        sys.exit(1)
    print(f"curate.ts port parity: {len(_PARITY_CASES)} fixture cases + score ordering OK")


# ---------------------------------------------------------------------------
# Small stats helpers (stdlib only)
# ---------------------------------------------------------------------------


def percentile(sorted_vals: list[float], q: float) -> float:
    idx = (len(sorted_vals) - 1) * q / 100
    lo = int(idx)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = idx - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


def ascii_hist(values: list[float], edges: list[float], width: int = 40, fmt: str = "g") -> None:
    bins = [(edges[i], edges[i + 1]) for i in range(len(edges) - 1)]
    counts = [0] * len(bins)
    overflow = 0
    for v in values:
        for i, (lo, hi) in enumerate(bins):
            if lo <= v < hi:
                counts[i] += 1
                break
        else:
            overflow += 1
    rows = [(f"[{lo:{fmt}}, {hi:{fmt}})", c) for (lo, hi), c in zip(bins, counts, strict=True)]
    if overflow:
        rows.append((f">= {edges[-1]:{fmt}}", overflow))
    peak = max(c for _, c in rows) or 1
    total = len(values)
    for label, c in rows:
        bar = "#" * max(1 if c else 0, round(width * c / peak))
        print(f"  {label:>14} {c:>6} ({100 * c / total:5.1f}%) {bar}")


def _ranks(vals: list[float]) -> list[float]:
    order = sorted(range(len(vals)), key=lambda i: vals[i])
    ranks = [0.0] * len(vals)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and vals[order[j + 1]] == vals[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def spearman(x: list[float], y: list[float]) -> float:
    rx, ry = _ranks(x), _ranks(y)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry, strict=True))
    vx = sum((a - mx) ** 2 for a in rx)
    vy = sum((b - my) ** 2 for b in ry)
    return cov / (vx * vy) ** 0.5 if vx and vy else float("nan")


def wilson_ci(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / denom
    return center - half, center + half


def section(title: str) -> None:
    print(f"\n{'=' * 74}\n{title}\n{'=' * 74}")


# ---------------------------------------------------------------------------
# Section 1: dataset description
# ---------------------------------------------------------------------------


def describe_dataset(conn: sqlite3.Connection) -> dict:
    q = lambda sql, *args: conn.execute(sql, args).fetchone()  # noqa: E731
    n_games = q("SELECT COUNT(*) FROM raw_games")[0]
    n_analyzed = q("SELECT COUNT(DISTINCT game_url) FROM move_evals")[0]
    n_evals = q("SELECT COUNT(*) FROM move_evals")[0]
    n_puzzles = q("SELECT COUNT(*) FROM puzzles")[0]
    date_lo, date_hi = q(
        "SELECT MIN(date(end_time,'unixepoch')), MAX(date(end_time,'unixepoch')) "
        "FROM raw_games WHERE url IN (SELECT DISTINCT game_url FROM move_evals)"
    )
    section("1. DATASET")
    print(f"raw games fetched:         {n_games}")
    print(f"games analyzed (depth {DEPTH}): {n_analyzed}")
    print(f"analyzed date range:       {date_lo} .. {date_hi}")
    print(f"player move evals:         {n_evals}")
    print(f"stored puzzles (cpl>=150): {n_puzzles}")
    print("time-class mix of raw games:")
    for row in conn.execute(
        "SELECT COALESCE(time_class,'unknown'), COUNT(*) FROM raw_games GROUP BY 1 ORDER BY 2 DESC"
    ):
        print(f"  {row[0]:<8} {row[1]}")
    return {"n_analyzed": n_analyzed, "n_evals": n_evals, "n_puzzles": n_puzzles}


# ---------------------------------------------------------------------------
# Section 2: CPL threshold sensitivity
# ---------------------------------------------------------------------------


def cpl_sensitivity(conn: sqlite3.Connection, meta: dict) -> None:
    section("2. CPL THRESHOLD SENSITIVITY (extract gate: cpl >= T, |eval| < 700)")
    cpls = sorted(r[0] for r in conn.execute("SELECT cpl FROM move_evals"))
    n = len(cpls)
    print(f"cpl distribution over all {n} evaluated moves (centipawns):")
    print("  pct:  " + "  ".join(f"p{p}={percentile(cpls, p):.0f}" for p in (50, 75, 90, 95, 99)))
    for t in CPL_THRESHOLDS:
        ge = sum(1 for c in cpls if c >= t)
        print(
            f"  cpl >= {t:<4} {ge:>6} moves ({100 * ge / n:5.2f}% of moves; "
            f"percentile rank {100 * (n - ge) / n:.1f})"
        )
    print("\ncpl histogram (all evaluated moves):")
    ascii_hist(cpls, [0, 25, 50, 100, 150, 200, 300, 500, 1000])

    # Candidate rows at the loosest threshold; representatives per dedupe key are
    # stable across thresholds (max-cpl row wins), so dedupe once and re-filter.
    rows = conn.execute(
        "SELECT fen_before, played_move_uci, best_move_uci, best_line_uci, cpl, "
        "       eval_before_cp, eval_after_played_cp "
        "FROM move_evals "
        "WHERE cpl >= ? AND eval_before_cp > ? AND eval_after_played_cp < ? "
        "ORDER BY cpl DESC, game_url, ply",
        (min(CPL_THRESHOLDS), -EVAL_CAP, EVAL_CAP),
    ).fetchall()
    seen: set[str] = set()
    reps = []
    for r in rows:
        key = " ".join(r["fen_before"].split(" ")[:4])
        if key in seen:
            continue
        seen.add(key)
        reps.append(r)

    t0 = time.perf_counter()
    motifs = [
        classify_motif(
            r["fen_before"],
            r["played_move_uci"],
            r["best_move_uci"],
            r["eval_before_cp"],
            r["eval_after_played_cp"],
            r["best_line_uci"],
        )
        for r in reps
    ]
    motif_time = time.perf_counter() - t0

    motif_keys = [
        "missed forced mate",
        "allowed forced mate",
        "hanging piece",
        "missed win of material",
        "other",
    ]
    motif_labels = ["mate-missed", "mate-allowed", "hanging", "material", "other"]
    print(f"\nyield + motif mix by threshold (deduped puzzles; motif pass {motif_time:.0f}s):")
    print(
        f"  {'T':>4} {'puzzles':>8} {'per game':>9} {'med cpl':>8}"
        + "".join(f" {lbl:>13}" for lbl in motif_labels)
    )
    for t in CPL_THRESHOLDS:
        sel = [(r, m) for r, m in zip(reps, motifs, strict=True) if r["cpl"] >= t]
        cnt = Counter(m for _, m in sel)
        med = percentile(sorted(r["cpl"] for r, _ in sel), 50)
        cells = "".join(f" {100 * cnt[m] / len(sel):>12.1f}%" for m in motif_keys)
        print(f"  {t:>4} {len(sel):>8} {len(sel) / meta['n_analyzed']:>9.2f} {med:>8.0f}{cells}")

    stored = conn.execute("SELECT COUNT(*) FROM puzzles").fetchone()[0]
    recomputed_150 = sum(1 for r in reps if r["cpl"] >= CPL_THRESHOLD_LIVE)
    print(
        f"\nvalidation: recomputed yield at T=150 = {recomputed_150} "
        f"vs stored puzzles table = {stored}"
    )
    stored_motifs = dict(conn.execute("SELECT motif, COUNT(*) FROM puzzles GROUP BY motif"))
    recomputed_motifs = Counter(
        m for r, m in zip(reps, motifs, strict=True) if r["cpl"] >= CPL_THRESHOLD_LIVE
    )
    print("validation: motif counts recomputed vs stored:")
    for m in motif_keys:
        print(f"  {m:<24} {recomputed_motifs[m]:>6} vs {stored_motifs.get(m, 0):>6}")


# ---------------------------------------------------------------------------
# Section 3: curation (drillability + difficultyScore)
# ---------------------------------------------------------------------------


def curation_analysis(conn: sqlite3.Connection) -> dict[int, dict]:
    section("3. CURATION GATES + difficultyScore (port of web/src/curate.ts)")
    puzzles = conn.execute(
        "SELECT id, fen, solution_line_uci, cpl, motif FROM puzzles ORDER BY id"
    ).fetchall()
    results: dict[int, dict] = {}
    for p in puzzles:
        c = curate_line(p["fen"], p["solution_line_uci"])
        results[p["id"]] = {
            "curated": c,
            "cpl": p["cpl"],
            "motif": p["motif"],
            "score": difficulty_score(c, p["cpl"]) if c else None,
            "line_len": len(p["solution_line_uci"].split()),
        }
    total = len(puzzles)
    drillable = [r for r in results.values() if r["curated"]]
    print(
        f"stored puzzles: {total}; drillable (mate or >= {MATERIAL_GAIN_MIN} pawns "
        f"banked within caps): {len(drillable)} ({100 * len(drillable) / total:.1f}%)"
    )
    goal_counts = Counter(r["curated"].goal for r in drillable)
    mate_pct = 100 * goal_counts["mate"] / len(drillable)
    material_pct = 100 * goal_counts["material"] / len(drillable)
    print(
        f"goal mix: mate={goal_counts['mate']} ({mate_pct:.1f}%), "
        f"material={goal_counts['material']} ({material_pct:.1f}%)"
    )
    um = Counter(r["curated"].user_moves for r in drillable)
    print(
        "user moves per drill: "
        + ", ".join(f"{k}:{um[k]} ({100 * um[k] / len(drillable):.1f}%)" for k in sorted(um))
    )

    print("\ndrillable rate by motif:")
    by_motif = Counter(r["motif"] for r in results.values())
    by_motif_drill = Counter(r["motif"] for r in drillable)
    for m, n_m in by_motif.most_common():
        print(f"  {m:<24} {by_motif_drill[m]:>5}/{n_m:<5} ({100 * by_motif_drill[m] / n_m:5.1f}%)")

    scores = sorted(r["score"] for r in drillable)
    print(
        f"\ndifficultyScore over drillable puzzles: min={scores[0]:.2f} "
        f"p25={percentile(scores, 25):.2f} p50={percentile(scores, 50):.2f} "
        f"p75={percentile(scores, 75):.2f} max={scores[-1]:.2f}"
    )
    ascii_hist(scores, [0, 5, 10, 15, 20, 25, 30, 35, 40])

    xs = [r["score"] for r in drillable]
    print("\nordering sanity (Spearman rank correlation of difficultyScore with):")
    for label, ys in (
        ("user moves (component, w=10)", [float(r["curated"].user_moves) for r in drillable]),
        ("solution line length (raw PV plies)", [float(r["line_len"]) for r in drillable]),
        ("cpl (component, w=-0.01)", [float(r["cpl"]) for r in drillable]),
        ("forcing ratio (component, w=-5)", [r["curated"].forcing_ratio for r in drillable]),
    ):
        print(f"  {label:<38} rho = {spearman(xs, ys):+.3f}")

    quartiles = [percentile(scores, q) for q in (25, 50, 75)]
    print("\nmean cpl / mean user-moves by difficultyScore quartile (Q1 = served first):")
    for qi in range(4):
        lo = scores[0] - 1 if qi == 0 else quartiles[qi - 1]
        hi = quartiles[qi] if qi < 3 else scores[-1] + 1
        grp = [r for r in drillable if lo < r["score"] <= hi]
        mean_cpl = sum(r["cpl"] for r in grp) / len(grp)
        mean_um = sum(r["curated"].user_moves for r in grp) / len(grp)
        print(
            f"  Q{qi + 1} (score <= {hi:6.2f}): n={len(grp):>5}  "
            f"mean cpl={mean_cpl:6.0f}  mean user moves={mean_um:.2f}"
        )

    print("\nspot-check examples (verify by hand on a board):")
    shown = {"mate": 0, "material": 0}
    for p in puzzles:
        r = results[p["id"]]
        c = r["curated"]
        if not c or shown[c.goal] >= (2 if c.goal == "mate" else 1):
            continue
        shown[c.goal] += 1
        board = chess.Board(p["fen"])
        san = board.variation_san([chess.Move.from_uci(u) for u in c.line_uci.split()])
        print(f"  puzzle #{p['id']} goal={c.goal} userMoves={c.user_moves} score={r['score']:.2f}")
        print(f"    fen:  {p['fen']}")
        print(f"    line: {san}")
    return results


# ---------------------------------------------------------------------------
# Section 4: MultiPV=2 best-vs-second gap
# ---------------------------------------------------------------------------


def multipv_gap(
    conn: sqlite3.Connection,
    curation: dict[int, dict],
    stockfish_path: str,
    sample_size: int,
    seed: int,
) -> None:
    section(f"4. MultiPV=2 GAP (depth {DEPTH}, ambiguity gate: gap < {UNIQUE_GAP_LIVE}cp)")
    all_ids = [r[0] for r in conn.execute("SELECT id FROM puzzles ORDER BY id")]
    rng = random.Random(seed)
    ids = sorted(rng.sample(all_ids, min(sample_size, len(all_ids))))
    fens = dict(
        conn.execute(f"SELECT id, fen FROM puzzles WHERE id IN ({','.join('?' * len(ids))})", ids)
    )
    print(f"sample: {len(ids)} of {len(all_ids)} stored puzzles (seed={seed})")

    engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)
    engine.configure(ENGINE_OPTIONS)
    print(f"engine: {engine.id.get('name', 'unknown')}")
    gaps: list[tuple[int, int]] = []  # (puzzle_id, gap_cp)
    single_reply = 0
    t0 = time.perf_counter()
    try:
        for i, pid in enumerate(ids, 1):
            board = chess.Board(fens[pid])
            infos = engine.analyse(
                board, chess.engine.Limit(depth=DEPTH), multipv=2, game=f"puzzle-{pid}"
            )
            if len(infos) < 2:
                single_reply += 1  # one legal move: web treats as unique, never flags
                continue
            best = infos[0]["score"].pov(board.turn).score(mate_score=MATE_SCORE)
            second = infos[1]["score"].pov(board.turn).score(mate_score=MATE_SCORE)
            gaps.append((pid, best - second))
            if i % 50 == 0:
                print(f"  ...{i}/{len(ids)} ({time.perf_counter() - t0:.0f}s)", file=sys.stderr)
    finally:
        engine.quit()
    elapsed = time.perf_counter() - t0
    print(f"engine pass: {elapsed:.1f}s total, {elapsed / len(ids):.2f}s/position")
    print(f"single-legal-reply positions (never flagged): {single_reply}")

    gap_vals = sorted(g for _, g in gaps)
    print(f"\ngap distribution over {len(gap_vals)} positions (cp, best minus second):")
    print(
        "  pct:  " + "  ".join(f"p{p}={percentile(gap_vals, p):.0f}" for p in (10, 25, 50, 75, 90))
    )
    ascii_hist([float(g) for g in gap_vals], [0, 25, 50, 75, 100, 150, 200, 300, 500])

    # Flag rate over the whole sample (single-reply counts as unflagged), split by
    # curation outcome — the ambiguity gate only has user-visible cost on puzzles
    # the curation layer would otherwise serve.
    groups = (
        ("all puzzles", lambda pid: True),
        ("drillable", lambda pid: curation[pid]["curated"] is not None),
        (
            "  goal=mate",
            lambda pid: (c := curation[pid]["curated"]) is not None and c.goal == "mate",
        ),
        (
            "  goal=material",
            lambda pid: (c := curation[pid]["curated"]) is not None and c.goal == "material",
        ),
        ("not drillable", lambda pid: curation[pid]["curated"] is None),
    )
    print("\nfraction flagged ambiguous at candidate gap thresholds, by curation outcome:")
    print(f"  {'group':<16} {'n':>4}" + "".join(f" {'gap<' + str(g):>12}" for g in GAP_LEVELS))
    for label, pred in groups:
        n_grp = sum(1 for pid in ids if pred(pid))
        if not n_grp:
            continue
        cells = ""
        for g in GAP_LEVELS:
            k = sum(1 for pid, gap in gaps if pred(pid) and gap < g)
            cells += f" {k:>4} ({100 * k / n_grp:4.1f}%)"
        print(f"  {label:<16} {n_grp:>4}{cells}")
    print("\n95% Wilson CI for the flag rate over all sampled puzzles:")
    for g in GAP_LEVELS:
        k = sum(1 for _, gap in gaps if gap < g)
        lo, hi = wilson_ci(k, len(ids))
        marker = "  <- current" if g == UNIQUE_GAP_LIVE else ""
        print(
            f"  gap < {g:>3}cp: {k:>3}/{len(ids)} = {100 * k / len(ids):5.1f}%  "
            f"(CI {100 * lo:.1f}-{100 * hi:.1f}%){marker}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    # 3000 positions ~= 3.5 min of engine time on an M-series laptop; use
    # --sample-size 300 for a ~20s smoke run.
    parser.add_argument("--sample-size", type=int, default=3000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--skip-engine", action="store_true", help="skip the MultiPV Stockfish pass"
    )
    parser.add_argument(
        "--stockfish", default=os.environ.get("STOCKFISH_PATH", "stockfish").strip() or "stockfish"
    )
    args = parser.parse_args()

    t0 = time.perf_counter()
    run_parity_checks()
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    meta = describe_dataset(conn)
    cpl_sensitivity(conn, meta)
    curation = curation_analysis(conn)
    if args.skip_engine:
        print("\n(engine pass skipped)")
    else:
        multipv_gap(conn, curation, args.stockfish, args.sample_size, args.seed)
    print(f"\ntotal runtime: {time.perf_counter() - t0:.1f}s")


if __name__ == "__main__":
    main()
