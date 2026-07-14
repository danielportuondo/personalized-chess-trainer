from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RawGame:
    url: str
    archive_url: str
    pgn: str
    time_class: str | None
    time_control: str | None
    rules: str | None
    end_time: int | None
    white_username: str | None
    black_username: str | None
    white_result: str | None
    black_result: str | None
    result: str | None


@dataclass(frozen=True, slots=True)
class MoveEval:
    game_url: str
    ply: int
    fullmove_no: int
    player_color: str
    fen_before: str
    played_move_uci: str
    best_move_uci: str
    best_line_uci: str
    eval_before_cp: int
    eval_after_played_cp: int
    cpl: int
    phase: str | None = None
