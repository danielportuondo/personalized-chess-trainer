import type { AppContext } from "../app";
import { el, mount } from "../dom";

export interface SummaryParams {
  correct: number;
  total: number;
  xpGained: number;
  streakAfter: number;
  morePending: boolean;
}

// Params: { correct, total, xpGained, streakAfter, morePending } from the drill
// session just finished. Missing/undefined params render a bare placeholder.
export function renderSummary(ctx: AppContext, params?: unknown): void {
  const result = params as SummaryParams | undefined;

  mount(
    ctx.root,
    el(
      "div",
      { class: "app" },
      el(
        "div",
        { class: "screen" },
        el("h1", { class: "title", text: "Summary" }),
        result
          ? el(
              "div",
              { class: "card" },
              el("p", { class: "stat-value", text: `${result.correct}/${result.total}` }),
              el("p", { class: "stat-label", text: "correct" }),
              el("span", { class: "badge badge--xp", text: `+${result.xpGained} XP` }),
              el("span", { class: "badge badge--flame", text: `Streak ${result.streakAfter}` }),
            )
          : el("p", { class: "muted", text: "No session data yet." }),
        el("button", {
          class: "btn btn--primary btn--lg",
          text: result?.morePending ? "Keep drilling" : "Back to profile",
          onClick: () => ctx.navigate(result?.morePending ? "drill" : "profile"),
        }),
      ),
    ),
  );
}
