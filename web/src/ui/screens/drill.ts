import type { AppContext } from "../app";
import { el, mount } from "../dom";
import {
  mountPuzzleBoard,
  lockBoard,
  playOpponentReply,
  armForMove,
  showFrame,
  snapTo,
  markWrongMove,
  hintSquare,
  clearShapes,
  autoplayFrames,
} from "../board";
import { turnColorOf, moveToUci, planSolutionLine, buildReviewFrames, uciToSan, deliversMate, isPromotionVariant, applyUci } from "../board-logic";
import type { UserMoveStep } from "../board-logic";
import { celebratePop, elementOrigin } from "../celebrate";
import { isSoundEnabled, playSound, setSoundEnabled, soundForMove } from "../sound";
import { getAllPuzzles, getReviewByKey, recordResult, recordProgress } from "../../db";
import { refuteWrongMove } from "../refute";
import { weaknessSummary, REASON, HINT } from "../../profile";
import { dueCandidates, selectDuePuzzles } from "../../review";
import { gameUrlAtPly } from "../../chesscom";
import { curatePuzzle, difficultyScore, isDrillable } from "../../curate";
import { todayIso, timeAgo, monthYear } from "../../dates";
import type { Provenance } from "../../types";
import type { Api } from "chessground/api";
import type { SummaryParams } from "./summary";

type Outcome = "correct" | "miss" | "skip" | undefined;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Pre-solve line — neutral by design: the game's result stays out until the
// review, so a rough session doesn't rub in the losses mid-puzzle.
function provenanceLine(prov: Provenance, today: string): string {
  const parts = [`From your game vs ${prov.opponent}`];
  if (prov.timeClass) parts.push(capitalize(prov.timeClass));
  if (prov.endTime != null) parts.push(timeAgo(prov.endTime, today));
  return parts.join(" · ");
}

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

  Promise.all([getAllPuzzles(db, user), getReviewByKey(db, user)])
    .then(([puzzles, reviewByKey]) => {
      if (!loadingEl.isConnected) return; // navigated away while loading

      const today = todayIso();
      const summary = weaknessSummary(puzzles);
      const dueCount = dueCandidates(puzzles, reviewByKey, today).filter(isDrillable).length;
      const session = selectDuePuzzles(puzzles, reviewByKey, summary, today, 15, isDrillable);
      // Warm-up ordering: short forcing lines first, deep quiet ones last.
      session.sort(
        (a, b) => difficultyScore(curatePuzzle(a)!, a) - difficultyScore(curatePuzzle(b)!, b),
      );
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
      let run = 0; // consecutive correct solves this session (the live 🔥)
      let bestRunThisSession = 0; // peak run reached, reported on the summary
      let hintsLeft = 3;
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

      // practice: a no-stakes rerun after a scored miss — finalize() skips all
      // scoring/persistence, so nothing here can double-count the puzzle.
      function renderPuzzle(i: number, practice = false): void {
        const pz = session[i];
        const color = turnColorOf(pz.fen);
        // The puzzle plays out its curated solution line — trimmed to end the moment
        // the payoff (mate or banked material) is on the board: user move → scripted
        // opponent reply → next user move. moves[m].fenBefore is the position facing
        // the user at each step; the opponent's reply lands on moves[m+1].fenBefore.
        // Sessions are pre-filtered by isDrillable, so the un-curated fallback only
        // guards hand-authored data.
        const curated = curatePuzzle(pz);
        const plan = curated
          ? planSolutionLine(pz.fen, curated.lineUci, curated.userMoves)
          : planSolutionLine(pz.fen, pz.solutionLineUci);
        // Fallback keeps a puzzle scorable if the stored line's first token is unparseable
        // (near-impossible post-pipeline): degrade to a single-move puzzle.
        const moves: UserMoveStep[] = plan.moves.length
          ? plan.moves
          : [{ fenBefore: pz.fen, expectedUci: pz.solutionLineUci.trim().split(/\s+/)[0] ?? pz.bestMoveUci }];
        let m = 0; // index of the user move currently expected
        let resolved = false; // puzzle finished (solved or missed)
        let busy = false; // a move is being processed / the opponent is replying
        let hintUsed = false;
        let api: Api;
        // Post-solve review: the flattened ply-by-ply positions, plus the live keydown
        // handler (present only while reviewing; torn down on advance/quit). Reassigned
        // when an off-line mate ends the puzzle early (see onMove's altMate).
        let frames = buildReviewFrames(moves);
        let keyHandler: ((e: KeyboardEvent) => void) | null = null;

        // Sounds a frame's own move when review/autoplay lands on it. Frame
        // parity: odd indices are the solver's moves, even (>0) the opponent's
        // replies; the Start frame has no san and stays silent.
        function playFrameSound(idx: number): void {
          const san = frames[idx].san;
          if (san) playSound(soundForMove(san, idx % 2 === 1 ? "self" : "opponent"));
        }

        const boardEl = el("div", { class: "board" });
        const scoreEl = el("p", { class: "muted notation", text: `✓ ${correct} / ${attempted}` });
        const streakEl = el("span", { class: "badge badge--flame", text: `🔥 ${run}` });
        const feedbackEl = el("div", { class: "drill__feedback" });
        const reviewEl = el("div", { class: "drill__review" });
        const turnFlagEl = el(
          "div",
          { class: "turn-flag" },
          el("span", { class: `turn-flag__dot turn-flag__dot--${color}` }),
          el("span", { text: `${color === "white" ? "White" : "Black"} to move` }),
        );
        const hintTextEl = el("div", { class: "drill__hint" });
        const provenanceEl = el("p", {
          class: "drill__provenance",
          text: pz.provenance ? provenanceLine(pz.provenance, todayIso()) : "",
        });
        const practiceNoteEl = el("p", { class: "drill__practice-note", text: practice ? "Practice — not scored" : "" });
        const moveIndicatorEl = el("p", { class: "drill__move-indicator" });
        function updateMoveIndicator(): void {
          moveIndicatorEl.textContent = moves.length > 1 ? `Move ${m + 1} of ${moves.length}` : "";
        }
        updateMoveIndicator();
        const hintBtn = el("button", {
          class: "btn btn--ghost btn--hint",
          onClick: () => {
            // busy: the board is mid-transition (intro replay / opponent reply),
            // and any fen set wipes shapes — a circle drawn now would vanish.
            if (resolved || busy || hintUsed || hintsLeft <= 0) return;
            hintUsed = true;
            hintsLeft--;
            hintTextEl.replaceChildren(
              el("p", { class: "drill__hint-text pop", text: HINT[pz.motif ?? "other"] }),
            );
            // Circle the piece to move (moves[m]: mid-line hints point at the
            // current step). The copy names the theme; the circle names the piece;
            // the destination stays the player's job.
            hintSquare(api, moves[m].expectedUci.slice(0, 2));
            refreshHintBtn();
          },
        });
        // Reflects the shared session budget plus this puzzle's own used/answered
        // state; called on mount, after each hint, and once a move is played.
        function refreshHintBtn(): void {
          const exhausted = hintsLeft <= 0;
          hintBtn.disabled = resolved || hintUsed || exhausted;
          hintBtn.textContent = hintUsed
            ? "💡 Hint shown"
            : exhausted
              ? "💡 No hints left"
              : `💡 Hint · ${hintsLeft} left`;
        }
        refreshHintBtn();
        let dotsEl = renderDots(i);

        // Removes the review keydown handler so a stale one never lingers past this puzzle.
        function cleanup(): void {
          if (keyHandler) {
            window.removeEventListener("keydown", keyHandler);
            keyHandler = null;
          }
        }

        function advance(): void {
          cleanup();
          idx = i + 1;
          if (idx >= session.length) {
            const result: SummaryParams = {
              correct,
              total: attempted,
              xpGained: correct,
              bestRun: bestRunThisSession,
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

        // No-stakes rerun of this puzzle — reachable from the miss choice and
        // from the review's "Try again". The miss is already scored; the rerun
        // can't touch it (finalize early-returns in practice mode).
        function retry(): void {
          cleanup();
          try {
            renderPuzzle(i, true);
          } catch (err) {
            renderLoadError(ctx, err);
          }
        }

        // Skipping breaks the run. Guard it with a one-tap-to-arm confirm so a
        // run is never lost by accident — but only when there's a run to lose.
        let skipArmed = false;
        const skipBtn = el("button", {
          class: "btn btn--ghost",
          text: "Skip",
          onClick: () => {
            if (resolved) return;
            // A practice run was already scored as a miss — skipping it must not
            // overwrite outcomes[i] or touch the (already reset) run.
            if (practice) {
              advance();
              return;
            }
            if (run > 0 && !skipArmed) {
              skipArmed = true;
              skipBtn.classList.add("btn--warn");
              skipBtn.textContent = `⚠️ Resets 🔥 ${run} — tap to confirm`;
              return;
            }
            outcomes[i] = "skip";
            run = 0;
            advance();
          },
        });
        const quitBtn = el("button", {
          class: "btn btn--ghost",
          text: "Quit",
          onClick: () => {
            cleanup();
            ctx.navigate("profile");
          },
        });

        // Persistent mute toggle (localStorage-backed; sound.ts gates playback,
        // this button only reflects/flips the pref). Stateful-button idiom like
        // skipBtn — the repo has no checkbox component.
        const soundBtn = el("button", {
          class: "btn btn--ghost",
          onClick: () => {
            setSoundEnabled(!isSoundEnabled());
            refreshSoundBtn();
          },
        });
        function refreshSoundBtn(): void {
          const on = isSoundEnabled();
          soundBtn.textContent = on ? "🔊 Sound" : "🔇 Muted";
          soundBtn.setAttribute("aria-pressed", String(on));
          soundBtn.setAttribute("aria-label", on ? "Mute sounds" : "Unmute sounds");
        }
        refreshSoundBtn();

        // Re-triggers a one-shot flash by clearing both flash classes and forcing a reflow
        // before re-adding — so a mid-line correct move flashes green every time.
        function flashBoard(kind: "correct" | "miss"): void {
          boardEl.classList.remove("flash-correct", "flash-miss");
          void boardEl.offsetWidth;
          boardEl.classList.add(`flash-${kind}`);
        }

        // Terminal scoring — runs once per puzzle when it's solved or missed. Records the
        // single attempt (multi-move puzzles score as one unit) and updates score/streak/dots.
        async function finalize(passed: boolean): Promise<void> {
          resolved = true;
          refreshHintBtn();
          if (practice) return; // no-stakes rerun: the original miss already scored
          attempted++;
          if (passed) correct++;
          run = passed ? run + 1 : 0;
          bestRunThisSession = Math.max(bestRunThisSession, run);
          outcomes[i] = passed ? "correct" : "miss";
          scoreEl.textContent = `✓ ${correct} / ${attempted}`;
          const refreshed = renderDots(i); // reflect this answer on the current dot immediately
          dotsEl.replaceWith(refreshed);
          dotsEl = refreshed;

          try {
            await recordResult(db, user, pz.dedupeKey, passed, today);
            await recordProgress(db, user, passed, today, run);
          } catch (err) {
            // Recording failure shouldn't crash the session.
            console.error("Failed to record puzzle result", err);
          }

          if (!boardEl.isConnected) return; // navigated away (e.g. Quit) mid-persist

          streakEl.textContent = `🔥 ${run}`;
          if (passed) {
            // Restart the pop bounce on the existing badge (no-op under reduced motion).
            streakEl.classList.remove("pop");
            requestAnimationFrame(() => {
              if (streakEl.isConnected) streakEl.classList.add("pop");
            });
          }
        }

        function solved(): void {
          // Confetti stays reserved for scored solves — a practice win gets the
          // green flash + pop text only. The chime is answer feedback (like the
          // flash), so it plays in practice too.
          if (!practice) celebratePop(elementOrigin(boardEl).x, elementOrigin(boardEl).y);
          playSound("puzzle-correct");
          feedbackEl.replaceChildren(
            el("p", {
              class: "drill__feedback-text drill__feedback-text--correct pop",
              text: practice ? "✓ Got it!" : "✓ Correct!",
            }),
          );
          // The board already sits on the final position — review from there.
          enterReview(frames.length - 1, false);
        }

        // The motif reason describes the puzzle's opening idea, so it only holds for a
        // first-move miss; deeper in the line, name it as the continuation.
        function missReasonText(): string {
          return m === 0
            ? pz.motif
              ? REASON[pz.motif]
              : REASON.other
            : "That wasn't the winning continuation.";
        }

        // Chess.com-style miss: the wrong move stays on the board under a ✗ badge,
        // the solution stays hidden, and the player chooses — rerun the puzzle,
        // watch the line play out, or ask the engine why their move fails. The
        // miss is already scored by the time we're here.
        function enterMissChoice(step: UserMoveStep, wrongUci: string): void {
          turnFlagEl.style.display = "none"; // same chrome-teardown as enterReview
          moveIndicatorEl.textContent = "";
          provenanceEl.textContent = "";
          skipBtn.hidden = true;

          markWrongMove(api, wrongUci.slice(2, 4));
          feedbackEl.replaceChildren(
            el("p", { class: "drill__feedback-text drill__feedback-text--miss", text: "✗ Incorrect" }),
          );

          const retryBtn = el("button", {
            class: "btn btn--ghost drill__review-retry",
            text: "↻ Retry",
            onClick: retry,
          });
          const solutionBtn = el("button", {
            class: "btn btn--primary drill__review-next",
            text: "View solution",
            onClick: () => {
              // Autoplay from the position they faced — the first frame slides the
              // wrong piece back (and showFrame clears the ✗) — then hand off to
              // the arrow-key review at the payoff. frames[2*m] === step.fenBefore.
              reviewEl.replaceChildren();
              autoplayFrames(
                api,
                frames,
                2 * m,
                () => boardEl.isConnected,
                () => enterReview(frames.length - 1, true),
                playFrameSound,
              );
            },
          });
          // Opt-in engine refutation: the reply to the user's ACTUAL move — it
          // explains the miss without revealing the puzzle's own solution, so
          // it's safe to show before a retry. One shot per miss.
          const whyBtn = el("button", {
            class: "btn btn--ghost",
            text: "Why?",
            onClick: async () => {
              retryBtn.disabled = true;
              solutionBtn.disabled = true;
              whyBtn.disabled = true;
              const progress = el(
                "div",
                { class: "progress progress--indeterminate drill__why-progress" },
                el("div", { class: "progress__fill" }),
              );
              const note = el("p", { class: "muted", text: "Asking the engine…" });
              feedbackEl.append(progress, note);
              try {
                const ref = await refuteWrongMove(step.fenBefore, wrongUci);
                if (!boardEl.isConnected) return;
                progress.remove();
                note.remove();
                playOpponentReply(api, ref.fenAfterReply, ref.replyUci); // ✗ badge persists
                playSound(soundForMove(uciToSan(ref.fenAfterWrong, ref.replyUci), "opponent"));
                feedbackEl.append(el("p", { class: "muted", text: ref.line }));
                setTimeout(() => {
                  if (!boardEl.isConnected) return;
                  // Back to the choice position — reusing playOpponentReply also
                  // restores the wrong move's own square highlight. Chessground
                  // clears shapes on every fen set, so the ✗ needs re-drawing.
                  playOpponentReply(api, ref.fenAfterWrong, wrongUci);
                  markWrongMove(api, wrongUci.slice(2, 4));
                  retryBtn.disabled = false;
                  solutionBtn.disabled = false; // Why? stays consumed; its line stays up
                }, 1600);
              } catch {
                if (!boardEl.isConnected) return;
                progress.remove();
                note.remove();
                feedbackEl.append(el("p", { class: "muted", text: missReasonText() }));
                retryBtn.disabled = false;
                solutionBtn.disabled = false;
              }
            },
          });
          reviewEl.replaceChildren(
            el("div", { class: "drill__review-actions" }, retryBtn, solutionBtn, whyBtn),
          );
        }

        // The full where-this-came-from story — review-only by design (the result
        // is a spoiler the pre-solve line deliberately withholds). Legacy rows
        // without provenance degrade to the bare game link; demo rows (fake
        // demo:// urls) render nothing.
        function reviewStory(): HTMLElement | null {
          const link =
            !ctx.isDemo && pz.sourceGameUrl.startsWith("https://")
              ? el("a", {
                  class: "drill__review-link",
                  text: "View game on Chess.com →",
                  attrs: {
                    // Deep-link to the puzzle position (the ply *before* the
                    // played move) so the viewer mirrors the drill board.
                    href: gameUrlAtPly(pz.sourceGameUrl, pz.sourcePly),
                    target: "_blank",
                    rel: "noopener noreferrer",
                  },
                })
              : null;
          const prov = pz.provenance;
          if (!prov) return link ? el("div", { class: "drill__review-story" }, link) : null;

          const moveNo = Math.floor(pz.sourcePly / 2) + 1;
          const gameNoun = prov.timeClass ? `${capitalize(prov.timeClass)} game` : "game";
          const context = [`Move ${moveNo} of your ${gameNoun} vs ${prov.opponent}`]
            .concat(prov.endTime != null ? [monthYear(prov.endTime)] : [])
            .join(" · ");
          const played = `You played ${uciToSan(pz.fen, pz.playedMoveUci)} here`;
          const story =
            prov.result === "loss"
              ? `${played} and went on to lose.`
              : prov.result === "win"
                ? `${played} — and got away with it.`
                : prov.result === "draw"
                  ? `${played} and the game ended in a draw.`
                  : `${played}.`;
          return el(
            "div",
            { class: "drill__review-story" },
            el("p", { class: "drill__review-context", text: context }),
            el("p", { class: "drill__review-played", text: story }),
            link,
          );
        }

        // Shared post-solve/-miss state: the board is locked and the line can be walked
        // ply by ply with ←/→ (and on-screen ‹/›); Enter or the primary button continues.
        // canRetry (miss only): offers a no-stakes practice rerun of the same puzzle.
        function enterReview(startIdx: number, canRetry: boolean): void {
          turnFlagEl.style.display = "none"; // per-frame side differs from the puzzle's starting side (.turn-flag sets display, so [hidden] won't take)
          moveIndicatorEl.textContent = ""; // superseded by the review caption
          provenanceEl.textContent = ""; // superseded by the review story
          skipBtn.hidden = true; // meaningless once resolved

          let frameIdx = startIdx;
          const caption = el("p", { class: "drill__review-caption notation" });
          const prevBtn = el("button", {
            class: "btn btn--ghost drill__review-step",
            text: "‹",
            attrs: { "aria-label": "Previous move" },
            onClick: () => stepTo(frameIdx - 1),
          });
          const nextBtn = el("button", {
            class: "btn btn--ghost drill__review-step",
            text: "›",
            attrs: { "aria-label": "Next move" },
            onClick: () => stepTo(frameIdx + 1),
          });

          // sound=false on the review-entry render: the board already sits on
          // that frame (and the solve chime / autoplay just sounded it).
          function stepTo(next: number, sound = true): void {
            if (next < 0 || next >= frames.length) return; // clamp at both ends
            frameIdx = next;
            const f = frames[frameIdx];
            showFrame(api, f.fen, f.lastMove);
            if (sound) playFrameSound(frameIdx);
            caption.textContent = `${frameIdx + 1} / ${frames.length} · ${f.label}`;
            prevBtn.disabled = frameIdx === 0;
            nextBtn.disabled = frameIdx === frames.length - 1;
          }

          const continueBtn = el("button", {
            class: "btn btn--primary drill__review-next",
            text: i === session.length - 1 ? "See results" : "Next puzzle",
            onClick: () => advance(),
          });

          const story = reviewStory();
          reviewEl.replaceChildren(
            ...(story ? [story] : []),
            el("div", { class: "drill__review-nav" }, prevBtn, caption, nextBtn),
            el(
              "div",
              { class: "drill__review-actions" },
              ...(canRetry ? [el("button", { class: "btn btn--ghost drill__review-retry", text: "↻ Try again", onClick: retry })] : []),
              continueBtn,
            ),
          );

          keyHandler = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              stepTo(frameIdx - 1);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              stepTo(frameIdx + 1);
            } else if (e.key === "Enter") {
              e.preventDefault();
              advance();
            } else if ((e.key === "r" || e.key === "R") && canRetry) {
              e.preventDefault();
              retry();
            }
          };
          window.addEventListener("keydown", keyHandler);

          stepTo(startIdx, false);
        }

        async function onMove(orig: string, dest: string): Promise<void> {
          if (resolved || busy) return;
          busy = true;
          clearShapes(api); // a hint circle must not outlive the move it hinted
          const step = moves[m];
          const playedUci = moveToUci(step.fenBefore, orig, dest);
          const playedSan = uciToSan(step.fenBefore, playedUci);
          // An off-line move that mates on the spot still solves the puzzle
          // (lichess convention) — and ends it, checkmate leaves no reply.
          const altMate = playedUci !== step.expectedUci && deliversMate(step.fenBefore, playedUci);
          // Same promotion, different piece (the board can only auto-queen): counts as
          // solved, and ends the puzzle — the board has diverged from the scripted line.
          const promoVariant =
            playedUci !== step.expectedUci && isPromotionVariant(playedUci, step.expectedUci);
          const passed = playedUci === step.expectedUci || altMate || promoVariant;
          const isFinal = m === moves.length - 1 || altMate || promoVariant;

          if (!passed) {
            lockBoard(api);
            flashBoard("miss");
            // Only the incorrect thunk, no move sound (chess.com puzzles do the
            // same) — and before finalize's IDB awaits so it lands with the flash.
            playSound("puzzle-incorrect");
            await finalize(false);
            if (!boardEl.isConnected) return;
            enterMissChoice(step, playedUci);
            return;
          }

          if (isFinal) {
            if (altMate || promoVariant) {
              // Review shows the move the user actually played, not the stored
              // PV's divergent tail. frames[2m] is the position they faced.
              frames = [
                ...frames.slice(0, 2 * m + 1),
                {
                  fen: applyUci(step.fenBefore, playedUci),
                  lastMove: [orig, dest] as [string, string],
                  label: `${turnColorOf(step.fenBefore) === "white" ? "White" : "Black"}: ${playedSan}`,
                  san: playedSan,
                },
              ];
            }
            lockBoard(api);
            flashBoard("correct");
            playSound(soundForMove(playedSan, "self"));
            await finalize(true);
            if (!boardEl.isConnected) return;
            solved();
            return;
          }

          // Correct but not the last move: brief green flash, then the opponent's scripted
          // reply animates in and the board re-arms for the next user move. No celebration
          // yet — the confetti is reserved for completing the whole line.
          const reply = step.reply!;
          lockBoard(api);
          flashBoard("correct");
          playSound(soundForMove(playedSan, "self"));
          setTimeout(() => {
            if (!boardEl.isConnected) return;
            playOpponentReply(api, reply.fenAfter, reply.uci);
            playFrameSound(2 * m + 2); // the reply's frame — even index, opponent
            m++;
            updateMoveIndicator();
            setTimeout(() => {
              if (!boardEl.isConnected) return;
              armForMove(api, moves[m].fenBefore);
              busy = false;
            }, 260);
          }, 450);
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
              turnFlagEl,
              provenanceEl,
              practiceNoteEl,
              moveIndicatorEl,
              el("div", { class: "drill__hint-row" }, hintBtn),
              hintTextEl,
              el("div", { class: "stat-row" }, scoreEl, streakEl),
              feedbackEl,
              reviewEl,
              el("div", { class: "stat-row" }, skipBtn, quitBtn, soundBtn),
            ),
          ),
        );

        // Mount into the live DOM FIRST — chessground measures the wrap element's
        // rendered size at construction time, so it must already be attached.
        mount(ctx.root, screen);
        api = mountPuzzleBoard(boardEl, { fen: pz.fen, onMove });

        // Replay the opponent's move that created this position (the chess.com/
        // lichess intro convention): rewind instantly, animate the move in, then
        // arm input. Mounting stays on pz.fen — orientation and movable side
        // derive from it. Locked + busy so a drag can't race the replay; timers
        // re-check the mount exactly like onMove's reply chain. Practice reruns
        // replay it too — the intro is part of the puzzle's presentation.
        if (pz.intro) {
          const intro = pz.intro;
          busy = true;
          lockBoard(api);
          snapTo(api, intro.fenBefore);
          setTimeout(() => {
            if (!boardEl.isConnected) return;
            playOpponentReply(api, pz.fen, intro.uci);
            playSound(soundForMove(uciToSan(intro.fenBefore, intro.uci), "opponent"));
            setTimeout(() => {
              if (!boardEl.isConnected) return;
              armForMove(api, pz.fen);
              busy = false;
            }, 260);
          }, 450);
        }
      }

      renderPuzzle(0);
    })
    .catch((err) => {
      if (!loadingEl.isConnected) return; // navigated away while loading
      renderLoadError(ctx, err);
    });
}
