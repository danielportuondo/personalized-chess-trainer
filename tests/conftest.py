import pytest

from chess_trainer import db


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    db.init_schema(c)
    yield c
    c.close()


@pytest.fixture
def sample_archive():
    return {
        "games": [
            {
                "url": "https://www.chess.com/game/live/1",
                "pgn": '[White "dportuondo"]\n[Black "opp"]\n\n1. e4 e5 *',
                "time_class": "rapid",
                "time_control": "600",
                "rules": "chess",
                "end_time": 1_700_000_000,
                "white": {"username": "dportuondo", "result": "win"},
                "black": {"username": "opp", "result": "resigned"},
            },
            {
                "url": "https://www.chess.com/game/live/2",
                "pgn": '[White "opp2"]\n[Black "dportuondo"]\n\n1. d4 d5 *',
                "time_class": "blitz",
                "time_control": "180",
                "rules": "chess",
                "end_time": 1_700_100_000,
                "white": {"username": "opp2", "result": "agreed"},
                "black": {"username": "dportuondo", "result": "agreed"},
            },
            {
                # missing pgn -> must be dropped
                "url": "https://www.chess.com/game/live/3",
                "time_class": "bullet",
                "white": {"username": "dportuondo", "result": "checkmated"},
                "black": {"username": "opp3", "result": "win"},
            },
        ]
    }
