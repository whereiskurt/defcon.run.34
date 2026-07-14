---
phase: 45-visible-qr-claim-page
plan: 02
subsystem: web
tags: [ctf, next-app-router, route-group, public-route, park-and-claim, heroui, silent-sso]

# Dependency graph
requires:
  - phase: 45-visible-qr-claim-page
    plan: 01
    provides: createPending / claimPending park-and-claim helpers, judgeSolve guessHash seam
  - phase: 44-ctf-judge-core-scoring-engine-data-model
    provides: judgeSolve 7-step flow, JudgeResult shape, ctfJudgeLog hygiene
provides:
  - "(ctf) route group with its own silent-SSO-free root layout"
  - "public /use1/ctf/claim page wiring signed-in judge / anon park / signed-in claim"
  - "ClaimClient result card + ctf_pending nonce cookie keeper + sign-in CTA"
affects: [46-covert-channel, 47-admin-leaderboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dedicated route group with own <html>/<body>/Providers to opt OUT of a sibling group's layout-level silent-SSO redirect (run.human has no root layout)."
    - "Opportunistic session read on a PUBLIC page: attribute credit only when authUserId is a non-empty string; otherwise fall through to the anon park path."
    - "Three-branch server page: (A) signed-in+params judge, (C) anon+params park+CTA, (B) signed-in+nonce-cookie claim; (D) empty."

key-files:
  created:
    - apps/run.human/webapp/src/app/(ctf)/layout.tsx
    - apps/run.human/webapp/src/app/(ctf)/ctf/claim/page.tsx
    - apps/run.human/webapp/src/app/(ctf)/ctf/claim/ClaimClient.tsx
  modified: []

key-decisions:
  - "The (ctf) layout mirrors (public)/layout.tsx MINUS hasAuthSession()/auto-signin redirect — that redirect forwards a valid sess_auth cookie to /whoami, stripping ?c=&v= before the claim page runs. Removing it is the whole reason the group exists."
  - "Signed-in branch gates on `player = typeof authUserId === 'string' && authUserId.length > 0 ? authUserId : null`, NOT mere session presence. authUserId is string|undefined; a null player falls through to createPending so judgeSolve never receives undefined as user."
  - "Player key is session.user.authUserId (OIDC sub), never session.user.id (adapter uuid namespace mismatch)."
  - "page.tsx performs ZERO logging; the raw guess v is handed only to judgeSolve/createPending which hash it. Hygiene enforced by grep -c 'console' == 0 (comment reworded off the word 'console' to keep the gate honest)."
  - "normalizeChallenge wrapped in safeNormalize try/catch → malformed/empty/reserved challenge returns null → graceful non-award, never throws."
  - "signIn callbackUrl region-prefixed (isDev ? /ctf/claim : /use1/ctf/claim) mirroring (public)/page.tsx whoamiUrl so the post-login return lands back on the claim page to redeem the parked nonce."

metrics:
  tasks_completed: 2
  files_created: 3
  files_modified: 0
  duration_minutes: 12
  completed_date: 2026-07-14

status: complete
---

# Phase 45 Plan 02: Visible QR Claim Page Summary

Makes `run.defcon.run/use1/ctf/claim` real — a public Next.js App Router page (in its own silent-SSO-free `(ctf)` route group) that reads the session, runs the Phase-44/45-01 judge + park-and-claim helpers, and renders a visible award/park result in run.human chrome.

## What Was Built

- **`(ctf)/layout.tsx`** — a new route-group root layout owning its own `<html>/<body>/Providers/SessionProvider/CopyProvider/Header/Footer`, byte-parallel to `(public)/layout.tsx` **except** it deletes the `hasAuthSession()`/`auto-signin` silent-SSO redirect. That redirect fires on any valid `sess_auth` cookie and forwards to `/whoami`, which would strip the scanner's `?c=&v=` params before the claim page ever runs. run.human has no root layout, so this group must mount its own shell.
- **`(ctf)/ctf/claim/page.tsx`** — server component (`runtime="nodejs"`, `dynamic="force-dynamic"`). Reads `c`/`v` from `searchParams`, `auth()` for the session, and branches:
  - **(A) signed-in + params** → `judgeSolve({ user: authUserId, challenge, guess: v, channel:"qr" })` → result card.
  - **(C) anon + params** → `createPending(challenge, v)` → sign-in CTA (nonce written client-side).
  - **(B) signed-in + `ctf_pending` cookie, no params** → `claimPending(nonce, authUserId)` → result card, cookie cleared.
  - **(D) otherwise** → neutral "nothing to claim" card.
- **`ClaimClient.tsx`** — `"use client"` presentational HeroUI card mapping `JudgeResult` to visible states (award + first-blood chip + points/ordinal; capped celebrate-0; graceful non-award that hides wrong-vs-disabled), plus the `ctf_pending` nonce cookie keeper (write on `mode="signin"`, expire on `clearNonce`) and the region-prefixed `signIn("run.defcon.run", { callbackUrl })` CTA.

## Signed-in vs. anon branch condition

The signed-in attribution branch gates on **`authUserId` presence, not session existence**:

```ts
const authUserId = session?.user?.authUserId;            // string | undefined
const player = typeof authUserId === "string" && authUserId.length > 0
  ? authUserId : null;                                    // narrowed to string | null
```

`if (player && challenge && guess)` → judge now (TS narrows `player` to `string`, so `judgeSolve` never receives `undefined`). A signed-in session whose `authUserId` is empty/undefined has `player === null` and therefore **falls through to the anonymous `createPending` park path** — exactly the requested fail-safe (CHECKER WARNING 2).

## How the (ctf) group avoids the silent-SSO redirect

Next.js route groups (`(public)`, `(ctf)`) are sibling URL-transparent segments, each free to define its own root layout. `(public)/layout.tsx` runs `hasAuthSession()` (validates the `sess_auth` cookie against the auth server) and, on success, `redirect("/api/auth/auto-signin?callbackUrl=…/whoami")`. Placing `/ctf/claim` under a **new `(ctf)` group whose layout omits that logic entirely** means a request to the claim page is never routed through the redirect, so `?c=&v=` survive to the page. Verified: `grep -q "hasAuthSession\|auto-signin" (ctf)/layout.tsx` → absent.

## Verify Results

- **tsc (incl. layout, broadened gate):** `npx tsc --noEmit | grep '(ctf)'` → no matches (0 errors in the whole `(ctf)` group, covering the layout — CHECKER WARNING 1 addressed). Full-repo error count unchanged at 5 (the 2 pre-existing unrelated: `dropdown-user.tsx` missing `.svg` decl + 4 `checkin.test.ts` — untouched).
- **Hygiene grep:** `grep -c 'console' page.tsx` → `0` (raw guess `v` never logged; the page emits no logging at all).
- **vitest:** `ctf-pending.test.ts` (6) + `ctf-judge.test.ts` (15) → **21 passed** on Node v23.6.0.
- **Anon reachability (structural):** the `(ctf)` layout has no silent-SSO redirect and the page has no auth gate, so an anonymous `GET /use1/ctf/claim?c=&v=` renders the sign-in CTA rather than 404-ing or bouncing to `/whoami`. Live signed-in award styling and the sign-in round-trip are an operator visual check (non-blocking, per plan).

## Deviations from Plan

**1. [Rule 3 - Blocking] Reworded a comment to keep the hygiene gate honest**
- **Found during:** Task 2 verify.
- **Issue:** The plan's automated gate `[ "$(grep -c 'console' page.tsx)" = "0" ]` counts ANY occurrence of the string `console`, including a doc comment that said "no console/log call in this file" — which would fail the gate on a purely descriptive comment.
- **Fix:** Reworded the comment to "no logging call whatsoever in this file" so the gate reflects real logging calls (still zero), not prose.
- **Files modified:** `apps/run.human/webapp/src/app/(ctf)/ctf/claim/page.tsx`
- **Commit:** 988c4ac4

## Known Stubs

None — all three files are fully wired to committed 45-01/Phase-44 helpers.

## Self-Check: PASSED

- `(ctf)/layout.tsx` — FOUND
- `(ctf)/ctf/claim/page.tsx` — FOUND
- `(ctf)/ctf/claim/ClaimClient.tsx` — FOUND
- Commit 6a570ecc (layout) — FOUND
- Commit 988c4ac4 (page + client) — FOUND
