import type { AppContext } from "../app";
import { el, mount } from "../dom";
import { analyzeAndPersist } from "../../pipeline";
import { getAllPuzzles } from "../../db";
import { track, analysisErrorProps } from "../analytics";

// Shown on rotation during the wait so the (real, engine-bound) analysis feels
// like a coaching moment rather than a spinner.
const TIPS: string[] = [
  "Before every move, ask what your opponent's last move threatened.",
  "Scan for checks, captures, and threats — in that order.",
  "If you spot a good move, look for a better one.",
  "Castle early. King safety wins more games than clever attacks.",
  "When ahead in material, trade pieces. When behind, keep them on.",
  "A knight on the rim is dim — bring knights toward the center.",
];

export interface AnalyzingParams {
  handle?: string;
}

// Params: optional { handle } from the landing form. Falls back to ctx.username
// for re-analyze entry points (profile buttons), where the handle is already
// proven and persisted.
export function renderAnalyzing(ctx: AppContext, params?: unknown): void {
  const { handle } = (params as AnalyzingParams | undefined) ?? {};
  const username = handle ?? ctx.username;
  if (!username) {
    ctx.navigate("landing");
    return;
  }
  // Fired here (not landing.ts) so profile re-analyze entry points — which
  // navigate straight to "analyzing" without going through landing — are
  // covered too.
  track("analyze", { username });

  const statusEl = el("p", { class: "subtitle", text: `Fetching ${username}'s recent games…` });
  const fillEl = el("div", { class: "progress__fill" });
  const progressEl = el("div", { class: "progress progress--indeterminate" }, fillEl);
  const tipEl = el("p", { class: "tip" }, el("strong", { text: "Tip · " }), el("span", { text: TIPS[0] }));

  mount(
    ctx.root,
    el(
      "div",
      { class: "app" },
      el("header", { class: "brand" }, el("span", { class: "brand__mark", text: "♞" }), el("span", { text: "Chess Trainer" })),
      el(
        "div",
        { class: "screen" },
        el("p", { class: "eyebrow", text: "Working" }),
        el("h1", { class: "title", text: "Analyzing your games" }),
        statusEl,
        progressEl,
        el("div", { class: "card" }, tipEl),
      ),
    ),
  );

  let tipIdx = 0;
  const tipTimer = setInterval(() => {
    if (!fillEl.isConnected) {
      clearInterval(tipTimer);
      return;
    }
    tipIdx = (tipIdx + 1) % TIPS.length;
    tipEl.replaceChildren(el("strong", { text: "Tip · " }), el("span", { text: TIPS[tipIdx] }));
  }, 3800);

  function showError(err: unknown): void {
    if (!fillEl.isConnected) return; // already navigated away
    const message = (err as { message?: string } | undefined)?.message ?? "Something went wrong.";
    mount(
      ctx.root,
      el(
        "div",
        { class: "app" },
        el(
          "div",
          { class: "screen" },
          el("h1", { class: "title", text: "Couldn't analyze those games" }),
          el(
            "div",
            { class: "card" },
            el("p", { class: "subtitle", text: "Something went wrong" }),
            el("p", { class: "muted", text: message }),
          ),
          el("button", { class: "btn btn--primary btn--lg", text: "Try another handle", onClick: () => ctx.navigate("landing") }),
        ),
      ),
    );
  }

  function showNoGames(): void {
    if (!fillEl.isConnected) return; // already navigated away
    mount(
      ctx.root,
      el(
        "div",
        { class: "app" },
        el(
          "div",
          { class: "screen" },
          el("h1", { class: "title", text: "No recent games found" }),
          el(
            "div",
            { class: "card" },
            el("p", { class: "subtitle", text: `${username} exists on Chess.com, but has no recent games to analyze.` }),
            el("p", {
              class: "muted",
              text: "Finish a few games there (any time control except bullet), then come back — the trainer builds puzzles from your own mistakes.",
            }),
          ),
          el("button", { class: "btn btn--primary btn--lg", text: "Try another handle", onClick: () => ctx.navigate("landing") }),
        ),
      ),
    );
  }

  analyzeAndPersist(username, ctx.db, {
    onProgress: (done, total) => {
      if (!fillEl.isConnected) return; // navigated away — don't touch detached DOM
      progressEl.classList.remove("progress--indeterminate");
      statusEl.textContent = `Running the engine · game ${done} of ${total}`;
      fillEl.style.width = `${Math.round((done / total) * 100)}%`;
    },
  })
    .then(async (res) => {
      clearInterval(tipTimer);
      track("analysis-complete", { username, puzzles: res.newPuzzles });
      if (!fillEl.isConnected) return; // navigated away — don't render over another screen
      if (res.newGames === 0 && res.newPuzzles === 0) {
        const existing = await getAllPuzzles(ctx.db, username);
        if (existing.length === 0) {
          showNoGames(); // real user, nothing to train on — don't persist an empty profile
          return;
        }
      }
      // Only now is the handle known-good: persisting earlier turns a failed
      // or empty lookup into a "Continue as …" ghost on the landing screen.
      ctx.setUsername(username);
      ctx.navigate("profile", { newGames: res.newGames, newPuzzles: res.newPuzzles });
    })
    .catch((err) => {
      clearInterval(tipTimer);
      track("analysis-error", { username, ...analysisErrorProps(err) });
      showError(err);
    });
}
