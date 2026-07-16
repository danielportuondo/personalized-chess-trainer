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

  const errorEl = el("p", { class: "muted", text: "" });
  errorEl.style.color = "var(--danger)";

  function showError(message: string): void {
    errorEl.textContent = message;
  }

  function onAnalyze(): void {
    const handle = input.value.trim().toLowerCase();
    if (!handle) {
      showError("Enter your Chess.com username.");
      return;
    }
    ctx.setUsername(handle);
    ctx.navigate("analyzing");
  }

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") onAnalyze();
  });

  mount(
    ctx.root,
    el(
      "div",
      { class: "app" },
      el(
        "div",
        { class: "screen" },
        el("h1", { class: "title", text: "Chess Trainer" }),
        el("p", { class: "subtitle", text: "Train on the blunders from your own games." }),
        el(
          "div",
          { class: "card" },
          el("label", { class: "stat-label", text: "Chess.com username" }),
          input,
          errorEl,
        ),
        el("button", {
          class: "btn btn--primary btn--lg",
          text: "Analyze my games",
          onClick: onAnalyze,
        }),
        ctx.username
          ? el("button", {
              class: "btn btn--ghost",
              text: "Continue to profile →",
              onClick: () => ctx.navigate("profile"),
            })
          : null,
      ),
    ),
  );
}
