import type { AppContext } from "../app";
import { el, mount } from "../dom";

// Params: none. Reads/writes ctx.username via the handle input below.
export function renderLanding(ctx: AppContext): void {
  const input = el("input", {
    class: "input",
    attrs: {
      type: "text",
      placeholder: "Chess.com username",
      value: ctx.username ?? "",
    },
  });

  function goToProfile(): void {
    const value = input.value.trim().toLowerCase();
    ctx.setUsername(value.length > 0 ? value : null);
    ctx.navigate("profile");
  }

  mount(
    ctx.root,
    el(
      "div",
      { class: "app" },
      el(
        "div",
        { class: "screen" },
        el("h1", { class: "title", text: "Chess Trainer" }),
        el("p", { class: "subtitle", text: "Train on your own blunders." }),
        el("div", { class: "card" }, input),
        el("button", {
          class: "btn btn--primary btn--lg",
          text: "Continue",
          onClick: goToProfile,
        }),
      ),
    ),
  );
}
