import type { AppContext } from "../app";
import { el, mount } from "../dom";
import { analyzeAndPersist } from "../../pipeline";

// Params: none — reads ctx.username directly (this screen has nothing else to key off).
export function renderAnalyzing(ctx: AppContext): void {
  if (!ctx.username) {
    ctx.navigate("landing");
    return;
  }
  const username = ctx.username;

  const statusEl = el("p", { class: "subtitle", text: `Fetching ${username}'s recent games…` });
  const fillEl = el("div", { class: "progress__fill" });
  const progressEl = el("div", { class: "progress progress--indeterminate" }, fillEl);

  mount(
    ctx.root,
    el(
      "div",
      { class: "app" },
      el(
        "div",
        { class: "screen" },
        el("h1", { class: "title", text: "Analyzing" }),
        statusEl,
        progressEl,
      ),
    ),
  );

  function showError(err: unknown): void {
    if (!fillEl.isConnected) return; // user already navigated away — don't render over another screen
    const message = (err as { message?: string } | undefined)?.message ?? "Something went wrong.";
    mount(
      ctx.root,
      el(
        "div",
        { class: "app" },
        el(
          "div",
          { class: "screen" },
          el("h1", { class: "title", text: "Analyzing" }),
          el(
            "div",
            { class: "card" },
            el("p", { class: "subtitle", text: "Something went wrong" }),
            el("p", { class: "muted", text: message }),
          ),
          el("button", {
            class: "btn btn--ghost",
            text: "Try another handle",
            onClick: () => ctx.navigate("landing"),
          }),
        ),
      ),
    );
  }

  analyzeAndPersist(username, ctx.db, {
    onProgress: (done, total) => {
      if (!fillEl.isConnected) return; // screen navigated away — bail, don't touch detached DOM
      progressEl.classList.remove("progress--indeterminate");
      statusEl.textContent = `Analyzing game ${done}/${total}`;
      fillEl.style.width = `${Math.round((done / total) * 100)}%`;
    },
  })
    .then((res) => {
      if (!fillEl.isConnected) return; // screen navigated away — don't navigate over another screen
      ctx.navigate("profile", { newGames: res.newGames, newPuzzles: res.newPuzzles });
    })
    .catch((err) => {
      showError(err);
    });
}
