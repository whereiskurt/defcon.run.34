---
phase: 47-admin-ctf-crud-fields-ctf-leaderboard
plan: 03
subsystem: run.human admin CTF leaderboard
tags: [ctf, admin, leaderboard, csv, security, formula-injection]
requires:
  - "src/entities/run-user.ts (scanAllRunUsers, RunUserItem.ctfScore/ctfSolves)"
  - "src/entities/ctf.ts (CtfSolve entity + CtfSolveItem)"
  - "src/lib/admin-report.ts (csvCell/toCsv RFC-4180 quoter)"
  - "src/app/(protected)/admin/qr/gate.ts (gateAdminPage 404-on-denial)"
  - "src/lib/admin-gate.ts (ADMIN_GROUPS/requireGroups/revalidateGroups)"
  - "src/lib/qr-admin.ts (listCtf)"
  - "src/components/admin/qr-ui.ts (cls chrome tokens)"
provides:
  - "ctf-leaderboard.ts read/assembly (rankByScore/buildLeaderboard/listCtfSolvesByChallenge/joinSolveNames/guardFormula/leaderboardCsv)"
  - "gated /admin/leaderboard page (standings + per-challenge CtfSolve drill)"
  - "gated /api/admin/ctf-leaderboard CSV route"
  - "AdminConsole CTF Leaderboard link"
  - "the read shape the DC33 total-score mapper (separate worktree) consumes"
affects:
  - "apps/run.human admin surface (new leaderboard page + CSV route)"
tech-stack:
  added: []
  patterns:
    - "Phase-43 scanAllRunUsers reuse → in-memory rank by ctfScore desc"
    - "OWASP formula-injection guard composed OVER the shared csvCell (csvCell(guardFormula(v))), not a fork"
    - "ADMIN_GROUPS 404-on-denial gate reused verbatim (page via gateAdminPage, route via requireGroups+revalidateGroups keyed by authUserId)"
    - "displayName join with raw-sub fallback (namespace-mismatch safe)"
key-files:
  created:
    - apps/run.human/webapp/src/lib/ctf-leaderboard.ts
    - apps/run.human/webapp/src/lib/__tests__/ctf-leaderboard.test.ts
    - apps/run.human/webapp/src/app/(protected)/admin/leaderboard/page.tsx
    - apps/run.human/webapp/src/app/api/admin/ctf-leaderboard/route.ts
  modified:
    - apps/run.human/webapp/src/app/(protected)/admin/AdminConsole.tsx
decisions:
  - "guardFormula lives in the NEW leaderboard module and is layered over the shared csvCell — the Phase-43 users-CSV path is untouched (no regression risk)"
  - "displayName join keys by RunUser.userId and falls back to the raw CtfSolve.user id on a namespace miss, so a mismatch shows the id rather than dropping the solve"
  - "route gates EXACTLY like /api/admin/qr and revalidates on session.user.authUserId (OIDC sub), NOT the adapter id"
  - "CSV is the only route format (page consumes buildLeaderboard directly); no email/PII column is rendered or exported (T-47-11 accepted)"
metrics:
  duration: ~20m
  completed: 2026-07-14
status: complete
---

# Phase 47 Plan 03: CTF-only Leaderboard Summary

Built the admin CTF leaderboard (CTF-11): a gated `(protected)/admin/leaderboard` page that ranks users by `RunUser.ctfScore` (desc, with `ctfSolves`) and drills a selected challenge's `CtfSolve` rows, plus a gated `/api/admin/ctf-leaderboard` CSV export whose attacker-influenced cells are formula-injection-guarded. Reuses the Phase-43 `scanAllRunUsers` read and the existing `ADMIN_GROUPS` 404-on-denial gate; matches the AdminConsole HeroUI/teal chrome.

## What Was Built

- **`src/lib/ctf-leaderboard.ts`** (server-only) — the read/assembly module:
  - `rankByScore(users)` — pure: filter `ctfScore>0`, shape `{userId, displayName, ctfScore, ctfSolves}`, stable desc sort.
  - `buildLeaderboard()` — `scanAllRunUsers()` (Phase-43 reuse) → `rankByScore`.
  - `listCtfSolvesByChallenge(challenge)` — `CtfSolve.query.primary({challenge}).go({pages:"all"})`, sorted by ordinal asc.
  - `nameMapFromUsers` / `joinSolveNames` — userId→displayName map + the join with raw-sub fallback.
  - `guardFormula(v)` — OWASP guard: prefix `'` when a stringified cell starts with `= + - @ \t \r`.
  - `leaderboardCsv(rows)` — columns `[Rank, Runner, User ID, Score, Solves]`, every cell passed through `guardFormula` then serialized via the shared `toCsv` (i.e. `csvCell(guardFormula(v))` — the quoter is reused, not forked).
- **`src/lib/__tests__/ctf-leaderboard.test.ts`** — 17 cases (TDD RED→GREEN): zero-score filter, desc + tie-stable ranking, row shaping/defaults, name-map build, raw-sub fallback, guardFormula neutralizes `=/+/-/@/TAB/CR` + leaves benign text, and `leaderboardCsv` apostrophe-prefixes + RFC-4180-quotes a `"=1+1"` / `"=cmd(),evil"` displayName.
- **`src/app/(protected)/admin/leaderboard/page.tsx`** — server component (`runtime=nodejs; dynamic=force-dynamic`). `await gateAdminPage()` first (ADMIN_GROUPS + live revalidation + `notFound()`), `await searchParams` for optional `challenge`. Renders standings table, challenge chips (`?challenge=`), and — when selected — a CtfSolve drill (ordinal/runner/points/first-blood/channel/solved-at) plus a Download CSV link. React text nodes escape all attacker-influenced strings.
- **`src/app/api/admin/ctf-leaderboard/route.ts`** — `GET` gated exactly like `/api/admin/qr` (bare 404 on no-session / not-admin / failed `revalidateGroups(authUserId, ADMIN_GROUPS)`), streaming `leaderboardCsv(buildLeaderboard())` as `text/csv`, `Cache-Control: no-store`, dated `Content-Disposition`.
- **`AdminConsole.tsx`** — added a `CTF Leaderboard →` link styled identically to and next to the existing `QR / CTF →` link (the leaderboard link is this plan's; 47-01 does not edit AdminConsole).

## Gate + guardFormula Approach

- **Gate (T-47-09):** the page reuses `gateAdminPage()` (→ `notFound()`); the route reuses `requireGroups(session, ADMIN_GROUPS)` + `revalidateGroups(session.user.authUserId, ADMIN_GROUPS)` → bare `Response(null,{status:404})`. No 401/403 leak; the OIDC-sub identifier landmine is respected (revalidate on `authUserId`, never `session.user.id`).
- **guardFormula (T-47-10):** the OWASP prefix guard is a NEW pure function in the leaderboard module, composed OVER the shared `csvCell` via `toCsv`. The Phase-43 shared `csvCell` / users-CSV path is deliberately left untouched to avoid a regression; the CTF CSV additionally neutralizes spreadsheet formulas because challenge names + displayNames are attacker-influenced.

## Verification

- `npx vitest run src/lib/__tests__/ctf-leaderboard.test.ts`: **17/17 passing** (ranking, zero-score filter, name fallback, formula-injection neutralization).
- `npx tsc --noEmit`: **0 errors** in the 4 source files (`ctf-leaderboard.ts`, the page, the route, `AdminConsole.tsx`). The 5 pre-existing unrelated errors (`dropdown-user.tsx`, `checkin.test.ts`) remain and are out of scope.
- Manual live check (deferred): non-admin/logged-out → 404 on both surfaces; admin sees the ranking, drills a challenge, downloads the guarded CSV. Full signed-in click-through + the `q.defcon.run/admin/leaderboard` host are Phase 48.

## Deviations from Plan

None — plan executed exactly as written (3 tasks, TDD on Task 1).

## Parallel-wave Note

Ran in parallel with 47-01 (CtfForm/qr-admin) and 47-02 (migration). Stayed strictly in the 5 planned files; the leftover uncommitted 47-01 (`qr-admin.ts`) / 47-02 (`ctf-migration.ts`) working-tree changes present in this worktree were never staged or touched.

## Self-Check: PASSED

- Created files exist: ctf-leaderboard.ts, its test, leaderboard/page.tsx, ctf-leaderboard/route.ts — all present.
- Commits exist: bae55ef9 (module+tests), c78319e5 (page+AdminConsole), b434eba3 (CSV route).
