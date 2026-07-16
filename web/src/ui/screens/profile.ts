import type { AppContext } from "../app";
import { el, mount } from "../dom";
import { getMeta, getAllPuzzles, getReviewByKey } from "../../db";
import { weaknessSummary } from "../../profile";
import { dueCandidates } from "../../review";
import { todayIso } from "../../dates";
import type { GroupRow } from "../../types";

export interface ProfileParams {
  newGames?: number;
  newPuzzles?: number;
}

function barRow(row: GroupRow): HTMLElement {
  const fill = el("div", { class: "bar__fill" });
  fill.style.width = `${row.pct}%`;
  return el(
    "div",
    { class: "bar" },
    el(
      "div",
      { class: "bar__label" },
      el("span", { text: row.key }),
      el("span", { class: "muted", text: `${row.n} · ${row.pct}% · avg ${row.avgCpl} cpl` }),
    ),
    el("div", { class: "bar__track" }, fill),
  );
}

function barGroup(label: string, rows: GroupRow[]): HTMLElement {
  return el(
    "div",
    { class: "bar-group" },
    el("p", { class: "stat-label", text: label }),
    ...rows.map(barRow),
  );
}

// Params: optional { newGames?, newPuzzles? } — shown as a one-time flash banner
// when arriving fresh from an analysis run.
export function renderProfile(ctx: AppContext, params?: unknown): void {
  if (!ctx.username) {
    ctx.navigate("landing");
    return;
  }
  const username = ctx.username;
  const { newGames, newPuzzles } = (params as ProfileParams | undefined) ?? {};

  const loadingEl = el("p", { class: "muted", text: "Loading your profile…" });
  mount(ctx.root, el("div", { class: "app" }, el("div", { class: "screen" }, loadingEl)));

  Promise.all([getMeta(ctx.db, username), getAllPuzzles(ctx.db, username), getReviewByKey(ctx.db, username)]).then(
    ([meta, puzzles, reviewByKey]) => {
      if (!loadingEl.isConnected) return; // user navigated away while loading — don't mount over another screen

      const today = todayIso();
      const summary = weaknessSummary(puzzles);
      const due = dueCandidates(puzzles, reviewByKey, today);
      const dueCount = due.length;
      const hasFlash = Boolean(newGames || newPuzzles);
      const isEmpty = puzzles.length === 0;

      const startBtn = el(
        "button",
        { class: "btn btn--primary btn--lg", onClick: () => ctx.navigate("drill") },
        el("span", { text: "Start today's session" }),
        el("span", { class: "btn__note", text: `${dueCount} due` }),
      );
      if (dueCount === 0) startBtn.setAttribute("disabled", "true");

      mount(
        ctx.root,
        el(
          "div",
          { class: "app" },
          el(
            "div",
            { class: "screen" },
            el("h1", { class: "title", text: username }),
            el(
              "div",
              { class: "stat-row" },
              el("span", { class: "badge badge--flame", text: `🔥 ${meta.currentStreak}-day streak` }),
              el("span", { class: "badge badge--xp", text: `⚡ ${meta.xp} solved` }),
              el("span", { class: "badge", text: `🏆 best ${meta.bestStreak}` }),
            ),
            hasFlash
              ? el(
                  "div",
                  { class: "card" },
                  el("p", {
                    class: "muted",
                    text: `Analyzed ${newGames ?? 0} new game(s) · ${newPuzzles ?? 0} new puzzle(s)`,
                  }),
                )
              : null,
            isEmpty
              ? el(
                  "div",
                  { class: "card" },
                  el("p", {
                    class: "muted",
                    text: "No puzzles yet — analyze your games to build your weakness profile.",
                  }),
                  el("button", {
                    class: "btn btn--primary btn--lg",
                    text: "Analyze my games",
                    onClick: () => ctx.navigate("analyzing"),
                  }),
                )
              : el(
                  "div",
                  { class: "card" },
                  el("p", {
                    class: "subtitle",
                    text: `${summary.totalMistakes} mistakes · avg ${summary.avgCpl} cpl`,
                  }),
                  barGroup("By phase", summary.byPhase),
                  barGroup("By mistake type", summary.byMotif),
                  barGroup("By game stage", summary.byMoveBucket),
                ),
            !isEmpty ? startBtn : null,
            !isEmpty && dueCount === 0
              ? el("p", {
                  class: "muted",
                  text: "Nothing due today — analyze more games or come back tomorrow.",
                })
              : null,
            // Empty state stops here (header + empty card only) — its own
            // "Analyze my games" button is the sole CTA until puzzles exist.
            isEmpty
              ? null
              : el("button", {
                  class: "btn btn--ghost",
                  text: "Analyze more games",
                  onClick: () => ctx.navigate("analyzing"),
                }),
            // Always available — including the empty state — so a handle with no
            // puzzles isn't a dead-end (re-analyzing the same handle would loop).
            el("button", {
              class: "btn btn--ghost",
              text: "Switch handle",
              onClick: () => ctx.navigate("landing"),
            }),
          ),
        ),
      );
    },
  ).catch(() => {
    if (!loadingEl.isConnected) return; // user navigated away while loading
    mount(
      ctx.root,
      el(
        "div",
        { class: "app" },
        el(
          "div",
          { class: "screen" },
          el("h1", { class: "title", text: username }),
          el(
            "div",
            { class: "card" },
            el("p", { class: "subtitle", text: "Couldn't load your profile" }),
            el("p", { class: "muted", text: "Something went wrong reading your saved data." }),
          ),
          el("button", {
            class: "btn btn--primary btn--lg",
            text: "Retry",
            onClick: () => ctx.navigate("profile"),
          }),
          el("button", {
            class: "btn btn--ghost",
            text: "Switch handle",
            onClick: () => ctx.navigate("landing"),
          }),
        ),
      ),
    );
  });
}
