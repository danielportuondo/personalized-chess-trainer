# Visitor Analytics — Design

**Date:** 2026-07-30
**Status:** Approved by Daniel (brainstorm 2026-07-30)

## Goal

See who uses https://personalized-chess-trainer.pages.dev and how far they get.
Core must-have: see which chess.com usernames visitors analyze. Also wanted:
reach (visits, referrers, countries), the engagement funnel, analysis error
rates, and a citable visitor number for portfolio use.

## Decisions

- **Tool: Umami Cloud, Hobby (free) tier.** Cookie-less, no consent banner,
  ~2KB script, custom events with properties, funnel + retention reports on
  the free tier. Limits: 100k events/month (ample — see volume estimate),
  6-month data retention (screenshot the dashboard occasionally if a lifetime
  number matters).
- **Rejected:** PostHog (heavier SDK, ad-block magnet needing a proxy,
  overkill for one linear funnel); DIY on Cloudflare Analytics Engine (no
  hosted dashboard, which Daniel wants).
- **No privacy-copy change.** Footer stays as-is (Daniel's explicit call;
  the disclosure option was offered and declined).
- **No new npm dependencies.** Integration is one external script tag plus
  first-party wrapper code.

## Prerequisite (Daniel, once) — DONE 2026-07-30

Umami Cloud account created; `personalized-chess-trainer.pages.dev` added as
a website. Website ID: `10fe7bb2-5436-474e-a877-15db8eac04a1` (public by
design — it ships in the page HTML, so committing it is fine).

## Architecture

- **Script tag** in `web/index.html` `<head>`:
  `<script defer src="https://cloud.umami.is/script.js"
  data-website-id="10fe7bb2-5436-474e-a877-15db8eac04a1"
  data-domains="personalized-chess-trainer.pages.dev"></script>`.
  `data-domains` makes localhost, previews, and CI no-ops — no environment
  logic in app code.
- **Wrapper** `web/src/ui/analytics.ts`:
  `track(event: string, data?: Record<string, string | number | boolean>): void`.
  Guards on `window.umami` existing and wraps the call in try/catch — when the
  script is blocked, absent (dev/tests), or throws, every call is a silent
  no-op. Analytics can never break the app.
- The app has no URL routing (screens swap in place), so Umami auto-tracks
  only the initial pageview. Screen progress is captured via the custom
  events below; no synthetic pageviews.

## Event taxonomy

| Event | Properties | Fires when |
|---|---|---|
| `analyze` | `username` | Analyze submitted with a real handle |
| `demo-start` | — | one-click demo button clicked |
| `analysis-complete` | `username`, `puzzles` (count extracted) | analysis pipeline finishes |
| `analysis-error` | `username`, `stage`, `message` (truncated to 100 chars) | pipeline catch paths; `stage` names the pipeline step, enumerated at implementation from existing catch paths (e.g. fetch / review / extract) |
| `puzzle-result` | `correct` (boolean) | each drill attempt |

Notes:

- Usernames are captured only on Analyze submit — typing alone sends nothing.
- The demo path fires `demo-start` but not `analyze`/`analysis-complete`
  (it loads prebuilt puzzles without running the pipeline). Demo drills do
  emit `puzzle-result`, so raw drill counts mix demo and real usage; the
  ordered funnel (visit → analyze → analysis-complete → puzzle-result) is
  unaffected because demo visitors never pass the `analyze` step.
- Volume estimate: 1,000 visitors/month × ~50 puzzles each ≈ 55k events,
  under the 100k cap. Actual traffic is far lower.
- Deliberately out of scope (YAGNI): sound-toggle events, per-screen
  synthetic pageviews, global `window.onerror` reporting, first-party proxy
  for the Umami script (phase 2 only if the dashboard looks suspiciously
  quiet), Sentry.

## Testing, rollout, verification

- **TDD the wrapper** (vitest): `window.umami` absent → no-op without
  throwing; present → forwards event name + data; throwing → swallowed.
  Node 22 test env has no `window.umami`; stub it like the sound module does.
- **Call sites:** screen logic in this repo is Playwright-verified, not
  unit-tested — precedent followed.
- **Live verification:** after deploy, click through demo + a real analyze on
  pages.dev, confirm all five events (with username property) appear in the
  Umami dashboard.
- **Rollout:** commit → push → Cloudflare Pages auto-deploy. No build-config
  changes.
- **Failure mode:** if `cloud.umami.is` is down or blocked, the site behaves
  exactly as today (deferred script + guarded wrapper).
