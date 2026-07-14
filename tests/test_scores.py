import chess
import chess.engine

from chess_trainer.analyze import MATE_SCORE, analyze_game, pov_cp
from chess_trainer.config import Config


def _cfg():
    return Config(username="dportuondo", stockfish_path="/nonexistent", contact_email="x@y.z")


def test_pov_cp_mate_conversion():
    def m(n):
        return pov_cp(chess.engine.PovScore(chess.engine.Mate(n), chess.WHITE), chess.WHITE)

    # Mate is a bounded int; a faster mate ranks higher, and being mated sooner is worse.
    assert m(3) == MATE_SCORE - 3
    assert m(-3) == -MATE_SCORE + 3
    assert m(1) > m(5)
    assert m(-1) < m(-5)


def test_pov_cp_plain_and_perspective():
    assert pov_cp(chess.engine.PovScore(chess.engine.Cp(150), chess.WHITE), chess.WHITE) == 150
    # A score relative to Black flips sign when read from White's POV.
    assert pov_cp(chess.engine.PovScore(chess.engine.Cp(900), chess.BLACK), chess.WHITE) == -900


class FakeEngine:
    """Returns scripted analyse() results in call order."""

    def __init__(self, infos):
        self._infos = list(infos)
        self.calls = 0

    def analyse(self, board, limit, game=None):
        info = self._infos[self.calls]
        self.calls += 1
        return info


def test_cpl_hanging_queen():
    # White (dportuondo) is roughly equal, then plays a move that hands Black +900.
    row = {"url": "g1", "pgn": '[White "dportuondo"]\n[Black "opp"]\n\n1. e4 *'}
    infos = [
        {
            "score": chess.engine.PovScore(chess.engine.Cp(40), chess.WHITE),
            "pv": [chess.Move.from_uci("e2e4")],
        },
        {"score": chess.engine.PovScore(chess.engine.Cp(900), chess.BLACK), "pv": []},
    ]
    evals = analyze_game(FakeEngine(infos), row, _cfg())
    assert len(evals) == 1
    e = evals[0]
    assert e.eval_before_cp == 40
    assert e.eval_after_played_cp == -900  # player POV after the blunder
    assert e.cpl == 940


def test_cpl_clamped_when_already_losing():
    # Player already worse; a reasonable move should not produce negative CPL.
    row = {"url": "g2", "pgn": '[White "dportuondo"]\n[Black "opp"]\n\n1. e4 *'}
    infos = [
        {
            "score": chess.engine.PovScore(chess.engine.Cp(-300), chess.WHITE),
            "pv": [chess.Move.from_uci("e2e4")],
        },
        {"score": chess.engine.PovScore(chess.engine.Cp(300), chess.BLACK), "pv": []},
    ]
    e = analyze_game(FakeEngine(infos), row, _cfg())[0]
    assert e.eval_before_cp == -300
    assert e.eval_after_played_cp == -300
    assert e.cpl == 0
