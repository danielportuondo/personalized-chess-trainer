from __future__ import annotations

import argparse
import dataclasses

from .config import Config

COMMANDS = ("ingest", "analyze", "extract", "profile", "train", "pipeline")


def _run_profile(cfg: Config) -> None:
    from . import profile

    profile.tag_phases(cfg)
    profile.tag_motifs(cfg)
    profile.print_weakness_summary(cfg)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="chess-trainer", description="Personal chess-training pipeline."
    )
    sub = parser.add_subparsers(dest="command")
    for name in COMMANDS:
        p = sub.add_parser(name)
        if name in ("analyze", "pipeline"):
            p.add_argument(
                "--limit", type=int, default=None, help="analyze at most N (most recent) games"
            )
            p.add_argument(
                "--workers",
                type=int,
                default=None,
                help="parallel engine processes (default: CPU count - 1; 1 = serial)",
            )
            p.add_argument(
                "--depth", type=int, default=None, help="Stockfish search depth (default: 12)"
            )
    args = parser.parse_args(argv)
    command = args.command or "ingest"
    cfg = Config.from_env()
    if getattr(args, "depth", None):
        cfg = dataclasses.replace(cfg, depth=args.depth)

    if command == "ingest":
        from . import ingest

        print(f"Ingested {ingest.ingest_all(cfg)} new game(s) for {cfg.username}.")
    elif command == "analyze":
        from . import analyze

        print(
            f"Scored {analyze.analyze_all(cfg, limit=args.limit, workers=args.workers)} "
            "player move(s)."
        )
    elif command == "extract":
        from . import extract

        print(f"Extracted {extract.extract_puzzles(cfg)} new puzzle(s).")
    elif command == "profile":
        _run_profile(cfg)
    elif command == "train":
        from . import train

        train.review_session(cfg)
    elif command == "pipeline":
        from . import analyze, extract, ingest

        print(f"Ingested {ingest.ingest_all(cfg)} new game(s).")
        print(
            f"Scored {analyze.analyze_all(cfg, limit=args.limit, workers=args.workers)} "
            "player move(s)."
        )
        print(f"Extracted {extract.extract_puzzles(cfg)} new puzzle(s).")
        _run_profile(cfg)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
