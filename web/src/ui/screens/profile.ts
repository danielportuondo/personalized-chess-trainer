import type { AppContext } from "../app";
import { el, mount } from "../dom";

export interface ProfileParams {
  newGames?: number;
  newPuzzles?: number;
}

// Params: optional { newGames?, newPuzzles? } — shown as a one-time flash banner
// when arriving fresh from an analysis run.
export function renderProfile(ctx: AppContext, params?: unknown): void {
  const { newGames, newPuzzles } = (params as ProfileParams | undefined) ?? {};
  const hasFlash = Boolean(newGames || newPuzzles);

  mount(
    ctx.root,
    el(
      "div",
      { class: "app" },
      el(
        "div",
        { class: "screen" },
        el("h1", { class: "title", text: "Profile" }),
        hasFlash
          ? el(
              "div",
              { class: "card" },
              el("span", {
                class: "badge badge--xp",
                text: `+${newGames ?? 0} games, +${newPuzzles ?? 0} puzzles analyzed`,
              }),
            )
          : null,
        el("p", {
          class: "muted",
          text: ctx.username ? `Signed in as ${ctx.username}` : "No handle set yet",
        }),
        el("button", {
          class: "btn btn--primary btn--lg",
          text: "Start drill",
          onClick: () => ctx.navigate("drill"),
        }),
        el("button", {
          class: "btn btn--ghost",
          text: "Switch account",
          onClick: () => ctx.navigate("landing"),
        }),
      ),
    ),
  );
}
