import type { AppContext } from "../app";
import { el, mount } from "../dom";
import { analyzeAndPersist } from "../../pipeline";

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

// Params: none — reads ctx.username directly.
export function renderAnalyzing(ctx: AppContext): void {
  if (!ctx.username) {
    ctx.navigate("landing");
    return;
  }
  const username = ctx.username;

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

  analyzeAndPersist(username, ctx.db, {
    onProgress: (done, total) => {
      if (!fillEl.isConnected) return; // navigated away — don't touch detached DOM
      progressEl.classList.remove("progress--indeterminate");
      statusEl.textContent = `Running the engine · game ${done} of ${total}`;
      fillEl.style.width = `${Math.round((done / total) * 100)}%`;
    },
  })
    .then((res) => {
      clearInterval(tipTimer);
      if (!fillEl.isConnected) return; // navigated away — don't render over another screen
      ctx.navigate("profile", { newGames: res.newGames, newPuzzles: res.newPuzzles });
    })
    .catch((err) => {
      clearInterval(tipTimer);
      showError(err);
    });
}
