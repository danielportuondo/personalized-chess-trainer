import "@fontsource/montserrat/latin-700.css";
import "@fontsource/montserrat/latin-800.css";
import "@fontsource/montserrat/latin-900.css";
import "./styles.css";
import type { IDBPDatabase } from "idb";
import type { TrainerSchema } from "../db";
import { openTrainerDb } from "../db";
import { DEMO_DISPLAY_NAME, DEMO_USERNAME, seedDemo } from "../demo/demoFixture";
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
  username: string | null; // live identity (lowercased handle, or the demo sentinel)
  isDemo: boolean; // true while viewing the baked demo profile
  displayName: string | null; // "Demo" in demo mode, else the handle
  lastHandle: string | null; // persisted real handle (never the demo sentinel)
  navigate(screen: ScreenName, params?: unknown): void;
  setUsername(username: string | null): void; // updates state + persists to localStorage
  enterDemo(): Promise<void>; // seed + switch into the demo profile (not persisted)
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

  // `username` is the live identity (may be the demo sentinel); the persisted
  // last handle in localStorage is always a real handle, so entering the demo
  // doesn't overwrite it. Boot as the last real handle (or null).
  let username: string | null = localStorage.getItem(LAST_HANDLE_KEY);

  const ctx: AppContext = {
    db,
    root,
    get username() {
      return username;
    },
    get isDemo() {
      return username === DEMO_USERNAME;
    },
    get displayName() {
      return username === DEMO_USERNAME ? DEMO_DISPLAY_NAME : username;
    },
    get lastHandle() {
      return localStorage.getItem(LAST_HANDLE_KEY);
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
    async enterDemo() {
      await seedDemo(db);
      username = DEMO_USERNAME; // ephemeral — deliberately not persisted
      ctx.navigate("profile");
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
