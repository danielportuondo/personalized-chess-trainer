import type { AppContext } from "../app";
import { el, mount } from "../dom";
import { mountStaticBoard } from "../board";

// The hero board: a real "Black hung the queen — White to play" moment. The red
// circle marks the blunder square; the green arrow is the punish. It IS the product.
const HERO_FEN = "r3k2r/ppp2ppp/2n5/3q4/8/2N5/PPPP1PPP/R3K2R w KQkq - 0 1";

export function renderLanding(ctx: AppContext): void {
  const input = el("input", {
    class: "input",
    attrs: {
      type: "text",
      placeholder: "Your Chess.com username",
      // Never surface the demo sentinel; prefill only a real saved handle.
      value: ctx.lastHandle ?? "",
      "aria-label": "Chess.com username",
    },
  });

  const errorEl = el("p", { class: "muted", text: "" });
  errorEl.style.color = "var(--danger)";

  function onAnalyze(): void {
    const handle = input.value.trim().toLowerCase();
    if (!handle) {
      errorEl.textContent = "Enter your Chess.com username to analyze your games.";
      return;
    }
    ctx.setUsername(handle);
    ctx.navigate("analyzing");
  }

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") onAnalyze();
  });

  const demoBtn = el(
    "button",
    { class: "btn btn--primary btn--lg" },
    el("span", { text: "Try the demo" }),
    el("span", { class: "btn__note", text: "8 quick puzzles · no account needed" }),
  );
  demoBtn.addEventListener("click", () => {
    demoBtn.setAttribute("disabled", "true");
    demoBtn.replaceChildren(el("span", { text: "Loading demo…" }));
    ctx.enterDemo().catch(() => {
      demoBtn.removeAttribute("disabled");
      demoBtn.replaceChildren(
        el("span", { text: "Try the demo" }),
        el("span", { class: "btn__note", text: "8 quick puzzles · no account needed" }),
      );
      errorEl.textContent = "Couldn't load the demo. Try again.";
    });
  });

  const boardEl = el("div", { class: "board" });

  const copy = el(
    "div",
    { class: "hero__copy rise" },
    el("p", { class: "eyebrow", text: "Personalized chess trainer" }),
    el("h1", { class: "title", text: "Train on the blunders from your own games." }),
    el("p", {
      class: "subtitle",
      text: "A chess engine reviews your Chess.com games, pinpoints where you went wrong, and turns those moments into a tactics workout built just for you.",
    }),
    el(
      "div",
      { class: "hero__cta" },
      demoBtn,
      el("div", { class: "hero__divider" }, el("span", { text: "or" })),
      el(
        "div",
        { class: "hero__demo" },
        el("label", { class: "stat-label", text: "Have a Chess.com account?" }),
        input,
        errorEl,
        el("button", { class: "btn btn--lg", text: "Analyze my games", onClick: onAnalyze }),
      ),
    ),
    el("p", { class: "trust", text: "Free · Runs entirely in your browser · No signup" }),
    // Returning real user shortcut (never the demo).
    ctx.lastHandle
      ? el("button", {
          class: "btn btn--ghost",
          text: `Continue as ${ctx.lastHandle} →`,
          onClick: () => {
            ctx.setUsername(ctx.lastHandle);
            ctx.navigate("profile");
          },
        })
      : null,
  );

  const boardWrap = el(
    "div",
    { class: "hero__board-wrap rise" },
    el(
      "div",
      { class: "board-frame" },
      boardEl,
      el(
        "div",
        { class: "board-caption" },
        el("span", { class: "notation", text: "Black played …Qd5?? — White to move" }),
        el(
          "span",
          { class: "eval-swing" },
          el("span", { class: "eval-chip eval-chip--bad", text: "−0.3" }),
          el("span", { class: "eval-swing__arrow", text: "→" }),
          el("span", { class: "eval-chip eval-chip--good", text: "+8.6" }),
        ),
      ),
    ),
  );

  mount(
    ctx.root,
    el(
      "div",
      { class: "app" },
      el("header", { class: "brand" }, el("span", { class: "brand__mark", text: "♞" }), el("span", { text: "Chess Trainer" })),
      el("div", { class: "screen" }, el("div", { class: "hero" }, copy, boardWrap)),
    ),
  );

  // Board must be attached before chessground measures it.
  mountStaticBoard(boardEl, {
    fen: HERO_FEN,
    orientation: "white",
    shapes: [
      { orig: "d5", brush: "red" },
      { orig: "c3", dest: "d5", brush: "green" },
    ],
  });
}
