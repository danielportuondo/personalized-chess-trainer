import type { AppContext } from "../app";
import { el, mount } from "../dom";
import { countUp } from "../animate";
import { celebrateBurst } from "../celebrate";

export interface SummaryParams {
  correct: number;
  total: number;
  xpGained: number;
  bestRun: number;
  morePending: boolean;
}

// Params: { correct, total, xpGained, bestRun, morePending } from the drill
// session just finished. No params (direct navigation) sends the user back to
// their profile rather than rendering a meaningless recap.
export function renderSummary(ctx: AppContext, params?: unknown): void {
  const result = params as SummaryParams | undefined;
  if (!result) {
    ctx.navigate("profile");
    return;
  }

  const accuracy = result.total ? Math.round((result.correct / result.total) * 100) : 0;
  const celebrate = result.total > 0 && result.correct / result.total >= 0.8;
  const dialColor = accuracy >= 80 ? "var(--accent)" : accuracy >= 50 ? "var(--xp)" : "var(--danger)";

  const pctEl = el("p", { class: "dial__pct", text: "0%" });
  const dial = el(
    "div",
    { class: "dial" },
    el("div", { class: "dial__inner" }, pctEl, el("p", { class: "dial__label", text: "accuracy" })),
  );
  dial.style.setProperty("--dial-color", dialColor);

  const nextBtns: Array<HTMLElement | null> = ctx.isDemo
    ? [
        el("button", { class: "btn btn--primary btn--lg", text: "Analyze my games", onClick: () => ctx.navigate("landing") }),
        result.morePending
          ? el("button", { class: "btn btn--ghost", text: "Keep drilling", onClick: () => ctx.navigate("drill") })
          : null,
        el("button", { class: "btn btn--ghost", text: "Back to demo profile", onClick: () => ctx.navigate("profile") }),
      ]
    : [
        el("button", {
          class: "btn btn--primary btn--lg",
          text: result.morePending ? "Keep drilling" : "Back to profile",
          onClick: () => ctx.navigate(result.morePending ? "drill" : "profile"),
        }),
        result.morePending
          ? el("button", { class: "btn btn--ghost", text: "Back to profile", onClick: () => ctx.navigate("profile") })
          : null,
      ];

  mount(
    ctx.root,
    el(
      "div",
      { class: "app" },
      el(
        "div",
        { class: "screen" },
        el("p", { class: "eyebrow", text: "Session complete" }),
        el("h1", { class: "title", text: celebrate ? "Great session! 🎉" : "Nice work" }),
        el(
          "div",
          { class: "card summary-card" },
          dial,
          el("p", { class: "subtitle", text: `${result.correct} of ${result.total} solved` }),
          el(
            "div",
            { class: "stat-row" },
            el("span", { class: "badge badge--xp", text: `⚡ +${result.xpGained} XP` }),
            el("span", { class: "badge badge--flame", text: `🔥 ${result.bestRun}` }),
          ),
        ),
        ...nextBtns,
      ),
    ),
  );

  // Animate the dial + percentage in (both no-op instantly under reduced motion).
  requestAnimationFrame(() => dial.style.setProperty("--pct", String(accuracy)));
  countUp(pctEl, { to: accuracy, durationMs: 900, format: (n) => `${n}%` });

  if (celebrate) celebrateBurst();
}
