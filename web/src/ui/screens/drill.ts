import type { AppContext } from "../app";
import { el, mount } from "../dom";
import type { SummaryParams } from "./summary";

// Params: none — the real screen builds its own puzzle session from
// reviewState/puzzles rather than being handed one.
export function renderDrill(ctx: AppContext): void {
  const stubResult: SummaryParams = {
    correct: 0,
    total: 0,
    xpGained: 0,
    streakAfter: 0,
    morePending: false,
  };

  mount(
    ctx.root,
    el(
      "div",
      { class: "app" },
      el(
        "div",
        { class: "screen" },
        el("h1", { class: "title", text: "Drill" }),
        el("p", { class: "subtitle", text: "Puzzle session placeholder." }),
        el("button", {
          class: "btn btn--primary btn--lg",
          text: "Finish session",
          onClick: () => ctx.navigate("summary", stubResult),
        }),
      ),
    ),
  );
}
