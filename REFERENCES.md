# References

The data sources, libraries, conventions, and tooling this project is built on, with what each is used for and its license. The repo's own code is [MIT](LICENSE); see [License notes](#license-notes) for how the GPL-licensed chess dependencies fit in.

## Data sources & APIs

- **[Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api)** — the source of every game the trainer analyzes. Monthly archives are fetched from `https://api.chess.com/pub/player/{user}/games/archives` with 429/`Retry-After` handling (`web/src/chesscom.ts`, ported from `src/chess_trainer/ingest.py`). Public API, no key required; games are fetched client-side and never leave the browser.

## Engine

- **[Stockfish](https://stockfishchess.org/)** (GPL-3.0) — the evaluation engine behind the whole pipeline. The web app ships the `stockfish-18-lite-single` WASM build from the [`stockfish` npm package](https://www.npmjs.com/package/stockfish) (copied into `web/public/engine/` by `web/scripts/copy-engine.mjs`) and runs it as a classic Web Worker speaking UCI (`web/src/engine.ts`). The solution-uniqueness gate is a single MultiPV=2 search per puzzle (`analyseTop2` in `web/src/engine.ts`). The CLI and the [evaluation memo](docs/evaluation.md) use a native Stockfish 18 binary instead.

## Web app libraries

- **[chessops](https://github.com/niklasf/chessops)** (GPL-3.0-or-later) — chess rules for the browser: FEN/UCI parsing, legal-move generation, the `curateLine` walk that trims puzzles to their payoff (`web/src/curate.ts`), and mate detection for the accept-any-mate drill rule (`deliversMate` via `isCheckmate`, `web/src/ui/board-logic.ts`).
- **[chessground](https://github.com/lichess-org/chessground)** (GPL-3.0-or-later) — lichess's board UI, used for the drill board. It ignores synthetic pointer events (`!e.isTrusted`), which is why UI verification drives the board with real `page.mouse` input rather than dispatched events.
- **[idb](https://github.com/jakearchibald/idb)** (ISC) — thin promise wrapper over IndexedDB. Puzzle persistence relies on the `add` (first-wins, preserves review history) vs `put` (overwrite, used by verdict healing) distinction in `web/src/db.ts`.
- **[canvas-confetti](https://github.com/catdad/canvas-confetti)** (ISC) — session-complete celebration.
- **[Montserrat](https://fontsource.org/fonts/montserrat)** via `@fontsource/montserrat` (OFL-1.1) — display typeface.
- **[Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds)** and **[Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds)** (CC0 1.0) — the drill's sound effects (`web/public/sound/`, played by `web/src/ui/sound.ts`): wooden move/capture/castle thocks and check/checkmate bells from Impact Sounds; the promotion sweep and puzzle correct/incorrect chimes from Interface Sounds. Transcoded to mono MP3 (per-file provenance in `web/public/sound/SOURCES.txt`). CC0 needs no attribution; credited here per this ledger's policy. The chess.com *sound vocabulary* (distinct self/opponent/capture/check sounds) is reimplemented with these freely-licensed samples — chess.com's own audio files are not used, and lichess's standard sounds were rejected as non-free per [lila's COPYING.md](https://github.com/lichess-org/lila/blob/master/COPYING.md).

## Conventions & prior art

- **Lichess puzzle conventions** — two behaviors are adopted from [lichess.org](https://lichess.org/training): any move that delivers immediate checkmate solves a mate puzzle even when it differs from the stored line (`web/src/ui/board-logic.ts`, `web/src/ui/screens/drill.ts`), and displayed centipawn-loss averages cap each mistake's contribution at 1000cp, the lichess accuracy-model bound (`web/src/profile.ts`, `src/chess_trainer/profile.py`).
- **Chess.com visual style** — the UI reproduces the classic chess.com light theme as its design reference, including its green/teal accent palette (`web/src/ui/styles.css`).

## Methodology

- **[docs/evaluation.md](docs/evaluation.md)** — the threshold-evaluation memo: validates the 150cp extraction cutoff, calibrates the 50cp uniqueness gap and its flag rates, and derives the curate-before-engine ordering and the dual-mate acceptance rule.
- **[analysis/evaluate_thresholds.py](analysis/evaluate_thresholds.py)** — the script that generates every number in the memo, reproducible against the local games database.

## CLI reference implementation

- **[python-chess](https://github.com/niklasf/python-chess)** (GPL-3.0+) — chess rules and UCI engine protocol for the Python pipeline (`src/chess_trainer/`).
- **[uv](https://docs.astral.sh/uv/)** (envs/deps), **[ruff](https://github.com/astral-sh/ruff)** (lint + format), **[pytest](https://pytest.org/)** (22-test suite).

## Build, test & verification tooling

- **[Vite](https://vite.dev/)** (MIT) + **[TypeScript](https://www.typescriptlang.org/)** (Apache-2.0) — build and typecheck.
- **[Vitest](https://vitest.dev/)** (MIT) + **[fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB)** (Apache-2.0) — the 237-test web suite, including IndexedDB persistence tests without a browser.
- **[Playwright](https://playwright.dev/)** — scripted real-mouse drives of the live app for UI verification (see [README](README.md#built-with-ai-verified-like-production-code)); not a repo dependency, run from the development environment.
- **[GitHub Actions](https://github.com/features/actions)** + **[gh CLI](https://cli.github.com/)** — CI on every push (both test suites, `tsc`, production build, `ruff`) and CI watching during development.
- **[Cloudflare Pages](https://pages.cloudflare.com/)** — hosting; Git-connected, auto-deploys `main`.

## License notes

This repository's own code is [MIT](LICENSE). It depends on GPL-licensed chess software — chessops and chessground (GPL-3.0-or-later), the Stockfish WASM build (GPL-3.0), and python-chess (GPL-3.0+) — which is unmodified, consumed as published packages, and credited above. The remaining dependencies are under permissive licenses (MIT, ISC, Apache-2.0, OFL-1.1).
