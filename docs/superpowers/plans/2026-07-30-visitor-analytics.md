# Visitor Analytics (Umami Cloud) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Umami Cloud analytics into the web app: one script tag, a guarded `track()` wrapper, and five custom events (analyze/demo-start/analysis-complete/analysis-error/puzzle-result) so Daniel can see visits, analyzed usernames, the funnel, and error rates in the Umami dashboard.

**Architecture:** The Umami tracker script loads from `cloud.umami.is` via a `defer` tag in `web/index.html`; `data-domains` restricts it to the production hostname so dev/tests/previews send nothing. App code never touches `window.umami` directly — a tiny wrapper (`web/src/ui/analytics.ts`) no-ops when the tracker is absent or throws, so analytics can never break the app. Five call sites in existing screens fire the events.

**Tech Stack:** Vanilla TypeScript SPA, Vite, vitest (node env), Umami Cloud (free tier). Spec: `docs/superpowers/specs/2026-07-30-visitor-analytics-design.md`.

## Global Constraints

- **No new npm dependencies** — the only addition is the external script tag.
- **Website ID (copy verbatim):** `10fe7bb2-5436-474e-a877-15db8eac04a1`; **domain:** `personalized-chess-trainer.pages.dev`.
- **Commits are gated:** Daniel runs commits or gives explicit per-batch OK (CLAUDE.md hard rule). Commit steps below are written out but MUST NOT run without that OK — pause and ask.
- **No privacy-copy changes** to `web/index.html` footer (explicit spec decision).
- Test env is vitest `environment: "node"` — no `window`, no DOM. All commands run from `web/`.
- Event names/properties exactly as specified: `analyze {username}`, `demo-start`, `analysis-complete {username, puzzles}`, `analysis-error {username, stage, message}`, `puzzle-result {correct}`.

---

### Task 1: `track()` wrapper

**Files:**
- Create: `web/src/ui/analytics.ts`
- Test: `web/tests/analytics.test.ts` (new)

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `track(event: string, data?: Record<string, string | number | boolean>): void` — imported by Tasks 3–5 as `import { track } from "../analytics";` (from `web/src/ui/screens/*`).

- [ ] **Step 1: Write the failing tests**

Create `web/tests/analytics.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { track } from "../src/ui/analytics";

// The Umami script defines window.umami in browsers; window === globalThis
// there, so the wrapper reads globalThis.umami — stubbable in node.
type G = typeof globalThis & {
  umami?: { track: (event: string, data?: Record<string, string | number | boolean>) => void };
};

afterEach(() => {
  delete (globalThis as G).umami;
});

describe("track", () => {
  it("no-ops without a umami global (node, dev, ad-blocked)", () => {
    expect(() => track("analyze", { username: "magnuscarlsen" })).not.toThrow();
  });

  it("forwards event name and data to umami.track", () => {
    const spy = vi.fn();
    (globalThis as G).umami = { track: spy };
    track("analyze", { username: "magnuscarlsen" });
    expect(spy).toHaveBeenCalledWith("analyze", { username: "magnuscarlsen" });
  });

  it("forwards a data-less event", () => {
    const spy = vi.fn();
    (globalThis as G).umami = { track: spy };
    track("demo-start");
    expect(spy).toHaveBeenCalledWith("demo-start", undefined);
  });

  it("swallows a throwing tracker", () => {
    (globalThis as G).umami = {
      track: () => {
        throw new Error("boom");
      },
    };
    expect(() => track("analyze")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/daniel.portuondo/repos/personalized-chess-trainer/web && npx vitest run tests/analytics.test.ts`
Expected: FAIL — cannot resolve `../src/ui/analytics`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/ui/analytics.ts`:

```ts
// Umami custom-event tracking. The tracker script (index.html) only runs on
// the production domain (data-domains), so in dev, vitest, and for ad-blocked
// visitors window.umami never exists and every call here is a silent no-op.
type EventData = Record<string, string | number | boolean>;

interface Umami {
  track: (event: string, data?: EventData) => void;
}

export function track(event: string, data?: EventData): void {
  const umami = (globalThis as { umami?: Umami }).umami;
  if (!umami) return;
  try {
    umami.track(event, data);
  } catch {
    // Analytics must never break the app.
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/analytics.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit (gated — see Global Constraints)**

```bash
git add web/src/ui/analytics.ts web/tests/analytics.test.ts
git commit -m "feat: guarded track() wrapper for Umami events"
```

---

### Task 2: `analysisErrorProps()` classifier

**Files:**
- Modify: `web/src/ui/analytics.ts` (append)
- Test: `web/tests/analytics.test.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `analysisErrorProps(err: unknown): { stage: string; message: string }` — used by Task 4 in the pipeline catch. `stage` ∈ `"not-found" | "chesscom-api" | "other"`; `message` truncated to 100 chars, `"unknown"` for message-less values.

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/analytics.test.ts` (add `analysisErrorProps` to the existing import from `../src/ui/analytics`):

```ts
describe("analysisErrorProps", () => {
  it("classifies unknown-user errors as not-found", () => {
    expect(analysisErrorProps(new Error("Chess.com user not found: xyzzy"))).toEqual({
      stage: "not-found",
      message: "Chess.com user not found: xyzzy",
    });
  });

  it("classifies chess.com API failures", () => {
    expect(analysisErrorProps(new Error("Chess.com API error 503 fetching archives for x")).stage).toBe(
      "chesscom-api",
    );
    expect(analysisErrorProps(new Error("Repeated 429s fetching https://api.chess.com/x")).stage).toBe(
      "chesscom-api",
    );
  });

  it("falls back to other and truncates the message to 100 chars", () => {
    const props = analysisErrorProps(new Error("x".repeat(150)));
    expect(props.stage).toBe("other");
    expect(props.message).toHaveLength(100);
  });

  it("handles non-Error values", () => {
    expect(analysisErrorProps(undefined)).toEqual({ stage: "other", message: "unknown" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/analytics.test.ts`
Expected: FAIL — `analysisErrorProps` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `web/src/ui/analytics.ts`:

```ts
// Shapes an analysis-pipeline failure into analysis-error event properties.
// The stages mirror the known error messages thrown in src/chesscom.ts;
// anything else (engine, IndexedDB, bugs) lands in "other".
export function analysisErrorProps(err: unknown): { stage: string; message: string } {
  const message = (err as { message?: string } | undefined)?.message ?? "unknown";
  const stage = message.includes("user not found")
    ? "not-found"
    : message.includes("Chess.com API error") || message.includes("Repeated 429s")
      ? "chesscom-api"
      : "other";
  return { stage, message: message.slice(0, 100) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/analytics.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit (gated)**

```bash
git add web/src/ui/analytics.ts web/tests/analytics.test.ts
git commit -m "feat: classify analysis errors into Umami event properties"
```

---

### Task 3: Script tag + landing events (`analyze`, `demo-start`)

**Files:**
- Modify: `web/index.html` (head, after `<title>`)
- Modify: `web/src/ui/screens/landing.ts:24-33` (onAnalyze) and `:45-48` (demo click)

**Interfaces:**
- Consumes: `track` from Task 1.
- Produces: nothing consumed later; events `analyze {username}` and `demo-start` live.

No unit tests: screen wiring in this repo is Playwright-verified (precedent), covered by Task 6. Type-check + full suite guard regressions.

- [ ] **Step 1: Add the tracker script tag**

In `web/index.html`, insert after the `<title>` line (line 32), inside `<head>`:

```html
    <script
      defer
      src="https://cloud.umami.is/script.js"
      data-website-id="10fe7bb2-5436-474e-a877-15db8eac04a1"
      data-domains="personalized-chess-trainer.pages.dev"
    ></script>
```

Do NOT touch the footer copy.

- [ ] **Step 2: Fire `analyze` and `demo-start` in landing.ts**

Add the import (after the existing imports at `web/src/ui/screens/landing.ts:3`):

```ts
import { track } from "../analytics";
```

In `onAnalyze()` (landing.ts:24-33), fire after validation, before navigating — typing alone must send nothing:

```ts
  function onAnalyze(): void {
    const handle = input.value.trim().toLowerCase();
    if (!handle) {
      errorEl.textContent = "Enter your Chess.com username to analyze your games.";
      return;
    }
    track("analyze", { username: handle });
    // Not persisted yet — analyzing.ts saves the handle only after the
    // analysis proves it real, so a typo never becomes a ghost profile.
    ctx.navigate("analyzing", { handle });
  }
```

In the demo click listener (landing.ts:45), fire first:

```ts
  demoBtn.addEventListener("click", () => {
    track("demo-start");
    demoBtn.setAttribute("disabled", "true");
```

- [ ] **Step 3: Type-check and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 type errors; all tests pass (324 existing + 8 new).

- [ ] **Step 4: Commit (gated)**

```bash
git add web/index.html web/src/ui/screens/landing.ts
git commit -m "feat: Umami script tag + analyze/demo-start events"
```

---

### Task 4: Analyzing-screen events (`analysis-complete`, `analysis-error`)

**Files:**
- Modify: `web/src/ui/screens/analyzing.ts:115-141`

**Interfaces:**
- Consumes: `track`, `analysisErrorProps` from Tasks 1–2; `res.newPuzzles: number` from the existing `analyzeAndPersist` result.
- Produces: events `analysis-complete {username, puzzles}` and `analysis-error {username, stage, message}` live.

- [ ] **Step 1: Fire the two events**

Add the import (after existing imports at `web/src/ui/screens/analyzing.ts:4`):

```ts
import { track, analysisErrorProps } from "../analytics";
```

In the `.then` (analyzing.ts:123-125), fire immediately after `clearInterval` and BEFORE the `isConnected` guard — the analysis completed even if the visitor navigated away:

```ts
    .then(async (res) => {
      clearInterval(tipTimer);
      track("analysis-complete", { username, puzzles: res.newPuzzles });
      if (!fillEl.isConnected) return; // navigated away — don't render over another screen
```

(Note: the zero-new-games path still fires with `puzzles: 0` — per spec, the event means "pipeline finished", and a 0 count is itself signal.)

In the `.catch` (analyzing.ts:138-141):

```ts
    .catch((err) => {
      clearInterval(tipTimer);
      track("analysis-error", { username, ...analysisErrorProps(err) });
      showError(err);
    });
```

- [ ] **Step 2: Type-check and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 0 type errors; all tests pass.

- [ ] **Step 3: Commit (gated)**

```bash
git add web/src/ui/screens/analyzing.ts
git commit -m "feat: analysis-complete/analysis-error events"
```

---

### Task 5: Drill event (`puzzle-result`)

**Files:**
- Modify: `web/src/ui/screens/drill.ts:324-333` (`finalize`)

**Interfaces:**
- Consumes: `track` from Task 1.
- Produces: event `puzzle-result {correct}` live.

- [ ] **Step 1: Fire `puzzle-result` on scored attempts**

Add the import (with the other `../` imports near `web/src/ui/screens/drill.ts:18`):

```ts
import { track } from "../analytics";
```

In `finalize()` (drill.ts:324), fire AFTER the `practice` early-return so no-stakes reruns don't count — same semantics as `recordResult`:

```ts
        async function finalize(passed: boolean): Promise<void> {
          resolved = true;
          refreshHintBtn();
          if (practice) return; // no-stakes rerun: the original miss already scored
          track("puzzle-result", { correct: passed });
          attempted++;
```

(Demo drills also pass through here — expected: raw `puzzle-result` counts mix demo and real per spec; the ordered funnel is unaffected.)

- [ ] **Step 2: Type-check, full suite, production build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: 0 type errors; all tests pass; build succeeds.

- [ ] **Step 3: Commit (gated)**

```bash
git add web/src/ui/screens/drill.ts
git commit -m "feat: puzzle-result drill event"
```

---

### Task 6: Ship + live verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: all prior tasks deployed; Umami dashboard access (Daniel).

- [ ] **Step 1: Push (gated on Daniel's OK) and wait for CI + Pages deploy**

```bash
git push origin main
gh run watch --exit-status   # or: gh run list --limit 1, then gh run view <id>
```

Expected: CI green. Then poll https://personalized-chess-trainer.pages.dev until the new JS bundle hash appears (deploys land ~90s after CI in past sessions).

- [ ] **Step 2: Verify the tracker loads and the pageview fires**

Using the Playwright MCP browser: navigate to https://personalized-chess-trainer.pages.dev, then check `browser_network_requests` for:
- `GET https://cloud.umami.is/script.js` → 200
- `POST https://gateway.umami.is/api/send` → 200 (the auto pageview; the
  script itself still loads from cloud.umami.is — only the send endpoint
  is on the gateway host)

If both requests are absent, check for a content blocker in the test browser before debugging code.

- [ ] **Step 3: Verify custom events at the network level**

Still on pages.dev:
- Click "Try the demo" → a new `POST /api/send` fires (demo-start); solve or fail one demo puzzle → another POST (puzzle-result).
- Go back to landing (reload), type a real handle (e.g. `MagnusCarlsen` via the GM chip) and click "Analyze my games" → POST fires (analyze) before the analyzing screen takes over. Letting the full analysis run to completion (analysis-complete) is optional here — it takes minutes; Daniel's next real use covers it.

Expected: one `POST https://gateway.umami.is/api/send` → 200 per interaction.

- [ ] **Step 4: Daniel eyeballs the dashboard**

Ask Daniel to open the Umami dashboard and confirm: pageviews registering, and the events from Step 3 visible with the `username` property on `analyze`. (Agent has no dashboard login — this half of verification is his.)

- [ ] **Step 5: Update memory files**

Update `chess-trainer-backlog.md` (new SHIPPED section) and the `MEMORY.md` index line per the standing pattern.
