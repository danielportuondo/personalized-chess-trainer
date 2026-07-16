import type { AppContext } from "../app";
import { el, mount } from "../dom";
import { mountPuzzleBoard, drawBestMove, lockBoard } from "../board";
import { turnColorOf, moveToUci } from "../board-logic";
import { celebratePop, elementOrigin } from "../celebrate";
import { getAllPuzzles, getReviewByKey, getMeta, recordResult, recordProgress } from "../../db";
import { weaknessSummary, REASON } from "../../profile";
import { dueCandidates, selectDuePuzzles } from "../../review";
import { todayIso } from "../../dates";
import type { Api } from "chessground/api";
import type { SummaryParams } from "./summary";

type Outcome = "correct" | "miss" | "skip" | undefined;

function renderLoadError(ctx: AppContext, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  mount(
    ctx.root,
    el(
      "div",
      { class: "app" },
      el(
        "div",
        { class: "screen" },
        el("h1", { class: "title", text: "Drill" }),
        el(
          "div",
          { class: "card" },
          el("p", { class: "subtitle", text: "Something went wrong" }),
          el("p", { class: "muted", text: message }),
        ),
        el("button", { class: "btn btn--ghost", text: "Back to profile", onClick: () => ctx.navigate("profile") }),
      ),
    ),
  );
}

// Params: none — builds its own session from puzzles/reviewState/meta (mirrors
// profile.ts's self-loading pattern) rather than being handed one by the caller.
export function renderDrill(ctx: AppContext): void {
  if (!ctx.username) {
    ctx.navigate("landing");
    return;
  }
  const user = ctx.username;
  const db = ctx.db;

  const loadingEl = el("p", { class: "muted", text: "Loading your session…" });
  mount(ctx.root, el("div", { class: "app" }, el("div", { class: "screen" }, loadingEl)));

  Promise.all([getAllPuzzles(db, user), getReviewByKey(db, user), getMeta(db, user)])
    .then(([puzzles, reviewByKey, meta]) => {
      if (!loadingEl.isConnected) return; // navigated away while loading

      const today = todayIso();
      const summary = weaknessSummary(puzzles);
      const dueCount = dueCandidates(puzzles, reviewByKey, today).length;
      const session = selectDuePuzzles(puzzles, reviewByKey, summary, today, 15);
      const morePending = dueCount > session.length;

      if (session.length === 0) {
        ctx.navigate("profile");
        return;
      }

      // All session state lives in these locals so a fresh renderDrill() call —
      // e.g. "Keep drilling" from the summary — always starts clean.
      let idx = 0;
      let correct = 0;
      let attempted = 0;
      let latestMeta = meta;
      const outcomes: Outcome[] = new Array(session.length).fill(undefined);

      function renderDots(currentIdx: number): HTMLElement {
        return el(
          "div",
          { class: "dots" },
          ...session.map((_, i) => {
            const o = outcomes[i];
            let cls = "dot";
            if (o === "correct") cls += " dot--correct";
            else if (o === "miss") cls += " dot--miss";
            else if (i === currentIdx) cls += " dot--current";
            return el("div", { class: cls });
          }),
        );
      }

      function renderPuzzle(i: number): void {
        const pz = session[i];
        const color = turnColorOf(pz.fen);
        let answered = false;
        let api: Api;

        const boardEl = el("div", { class: "board" });
        const scoreEl = el("p", { class: "muted notation", text: `✓ ${correct} / ${attempted}` });
        const streakEl = el("span", { class: "badge badge--flame", text: `🔥 ${latestMeta.currentStreak}` });
        const feedbackEl = el("div", { class: "drill__feedback" });
        let dotsEl = renderDots(i);

        function advance(): void {
          idx = i + 1;
          if (idx >= session.length) {
            const result: SummaryParams = {
              correct,
              total: attempted,
              xpGained: correct,
              streakAfter: latestMeta.currentStreak,
              morePending,
            };
            ctx.navigate("summary", result);
          } else {
            // Advances come from Next/Skip/timeout callbacks with no error
            // boundary — a bad FEN (near-impossible post-pipeline) would deadlock
            // the board, so guard it.
            try {
              renderPuzzle(idx);
            } catch (err) {
              renderLoadError(ctx, err);
            }
          }
        }

        const skipBtn = el("button", {
          class: "btn btn--ghost",
          text: "Skip",
          onClick: () => {
            if (answered) return;
            outcomes[i] = "skip";
            advance();
          },
        });
        const quitBtn = el("button", { class: "btn btn--ghost", text: "Quit", onClick: () => ctx.navigate("profile") });

        async function onMove(orig: string, dest: string): Promise<void> {
          if (answered) return;
          answered = true;

          // Solve rule matches the Python reference (train.py:157): only the
          // first move of the solution line counts.
          const passed = moveToUci(pz.fen, orig, dest) === pz.solutionLineUci.split(" ")[0];
          lockBoard(api);
          boardEl.classList.add(passed ? "flash-correct" : "flash-miss");

          attempted++;
          if (passed) correct++;
          outcomes[i] = passed ? "correct" : "miss";
          scoreEl.textContent = `✓ ${correct} / ${attempted}`;
          const refreshed = renderDots(i); // reflect this answer on the current dot immediately
          dotsEl.replaceWith(refreshed);
          dotsEl = refreshed;

          try {
            await recordResult(db, user, pz.dedupeKey, passed, today);
            latestMeta = await recordProgress(db, user, passed, today);
          } catch (err) {
            // Recording failure shouldn't crash the session.
            console.error("Failed to record puzzle result", err);
          }

          if (!boardEl.isConnected) return; // navigated away (e.g. Quit) mid-persist

          streakEl.textContent = `🔥 ${latestMeta.currentStreak}`;

          if (passed) {
            celebratePop(elementOrigin(boardEl).x, elementOrigin(boardEl).y);
            feedbackEl.replaceChildren(
              el("p", { class: "drill__feedback-text drill__feedback-text--correct pop", text: "✓ Correct!" }),
            );
            setTimeout(() => {
              if (!boardEl.isConnected) return; // navigated away during the auto-advance delay
              advance();
            }, 900);
          } else {
            drawBestMove(api, pz.bestMoveUci.slice(0, 2), pz.bestMoveUci.slice(2, 4));
            const reason = pz.motif ? REASON[pz.motif] : REASON.other;
            feedbackEl.replaceChildren(
              el("p", { class: "drill__feedback-text drill__feedback-text--miss", text: "✗ Not quite." }),
              el("p", { class: "muted" }, el("span", { text: "Best move: " }), el("span", { class: "notation", text: pz.bestMoveUci })),
              el("p", { class: "muted", text: reason }),
              el("button", { class: "btn btn--primary", text: "Next", onClick: () => advance() }),
            );
          }
        }

        const screen = el(
          "div",
          { class: "app" },
          el(
            "div",
            { class: "screen drill" },
            el("div", { class: "drill__board" }, boardEl),
            el(
              "div",
              { class: "drill__info card" },
              el("p", { class: "stat-label", text: `Puzzle ${i + 1} of ${session.length}` }),
              dotsEl,
              el(
                "div",
                { class: "turn-flag" },
                el("span", { class: `turn-flag__dot turn-flag__dot--${color}` }),
                el("span", { text: `${color === "white" ? "White" : "Black"} to move` }),
              ),
              el("div", { class: "stat-row" }, scoreEl, streakEl),
              feedbackEl,
              el("div", { class: "stat-row" }, skipBtn, quitBtn),
            ),
          ),
        );

        // Mount into the live DOM FIRST — chessground measures the wrap element's
        // rendered size at construction time, so it must already be attached.
        mount(ctx.root, screen);
        api = mountPuzzleBoard(boardEl, { fen: pz.fen, onMove });
      }

      renderPuzzle(0);
    })
    .catch((err) => {
      if (!loadingEl.isConnected) return; // navigated away while loading
      renderLoadError(ctx, err);
    });
}
