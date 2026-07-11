---
phase: 43-run-human-admin-reporting-dashboard
plan: 02
subsystem: run.human auth / admin authorization
tags: [admin-gate, authz, fresh-claims, non-disclosure, ADMN-01]
requires:
  - run.auth internal validate endpoint (/api/session/validate/user/{userId}, X-Internal-Secret)
  - existing fetchFreshClaims path in config/auth.ts
provides:
  - isAdmin, requireAdmin (sync services gate, no allowlist)
  - revalidateAdmin (async fresh-claims, fail-closed)
  - 404 non-disclosure caller contract
affects:
  - Plans 04/05 (admin page + API/CSV consumers)
tech-stack:
  added: []
  patterns: [group-claim authz mirror of run.bib admin-gate, single-source fresh-claims reuse]
key-files:
  created:
    - apps/run.human/webapp/src/lib/admin-gate.ts
  modified:
    - apps/run.human/webapp/src/config/auth.ts
decisions:
  - "revalidateAdmin reuses module-private fetchFreshClaims rather than duplicating the internal-secret fetch — one source of the validate path."
  - "Gate lib kept framework-neutral (no next/navigation) so pages and route handlers share it; 404 translation is the caller's job."
metrics:
  duration: ~10m
  completed: 2026-07-11
  tasks: 2
  files: 2
status: complete
---

# Phase 43 Plan 02: run.human Shared Admin Gate Summary

Single allowlist-free admin authorization primitive for run.human — sync `isAdmin`/`requireAdmin` (services-only, mirroring run.bib) plus an exported async `revalidateAdmin` that hits run.auth for live claims (fail-closed) to defeat the ~5-min JWT staleness window; denial contract is 404, never 403.

## What Was Built

### Task 1 — `revalidateAdmin` exported from `config/auth.ts` (commit `cb612956`)
Added `export async function revalidateAdmin(userId: string): Promise<boolean>` that calls the existing module-private `fetchFreshClaims(userId)` (unchanged) and returns `Boolean(fresh?.services?.includes("admin")) && !fresh?.lockedOut`. A null result (auth server unreachable / invalid / not found) yields `false` — fail-closed. This is the single source of the internal-secret validate path; no fetch logic was duplicated.

### Task 2 — `lib/admin-gate.ts` shared gate (commit `6b09b2c2`)
New framework-neutral module: `SessionLike`, `isAdmin`, `requireAdmin` ported verbatim from `apps/run.bib/webapp/src/lib/admin-gate.ts` (reads only `session.user.services`, no email allowlist), plus `export { revalidateAdmin } from "@/config/auth"` so callers get both sync and async halves from one import. Doc comments spell out (a) the 404 non-disclosure contract for pages (`notFound()`) and APIs (`new Response(null, { status: 404 })`), and (b) the `/admin`-entry duty to `await revalidateAdmin(session.user.id)` after `requireAdmin` passes. No `next/navigation` imports — consumable by both server components and route handlers.

## Verify-Gate Results

| Task | Gate | Result |
|------|------|--------|
| 1 | `grep export async function revalidateAdmin` + `grep fetchFreshClaims` + `tsc --noEmit` | PASS (greps ok; no tsc errors in config/auth.ts) |
| 2 | `grep isAdmin/requireAdmin/revalidateAdmin` + `tsc --noEmit` | PASS (greps ok; no tsc errors in admin-gate.ts) |

Prohibition/threat checks:
- No email allowlist (grep for "allowlist" matches only the `NO email allowlist` doc negation) — T-43-01 mitigated.
- `revalidateAdmin` does not trust cached JWT; it hits run.auth via `fetchFreshClaims`, fail-closed — T-43-06 mitigated.
- Framework-neutral: only import is the `revalidateAdmin` re-export; `notFound`/`redirect` appear only in comment lines — 404 contract documented (T-43-02).

**Pre-existing tsc errors (out of scope, NOT introduced by this plan):** `src/components/header/dropdown-user.tsx` (missing `@public/header/dcjack.svg` type decl) and `src/entities/__tests__/checkin.test.ts` (ElectroDB `.model` property typing). Both live outside the two files this plan touches and are unrelated to admin gating. Node v23.6.0 used for gates.

## Deviations from Plan

None — plan executed exactly as written. Tasks 1 and 2 implemented per their `<action>` blocks; both verify gates pass on the plan's own files.

## Follow-up Note for Plans 04/05 (not a code change here)

The gate exposes `revalidateAdmin(userId)` and the plan directs callers to pass `session.user.id`. Per the known run.human auth ID namespace landmine (session.user.id = Auth.js adapter uuid, while run.auth keys by OIDC sub / `token.authUserId`), Plans 04/05 should confirm which identifier the run.auth validate endpoint resolves for the live session before wiring `revalidateAdmin(...)`. The run.auth endpoint auto-detects userId-vs-email but expects the AuthProfile userId; if `session.user.id` does not resolve there, callers may need `token.authUserId`. This is a consumer wiring concern — the primitive's interface (`revalidateAdmin(userId)`) is correct as specified and unchanged.

## Self-Check: PASSED
- FOUND: apps/run.human/webapp/src/lib/admin-gate.ts
- FOUND: apps/run.human/webapp/src/config/auth.ts (modified, revalidateAdmin export present)
- FOUND commit: cb612956 (Task 1)
- FOUND commit: 6b09b2c2 (Task 2)
