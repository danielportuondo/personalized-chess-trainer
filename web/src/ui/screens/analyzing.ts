import type { AppContext } from "../app";
import { el, mount } from "../dom";

// Params: none — reads ctx.username directly (this screen has nothing else to key off).
export function renderAnalyzing(ctx: AppContext): void {
  const who = ctx.username ? `Crunching ${ctx.username}'s games…` : "Crunching your games…";

  mount(
    ctx.root,
    el(
      "div",
      { class: "app" },
      el(
        "div",
        { class: "screen" },
        el("h1", { class: "title", text: "Analyzing" }),
        el("p", { class: "subtitle", text: who }),
        el("div", { class: "progress" }, el("div", { class: "progress__fill" })),
        el("button", {
          class: "btn btn--ghost",
          text: "Back to profile",
          onClick: () => ctx.navigate("profile"),
        }),
      ),
    ),
  );
}
