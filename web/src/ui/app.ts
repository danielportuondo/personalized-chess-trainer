import "./styles.css";
import type { IDBPDatabase } from "idb";
import type { TrainerSchema } from "../db";
import { openTrainerDb } from "../db";
import { el, clear, mount } from "./dom";
import { renderLanding } from "./screens/landing";
import { renderAnalyzing } from "./screens/analyzing";
import { renderProfile } from "./screens/profile";
import { renderDrill } from "./screens/drill";
import { renderSummary } from "./screens/summary";

export type ScreenName = "landing" | "analyzing" | "profile" | "drill" | "summary";

export interface AppContext {
  db: IDBPDatabase<TrainerSchema>;
  root: HTMLElement; // the #app element; screens render into this
  username: string | null; // current handle (lowercased); null until entered
  navigate(screen: ScreenName, params?: unknown): void;
  setUsername(username: string | null): void; // updates state + persists to localStorage
}

export type ScreenRenderer = (ctx: AppContext, params?: unknown) => void;

const LAST_HANDLE_KEY = "chess-trainer:lastHandle";

const screens: Record<ScreenName, ScreenRenderer> = {
  landing: renderLanding,
  analyzing: renderAnalyzing,
  profile: renderProfile,
  drill: renderDrill,
  summary: renderSummary,
};

export async function bootApp(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return; // index.html always has #app; nothing sane to do without it

  let db: IDBPDatabase<TrainerSchema>;
  try {
    db = await openTrainerDb();
  } catch (err) {
    renderFatalError(root, "Failed to open the local database", err);
    return;
  }

  // Closure variable (not a snapshot) so `ctx.username` stays live across
  // navigations even though screens hold on to the same `ctx` object.
  let username: string | null = localStorage.getItem(LAST_HANDLE_KEY);

  const ctx: AppContext = {
    db,
    root,
    get username() {
      return username;
    },
    navigate(screen, params) {
      clear(root);
      try {
        screens[screen](ctx, params);
      } catch (err) {
        renderFatalError(root, `Screen "${screen}" failed to render`, err);
      }
    },
    setUsername(next) {
      username = next;
      if (next !== null) {
        localStorage.setItem(LAST_HANDLE_KEY, next);
      } else {
        localStorage.removeItem(LAST_HANDLE_KEY);
      }
    },
  };

  ctx.navigate("landing");
}

function renderFatalError(root: HTMLElement, headline: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  mount(
    root,
    el(
      "div",
      { class: "app" },
      el(
        "div",
        { class: "screen" },
        el("h1", { class: "title", text: "Something went wrong" }),
        el("div", { class: "card" }, el("p", { class: "subtitle", text: headline }), el("p", { class: "muted", text: message })),
      ),
    ),
  );
}
