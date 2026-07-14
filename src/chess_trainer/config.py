from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

DEFAULT_DB_PATH = Path("chess_trainer.db")


@dataclass(frozen=True)
class Config:
    username: str
    stockfish_path: str
    contact_email: str
    db_path: Path = DEFAULT_DB_PATH
    cpl_threshold: int = 150
    eval_cap: int = 700
    limit_kind: str = "depth"
    depth: int = 12
    move_time: float = 0.2
    skip_time_classes: frozenset[str] = frozenset({"bullet"})
    session_size: int = 15

    @classmethod
    def from_env(cls) -> Config:
        username = os.environ.get("CHESSCOM_USERNAME", "").strip()
        if not username:
            raise SystemExit("CHESSCOM_USERNAME is not set (copy .env.example to .env).")
        db_override = os.environ.get("CHESS_TRAINER_DB", "").strip()
        return cls(
            username=username,
            stockfish_path=os.environ.get("STOCKFISH_PATH", "stockfish").strip(),
            contact_email=os.environ.get("CONTACT_EMAIL", "unknown@example.com").strip(),
            db_path=Path(db_override) if db_override else DEFAULT_DB_PATH,
            cpl_threshold=int(os.environ.get("CPL_THRESHOLD", "150")),
        )

    def user_agent(self) -> str:
        return f"chess-trainer/0.1 ({self.username}; {self.contact_email})"

    def limit(self):
        import chess.engine

        if self.limit_kind == "time":
            return chess.engine.Limit(time=self.move_time)
        return chess.engine.Limit(depth=self.depth)
