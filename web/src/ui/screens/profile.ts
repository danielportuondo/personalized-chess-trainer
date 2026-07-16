import type { AppContext } from "../app";
import { el, mount } from "../dom";
import { getMeta, getAllPuzzles, getReviewByKey } from "../../db";
import { weaknessSummary } from "../../profile";
import { dueCandidates } from "../../review";
import { todayIso } from "../../dates";
import { countUp } from "../animate";
import type { GroupRow } from "../../types";

export interface ProfileParams {
  newGames?: number;
  newPuzzles?: number;
}

function statTile(modifier: string, icon: string, label: string): { tile: HTMLElement; value: HTMLElement } {
  const value = el("p", { class: "tile__value", text: "0" });
  const tile = el(
    "div",
    { class: `tile ${modifier}` },
    el("div", { class: "tile__icon", text: icon }),
    value,
    el("p", { class: "stat-label", text: label }),
  );
  return { tile, value };
}

// Builds a bar row and returns its fill element so the caller can animate width
// in after mount (the CSS transition only fires on a post-attach width change).
function barRow(row: GroupRow, pending: HTMLElement[]): HTMLElement {
  const fill = el("div", { class: "bar__fill" });
  fill.dataset.pct = String(row.pct);
  pending.push(fill);
  return el(
    "div",
    { class: "bar" },
    el(
      "div",
      { class: "bar__label" },
      el("span", { text: row.key }),
      el("span", { class: "bar__meta", text: `${row.n} · ${row.pct}% · avg ${row.avgCpl} cpl` }),
    ),
    el("div", { class: "bar__track" }, fill),
  );
}

function barGroup(label: string, rows: GroupRow[], pending: HTMLElement[]): HTMLElement {
  return el(
    "div",
    { class: "bar-group" },
    el("p", { class: "stat-label", text: label }),
    ...rows.map((r) => barRow(r, pending)),
  );
}

// Params: optional { newGames?, newPuzzles? } — a one-time banner after an analysis run.
export function renderProfile(ctx: AppContext, params?: unknown): void {
  if (!ctx.username) {
    ctx.navigate("landing");
    return;
  }
  const username = ctx.username;
  const displayName = ctx.displayName ?? username;
  const { newGames, newPuzzles } = (params as ProfileParams | undefined) ?? {};

  const loadingEl = el("p", { class: "muted", text: "Loading your profile…" });
  mount(ctx.root, el("div", { class: "app" }, el("div", { class: "screen" }, loadingEl)));

  Promise.all([getMeta(ctx.db, username), getAllPuzzles(ctx.db, username), getReviewByKey(ctx.db, username)])
    .then(([meta, puzzles, reviewByKey]) => {
      if (!loadingEl.isConnected) return; // navigated away while loading

      const today = todayIso();
      const summary = weaknessSummary(puzzles);
      const dueCount = dueCandidates(puzzles, reviewByKey, today).length;
      const hasFlash = Boolean(newGames || newPuzzles);
      const isEmpty = puzzles.length === 0;
      const topMotif = summary.byMotif.length
        ? summary.byMotif.reduce((a, b) => (b.n > a.n ? b : a))
        : null;

      const streak = statTile("tile--flame", "🔥", "Day streak");
      const solved = statTile("tile--xp", "⚡", "Solved");
      const best = statTile("tile--best", "🏆", "Best run");

      const startBtn = el(
        "button",
        { class: "btn btn--primary btn--lg", onClick: () => ctx.navigate("drill") },
        el("span", { text: "Start today's session" }),
        el("span", { class: "btn__note", text: `${dueCount} ${dueCount === 1 ? "puzzle" : "puzzles"} due` }),
      );
      if (dueCount === 0) startBtn.setAttribute("disabled", "true");

      const barFills: HTMLElement[] = [];

      mount(
        ctx.root,
        el(
          "div",
          { class: "app" },
          el("header", { class: "brand" }, el("span", { class: "brand__mark", text: "♞" }), el("span", { text: "Chess Trainer" })),
          el(
            "div",
            { class: "screen" },
            ctx.isDemo
              ? el(
                  "div",
                  { class: "demo-banner" },
                  el("p", { class: "demo-banner__text", text: "You're exploring the demo. Analyze your own games to get your real profile." }),
                  el("button", { class: "btn", text: "Analyze my games", onClick: () => ctx.navigate("landing") }),
                )
              : null,
            el("p", { class: "eyebrow", text: ctx.isDemo ? "Demo profile" : "Player" }),
            el("h1", { class: "title", text: displayName }),
            el("div", { class: "tiles" }, streak.tile, solved.tile, best.tile),
            hasFlash
              ? el(
                  "div",
                  { class: "insight" },
                  el("span", { class: "insight__icon", text: "✅" }),
                  el("p", {
                    class: "insight__text",
                    text: `Analyzed ${newGames ?? 0} new game(s) and found ${newPuzzles ?? 0} new puzzle(s).`,
                  }),
                )
              : null,
            isEmpty
              ? el(
                  "div",
                  { class: "card" },
                  el("p", { class: "subtitle", text: "No puzzles yet" }),
                  el("p", { class: "muted", text: "Analyze your games to build your weakness profile." }),
                  el("button", { class: "btn btn--primary btn--lg", text: "Analyze my games", onClick: () => ctx.navigate("analyzing") }),
                )
              : el(
                  "div",
                  { class: "card" },
                  topMotif
                    ? el(
                        "div",
                        { class: "insight" },
                        el("span", { class: "insight__icon", text: "🎯" }),
                        el(
                          "p",
                          { class: "insight__text" },
                          el("span", { text: "Your biggest leak: " }),
                          el("strong", { text: topMotif.key }),
                          el("span", { text: ` — ${topMotif.n} of ${summary.totalMistakes} mistakes. Drill it below.` }),
                        ),
                      )
                    : null,
                  el("p", {
                    class: "subtitle",
                    text: `${summary.totalMistakes} mistakes · avg ${summary.avgCpl} cpl`,
                  }),
                  barGroup("By mistake type", summary.byMotif, barFills),
                  barGroup("By phase", summary.byPhase, barFills),
                  barGroup("By game stage", summary.byMoveBucket, barFills),
                ),
            !isEmpty ? startBtn : null,
            !isEmpty && dueCount === 0
              ? el("p", { class: "muted", text: "Nothing due today — analyze more games or come back tomorrow." })
              : null,
            isEmpty
              ? null
              : el("button", { class: "btn btn--ghost", text: "Analyze more games", onClick: () => ctx.navigate("analyzing") }),
            el("button", { class: "btn btn--ghost", text: ctx.isDemo ? "Exit demo" : "Switch handle", onClick: () => ctx.navigate("landing") }),
          ),
        ),
      );

      // Count-up stats + animate the bars in (both no-op instantly under reduced motion).
      countUp(streak.value, { to: meta.currentStreak, durationMs: 700 });
      countUp(solved.value, { to: meta.xp, durationMs: 900 });
      countUp(best.value, { to: meta.bestRun, durationMs: 800 });
      requestAnimationFrame(() => {
        for (const fill of barFills) fill.style.width = `${fill.dataset.pct}%`;
      });
    })
    .catch(() => {
      if (!loadingEl.isConnected) return;
      mount(
        ctx.root,
        el(
          "div",
          { class: "app" },
          el(
            "div",
            { class: "screen" },
            el("h1", { class: "title", text: displayName }),
            el(
              "div",
              { class: "card" },
              el("p", { class: "subtitle", text: "Couldn't load your profile" }),
              el("p", { class: "muted", text: "Something went wrong reading your saved data." }),
            ),
            el("button", { class: "btn btn--primary btn--lg", text: "Retry", onClick: () => ctx.navigate("profile") }),
            el("button", { class: "btn btn--ghost", text: "Switch handle", onClick: () => ctx.navigate("landing") }),
          ),
        ),
      );
    });
}
