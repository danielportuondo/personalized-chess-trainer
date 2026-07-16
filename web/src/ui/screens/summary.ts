import type { AppContext } from "../app";
import { el, mount } from "../dom";

export interface SummaryParams {
  correct: number;
  total: number;
  xpGained: number;
  streakAfter: number;
  morePending: boolean;
}

// Params: { correct, total, xpGained, streakAfter, morePending } from the
// drill session just finished. No params (e.g. direct navigation without a
// session) sends the user back to their profile rather than rendering a
// meaningless recap.
export function renderSummary(ctx: AppContext, params?: unknown): void {
  const result = params as SummaryParams | undefined;
  if (!result) {
    ctx.navigate("profile");
    return;
  }

  const accuracy = result.total ? Math.round((result.correct / result.total) * 100) : 0;
  const celebrate = result.total > 0 && result.correct / result.total >= 0.8;

  mount(
    ctx.root,
    el(
      "div",
      { class: "app" },
      el(
        "div",
        { class: "screen" },
        el("h1", { class: "title", text: "Session complete" }),
        el(
          "div",
          { class: "card" },
          el("p", { class: "stat-value", text: `${result.correct}/${result.total}` }),
          el("p", { class: "stat-label", text: `${accuracy}% accuracy` }),
          el(
            "div",
            { class: "stat-row" },
            el("span", { class: "badge badge--xp", text: `⚡ +${result.xpGained} XP` }),
            el("span", { class: "badge badge--flame", text: `🔥 ${result.streakAfter}` }),
          ),
          celebrate ? el("p", { class: "subtitle", text: "🎉 Great session!" }) : null,
        ),
        el("button", {
          class: "btn btn--primary btn--lg",
          text: result.morePending ? "Keep drilling" : "Back to profile",
          onClick: () => ctx.navigate(result.morePending ? "drill" : "profile"),
        }),
        result.morePending
          ? el("button", {
              class: "btn btn--ghost",
              text: "Back to profile",
              onClick: () => ctx.navigate("profile"),
            })
          : null,
      ),
    ),
  );
}
