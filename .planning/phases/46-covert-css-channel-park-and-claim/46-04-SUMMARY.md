---
phase: 46-covert-css-channel-park-and-claim
plan: 04
subsystem: run.human / CTF covert channel
tags: [ctf, covert-css, easter-egg, park-and-claim, client]
status: complete
requires: ["46-01", "46-02", "46-03"]
provides: ["covert-egg-client", "egg-trigger", "signed-in-loop", "deferred-claim-SC2"]
affects:
  - apps/run.human/webapp/src/app/(protected)/layout.tsx
  - apps/run.human/webapp/src/app/(public)/page.tsx
tech-stack:
  added: []
  patterns: [computed-style-readback, localStorage-park-and-claim, headless-listener-component]
key-files:
  created:
    - apps/run.human/webapp/src/lib/covert-egg.ts
    - apps/run.human/webapp/src/lib/__tests__/covert-egg.test.ts
    - apps/run.human/webapp/src/components/EggTrigger.tsx
  modified:
    - apps/run.human/webapp/src/app/(protected)/layout.tsx
    - apps/run.human/webapp/src/app/(public)/page.tsx
decisions:
  - "Win derives SOLELY from getComputedStyle(document.documentElement).getPropertyValue(AWARD_PROP) — no CSSOM-rule read, no fetch-body parse (T-46-11 invisibility)."
  - "Deferred claim is client-side: fireEgg stashes the encoded v in localStorage[dc34:covert:pending] BEFORE the read; claimStashed re-fires on next signed-in load, idempotent via judgeSolve conditional-put. No server nonce/cookie/header — response stays byte-identical (T-46-14/15)."
  - "PRIMARY egg mount = (protected)/layout.tsx (no redirect, wraps every signed-in page) so the full signed-in loop is genuinely reachable; SECONDARY anon mount on (public)/page.tsx for park-and-claim."
metrics:
  duration: ~15m
  completed: 2026-07-14
  tasks: 2
  files: 5
---

# Phase 46 Plan 04: Egg Client + `!!!` Trigger + Deferred Claim Summary

Client-side covert-egg module (`fireEgg` → inject `<link>` → `getComputedStyle` read-back of `AWARD_PROP`) plus a headless `!!!` `EggTrigger` mounted where signed-in users actually land, with a localStorage park-and-claim seam that credits an unauth win on the next signed-in visit — exactly once, with zero server-returned claim material.

## What Was Built

**Task 1 — `src/lib/covert-egg.ts`** (`"use client"`, browser-only guards, <130 lines incl. doc):
- `buildCovertUrl(challenge, guess)` / `buildCovertUrlFromV(v)` → `<basePath>/assets/theme?v=<decimal>` (46-02 path; region/basePath mirrors the `whoamiUrl` pattern — `isDev ? "" : "/"+NEXT_PUBLIC_REGION_SHORT`).
- `shouldCelebrate(marker)` → true iff the marker trims to a finite numeric value `> 0` (`""`/whitespace/`"0"`/`"000"`/non-numeric → false).
- `readAward()` → `getComputedStyle(document.documentElement).getPropertyValue(AWARD_PROP)`, imported from `ctf-covert-css.ts` so the read token matches the route's write exactly.
- `PENDING_KEY = "dc34:covert:pending"` + `stashPending`/`readPending`/`clearPending` — a deduped JSON `string[]`, every access try/catch-guarded (missing/broken localStorage = silent no-op).
- `fireCovert(v, onResult)` — injects `<link rel=stylesheet href=buildCovertUrlFromV(v)>`, resolves on `load`/`error` (with a 1500ms timeout fallback → no-win), reads the marker via computed style, removes the link, reports the win. Win derives SOLELY from `readAward()`.
- `fireEgg(challenge, guess, onResult)` — `v = encodeFlag(...)`; `stashPending(v)` FIRST (client can't know auth state); `fireCovert(v, win => { if (win) clearPending(v); onResult(win); })`.
- `claimStashed(onWin?)` — for each parked `v`, `fireCovert(v, win => { if (win) { clearPending(v); onWin?.(); } })`.

**Task 2 — `src/components/EggTrigger.tsx`** (`"use client"`, headless, ~85 lines):
- Detects the `!!!` gesture (three `!` keydowns or three `touchend` taps within a 1200ms rolling window).
- Holds a baked demo `challenge="dc34-egg"` / `guess="!!!"`; on trigger `fireEgg(...)` toggles `<CtfCelebration active={celebrating} />` on a computed-style win, auto-clearing after 5000ms so it can re-fire.
- ON MOUNT calls `claimStashed(() => setCelebrating(true))` — the load-bearing SC2 deferred-claim path.

**Mounts:**
- PRIMARY: `<EggTrigger />` in `src/app/(protected)/layout.tsx` (inside the `CopyProvider`, alongside Header/Footer/MapBackground — chrome untouched). This layout reads the session and renders with NO redirect, and wraps every signed-in page, so the full loop (trigger → covert → judgeSolve credit → win sheet → computed-style read → confetti) is demonstrable in-app.
- SECONDARY: `<EggTrigger />` in `src/app/(public)/page.tsx` (anon users are not silent-SSO-redirected there). The page's three return branches were refactored into a single `content` variable so the trigger mounts in all states without disturbing existing behavior.

## fireEgg / claimStashed Signatures + PENDING_KEY

```ts
export const PENDING_KEY = "dc34:covert:pending";
export function fireEgg(challenge: string, guess: string, onResult: (win: boolean) => void): void;
export function fireCovert(v: string, onResult: (win: boolean) => void): void;
export function claimStashed(onWin?: () => void): void;
```

## How the Load-Bearing Behaviors Are Tested

`src/lib/__tests__/covert-egg.test.ts` — 12 tests, vitest DEFAULT node env (NO jsdom). `document`, `getComputedStyle`, `localStorage` are stubbed via `vi.stubGlobal`; a fake `<link>` captures its `load`/`error` listeners and exposes a `sheet` getter spy.

1. **Signed-in loop (SC5):** `fireEgg("dc34-egg","1337", onResult)` with `getComputedStyle` stubbed to a winning marker (`"10"`) → exactly one `<link rel=stylesheet href=/assets/theme?v=…>` injected → fire its `load` → `onResult(true)` (the exact value `EggTrigger` feeds to `CtfCelebration active`). Empty marker → `onResult(false)`. Link is removed; `_sheetReads === 0`.
2. **Deferred claim exactly once (SC2):** unauth `fireEgg` with empty marker → `v` stays parked; carry the localStorage to a "next load" with a winning marker → `claimStashed(onWin)` re-fires one link → `load` → `onWin` fires ONCE and `readPending() === []`; a second `claimStashed` finds nothing → no link injected, no `onWin` (idempotent, mirrors judgeSolve's conditional-put).
3. **Invisibility guard:** asserts `fetch` is never called and the injected sheet's `.sheet` (CSSOM) is never read — the only claim material is the client's own stashed `v`.

Plus: `buildCovertUrl` path/decimal-`v` shape, `shouldCelebrate` win-gate table, `readAward` computed-style read, stash dedupe/clear, and the missing-localStorage no-op.

## Deviations from Plan

None — plan executed exactly as written. The plan pre-authorized the `(public)/page.tsx` return-into-`content` refactor (needed so the trigger mounts across all three render branches without altering behavior).

## Threat Mitigations Applied

- **T-46-11 / T-46-13** — win derives only from `getComputedStyle`; `shouldCelebrate` gates non-empty numeric > 0 (tested).
- **T-46-12** — injected `<link>` removed after read; carries only the build-date-looking `?v=`.
- **T-46-14** — no server-returned claim material; client stashes its own `v`; no-fetch/no-CSSOM asserted.
- **T-46-15** — deferred re-fire idempotent via judgeSolve conditional-put; second claim is a no-op (tested).

## Verify Results

- `npx vitest run covert-egg.test.ts` → 12/12 green (Node 23.6.0).
- Full covert suite (covert-egg + codec + css + route) → 35/35 green.
- Task 2 verify gate → vitest PASS; EggTrigger present in `(protected)/layout.tsx` and `(public)/page.tsx`; `CtfCelebration` + `claimStashed` present in EggTrigger.
- `npx tsc --noEmit` → 5 total errors, all pre-existing/unrelated (dcjack.svg module decl + 4 checkin.test.ts electro typings); ZERO in the new/edited files.
- `(protected)/layout.tsx` introduces NO redirect (the only `redirect` token is a comment).

## Known Stubs

None. The demo challenge/guess (`dc34-egg` / `!!!`) is an intentional baked-in loop flag documented inline in `EggTrigger.tsx`; wiring real admin-created challenges is Phase 47 (admin CRUD) territory.

## Follow-ups (out of scope)

- Embedding the same `covert-egg` module into the separate static landing app (`apps/static/landing/`) — noted follow-up, not required for this phase.
- Full network-tab proof (stylesheet 200 across win/wrong/unauth, byte-identical) lands after Phase 48 CloudFront exposure.

## Self-Check: PASSED
