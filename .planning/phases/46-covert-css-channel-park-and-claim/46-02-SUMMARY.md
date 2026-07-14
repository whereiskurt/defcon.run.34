---
phase: 46-covert-css-channel-park-and-claim
plan: 02
subsystem: web
tags: [ctf, covert-channel, next-app-router, route-handler, text-css, park-and-claim, invisibility]

# Dependency graph
requires:
  - phase: 46-covert-css-channel-park-and-claim
    plan: 01
    provides: decodeFlag codec + buildDecoySheet/buildWinSheet/AWARD_PROP/SIZE_TOLERANCE CSS-ack
  - phase: 45-visible-qr-claim-page
    plan: 01
    provides: createPending hash-only park + judgeSolve guessHash seam
  - phase: 44-ctf-judge-core-scoring-engine-data-model
    provides: judgeSolve 7-step flow, JudgeResult, ctfJudgeLog coarse-marker hygiene
provides:
  - "covert text/css route handler at /use1/assets/theme (always 200 + text/css + no-store)"
  - "testable handleCovert(req, deps) core with injectable getSession/judge/park seam"
affects: [46-04-egg-client-trigger, 47-admin-leaderboard, 48-cloudfront-covert-behavior]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Invisibility envelope: every outcome (win/wrong/unauth/garbage) returns the SAME HTTP 200 + Content-Type text/css + Cache-Control no-store; the only tell is the presence-only AWARD_PROP buried in the CSS body."
    - "Lazy dynamic import of @/config/auth inside the default getSession so the route test seam never loads NextAuth/DynamoDB (keeps the vitest suite hermetic while the file stays single-module)."
    - "Total never-throw guard: any decode/normalize/store error degrades to the decoy 200 — never 302/401/JSON/5xx."
    - "Handler-level ZERO logging: the raw guess routes ONLY into judgeSolve/createPending (which hash it); the only structured line is judgeSolve's coarse ctfJudgeLog."

key-files:
  created:
    - apps/run.human/webapp/src/app/(ctf)/assets/theme/route.ts
    - apps/run.human/webapp/src/app/(ctf)/assets/theme/__tests__/route.test.ts
  modified: []

key-decisions:
  - "Covert path = /use1/assets/theme (source src/app/(ctf)/assets/theme/route.ts) — reads as a themed asset, app-routed to the ALB origin, and extension-less so a higher-precedence *.css static behavior cannot grab it (the exact spelling Phase 48 carves a CloudFront behavior for)."
  - "Win gate = result.solved && result.points > 0. A first-hit credited solve OR an idempotent judgeSolve replay (prior award > 0) renders buildWinSheet(points); a capped-to-0 solve renders the decoy so a 0-point state carries no award tell."
  - "Player key = session.user.authUserId narrowed to a non-empty string; anything else (no session, empty/undefined authUserId) falls through to the unauth createPending park path — judgeSolve never receives undefined as user (same fail-safe as Phase 45-02)."
  - "Everything kept in the single route.ts (strict scope). The testable core is an exported handleCovert(req, deps); GET calls it with production defaults. deps.getSession/judge/park let the route test drive REAL judgeSolve/createPending against in-memory fakes with a spy log — no DynamoDB, no auth."
  - "channel: \"covert\" passed to judgeSolve; NO new judge/scoring/park logic added — composes 46-01 primitives + Phase-44/45 helpers."

metrics:
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  duration_minutes: 9
  completed_date: 2026-07-14

status: complete
---

# Phase 46 Plan 02: Covert text/css Route Handler Summary

The invisibility surface itself: an App Router route handler at `run.defcon.run/use1/assets/theme` that always answers `200 text/css no-store`, decodes the `?v=` flag, credits a signed-in win through the existing `judgeSolve(channel:"covert")` (or parks an unauth guess hash-only via `createPending`), and returns either the plain decoy sheet or the marker-bearing win sheet — with zero network-observable tell of auth/win state.

## What Was Built

- **`src/app/(ctf)/assets/theme/route.ts`** (110 lines) — exports `GET(req)`, the segment config `runtime="nodejs"` / `dynamic="force-dynamic"`, and the testable core `handleCovert(req, deps)`.
  - **Flow:** read `?v=` → `decodeFlag(v)`; `null` → decoy immediately. On `{challenge, guess}`: `safeNormalize(challenge)` (guarded → decoy, never throws). Read session via injectable `getSession` (default = lazy `import("@/config/auth").auth()`); `player = typeof authUserId === "string" && authUserId.length > 0 ? authUserId : null`.
  - **Win branch:** `player` present → `judgeSolve({ user: player, challenge, guess, channel:"covert" })`; `result.solved && result.points > 0` → `buildWinSheet(result.points)`; else → decoy.
  - **Unauth branch:** `player` null → `await createPending(challenge, guess)` (parks `submittedFlagHash` only) → decoy.
  - **Envelope:** every path returns `new Response(body, { status: 200, headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" } })`; a total `try/catch` guard makes any unexpected error still return the decoy 200.
- **`__tests__/route.test.ts`** — the full invisibility matrix, driving the handler with a fake `CtfStore` (behind `judge`) and fake `PendingStore` (behind `park`) so the REAL `judgeSolve`/`createPending` run with no DynamoDB, plus a stub `getSession`.

## Win / Wrong / Unauth branch logic

| Outcome | Session | Decoded `v` | Judge/Park call | Body |
|---------|---------|-------------|-----------------|------|
| signed-in win | authUserId present | correct | `judgeSolve` → solved, points>0 | **win sheet** (AWARD_PROP) |
| signed-in wrong / capped-0 | authUserId present | wrong / capped | `judgeSolve` → non-solve / points 0 | decoy |
| unauth park | null | any | `createPending` (hash-only) | decoy |
| garbage / missing `v` | any | `decodeFlag` null | none | decoy |

Idempotent re-fire: `judgeSolve`'s conditional-put replay returns the prior award (`points>0`), which re-renders the win sheet without double-scoring (ordinal allocated once, `ctfSolves` stays 1).

## Verify Results

- **Route vitest suite (Node 23.6.0):** `npx vitest run "src/app/(ctf)/assets/theme/__tests__/route.test.ts"` → **11 passed**. Includes:
  - **Identical-envelope across the 4 outcomes:** win / wrong / unauth / garbage all assert `status === 200`, `content-type` starts with `text/css`, `cache-control === "no-store"`.
  - **Size-tolerance:** `Math.abs(winBody.length - decoyBody.length) <= SIZE_TOLERANCE` (8).
  - **AWARD_PROP win-only:** present in the win body, absent in wrong + unauth bodies.
  - **Spy-log hygiene:** injected `vi.fn()` log — dump contains neither the raw correct guess, the raw wrong guess, nor the AWARD value as a logged field; every emitted `result` is a coarse marker (`solve`/`no-solve`/`capped`/`replay`). Handler emits ZERO logs on the unauth + garbage paths (judge never runs).
  - **Unauth park:** `createPending` invoked exactly once, `submittedFlagHash === hashAnswer(guess)`, raw guess absent from the parked row; judge never invoked (no self-credit).
  - **Idempotency:** second win returns the same award body, `allocateCalls === 1`, `ctfSolves === 1`.
- **Source hygiene gate:** `grep -cE 'console\.|emit\('` over comment-stripped `route.ts` → **0** (handler contains no direct logging call).
- **tsc:** `npx tsc --noEmit` → 0 errors in `assets/theme`; total repo error count unchanged at **5** (the pre-existing unrelated `dropdown-user.tsx` `.svg` decl + 4 `checkin.test.ts` — untouched, out of scope).

## Deviations from Plan

None — plan executed exactly as written. The plan pre-authorized factoring the core into an exported `handleCovert(req, deps)` when GET could not accept injected deps directly; that seam was used, keeping GET thin and everything in the single in-scope `route.ts`.

## Known Stubs

None — the handler is fully wired to committed 46-01 primitives (`decodeFlag`, `buildDecoySheet`/`buildWinSheet`) and Phase-44/45 helpers (`judgeSolve`, `createPending`, `normalizeChallenge`).

## Self-Check: PASSED

- `src/app/(ctf)/assets/theme/route.ts` — FOUND
- `src/app/(ctf)/assets/theme/__tests__/route.test.ts` — FOUND
- Commit 69483abe (test/RED) — FOUND
- Commit 7a1803f4 (feat/GREEN) — FOUND
