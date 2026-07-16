import type { AppContext } from "../app";
import { el, mount } from "../dom";
import { mountPuzzleBoard, drawBestMove, lockBoard } from "../board";
import { turnColorOf, moveToUci } from "../board-logic";
import { getAllPuzzles, getReviewByKey, getMeta, recordResult, recordProgress } from "../../db";
import { weaknessSummary, REASON } from "../../profile";
import { dueCandidates, selectDuePuzzles } from "../../review";
import { todayIso } from "../../dates";
import type { Api } from "chessground/api";
import type { SummaryParams } from "./summary";

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
        el("button", {
          class: "btn btn--ghost",
          text: "Back to profile",
          onClick: () => ctx.navigate("profile"),
        }),
      ),
    ),
  );
}

// Params: none — this screen builds its own puzzle session from
// puzzles/reviewState/meta (mirrors profile.ts's self-loading pattern) rather
// than being handed one by the caller.
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
      if (!loadingEl.isConnected) return; // user navigated away while loading

      const today = todayIso();
      const summary = weaknessSummary(puzzles);
      const dueCount = dueCandidates(puzzles, reviewByKey, today).length;
      const session = selectDuePuzzles(puzzles, reviewByKey, summary, today, 15);
      const morePending = dueCount > session.length;

      if (session.length === 0) {
        ctx.navigate("profile");
        return;
      }

      // All session state lives in these locals (not module scope) so a fresh
      // renderDrill() call — e.g. "Keep drilling" from the summary screen —
      // always starts a clean session.
      let idx = 0;
      let correct = 0;
      let attempted = 0;
      let latestMeta = meta; // falls back to the loaded meta until a result is recorded

      function renderPuzzle(i: number): void {
        const pz = session[i];
        const color = turnColorOf(pz.fen);
        let answered = false;
        let api: Api;

        const boardEl = el("div", { class: "board" });
        const scoreEl = el("p", { class: "muted", text: `✓ ${correct}/${attempted}` });
        const streakEl = el("span", { class: "badge badge--flame", text: `🔥 ${latestMeta.currentStreak}` });
        const feedbackEl = el("div", { class: "drill__feedback" });

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
            renderPuzzle(idx);
          }
        }

        const skipBtn = el("button", {
          class: "btn btn--ghost",
          text: "Skip",
          onClick: () => advance(), // no recording — correct/attempted untouched
        });
        const quitBtn = el("button", {
          class: "btn btn--ghost",
          text: "Quit",
          onClick: () => ctx.navigate("profile"),
        });

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
          scoreEl.textContent = `✓ ${correct}/${attempted}`;

          try {
            await recordResult(db, user, pz.dedupeKey, passed, today);
            latestMeta = await recordProgress(db, user, passed, today);
          } catch (err) {
            // Recording failure shouldn't crash the session — the puzzle was
            // still answered and the user should keep drilling.
            console.error("Failed to record puzzle result", err);
          }

          if (!boardEl.isConnected) return; // navigated away (e.g. Quit) mid-persist

          streakEl.textContent = `🔥 ${latestMeta.currentStreak}`;

          if (passed) {
            feedbackEl.replaceChildren(
              el("p", { class: "drill__feedback-text drill__feedback-text--correct", text: "✓ Correct!" }),
            );
            setTimeout(() => {
              if (!boardEl.isConnected) return; // navigated away during the auto-advance delay
              advance();
            }, 900);
          } else {
            drawBestMove(api, pz.bestMoveUci.slice(0, 2), pz.bestMoveUci.slice(2, 4));
            const reason = pz.motif ? REASON[pz.motif] : "a stronger move was available";
            feedbackEl.replaceChildren(
              el("p", { class: "drill__feedback-text drill__feedback-text--miss", text: "✗ Not quite." }),
              el("p", { class: "muted", text: `Best move: ${pz.bestMoveUci}` }),
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
              el("p", { class: "stat-label", text: `Puzzle ${i + 1} / ${session.length}` }),
              el("p", { class: "subtitle", text: `${color === "white" ? "White" : "Black"} to move` }),
              el("div", { class: "stat-row" }, scoreEl, streakEl),
              feedbackEl,
              el("div", { class: "stat-row" }, skipBtn, quitBtn),
            ),
          ),
        );

        // Mount into the live DOM FIRST — chessground measures the wrap
        // element's rendered size at construction time, so it must already
        // be attached before mountPuzzleBoard runs.
        mount(ctx.root, screen);
        api = mountPuzzleBoard(boardEl, { fen: pz.fen, onMove });
      }

      renderPuzzle(0);
    })
    .catch((err) => {
      if (!loadingEl.isConnected) return; // user navigated away while loading
      renderLoadError(ctx, err);
    });
}
