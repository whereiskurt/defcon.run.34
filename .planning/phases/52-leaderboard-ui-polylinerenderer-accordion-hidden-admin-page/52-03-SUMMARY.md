---
phase: 52-leaderboard-ui-polylinerenderer-accordion-hidden-admin-page
plan: 03
subsystem: run.human
tags: [leaderboard, admin, hidden-page, gate, non-disclosure, next-app-router]
requires:
  - "52-02: components/leaderboard/LeaderboardTable.tsx (the client this page renders)"
  - "Phase 43: (protected)/admin/page.tsx gate spine + apiBase() region helper"
  - "@/lib/admin-gate: requireAdmin (sync) + revalidateAdmin (async, live fresh-claims)"
provides:
  - "app/(protected)/leaderboard/page.tsx — hidden admin ranked-accordion page (LDBR-11)"
  - "lib/leaderboard-hidden.test.ts — nav-leak guard proving the route is in no navigation"
affects:
  - "apps/run.human/webapp — one new route reachable by URL only (linked from no nav)"
tech-stack:
  added: []
  patterns:
    - "Gate = mirror of (protected)/admin/page.tsx: requireAdmin -> notFound(); revalidateAdmin(authUserId) -> notFound(). Every denial collapses to a bare 404."
    - "Identity split: revalidateAdmin keyed by session.user.authUserId (OIDC sub); own-row highlight keyed by session.user.id (adapter uuid = RunUser.userId)."
    - "Hidden-nav guard = fs scan of components+app for a path-boundary route regex, feature files excluded, >0-files-scanned guard."
key-files:
  created:
    - "apps/run.human/webapp/src/app/(protected)/leaderboard/page.tsx"
    - "apps/run.human/webapp/src/lib/leaderboard-hidden.test.ts"
  modified: []
decisions:
  - "Widened the hidden-nav test past header-only (plan-checker warning): sweep all of src/components + src/app, exclude the feature's own files. Catches a leak in header, dropdown, menu, footer, or profile — anywhere."
  - "Route needle is a path-boundary regex (/leaderboard not followed by word char / - / /), not a bare substring — after the substring form false-positived on the @/lib/leaderboard-scoring import in an unrelated API test."
metrics:
  duration_min: 3
  tasks: 2
  files_changed: 2
  completed: 2026-07-14
status: complete
---

# Phase 52 Plan 03: Hidden Admin Leaderboard Page Summary

The hidden admin leaderboard route ships: a gated server page (`app/(protected)/leaderboard/page.tsx`) that mirrors the Phase-43 admin gate exactly and renders `<LeaderboardTable>` inside the real run.human chrome, plus a filesystem-scanning vitest (`lib/leaderboard-hidden.test.ts`) that proves the `/leaderboard` route is linked from no navigation component anywhere.

## What was built

**Task 1 — `app/(protected)/leaderboard/page.tsx` (feat, 648d676c).**
Server component. `runtime="nodejs"`, `dynamic="force-dynamic"`, and the admin page's `apiBase()` region-prefix helper (prod `/use1`, dev bare) copied verbatim. Gate spine mirrors `(protected)/admin/page.tsx`:
- `const session = await auth();`
- `const gate = requireAdmin(session); if (!gate.ok) notFound();`
- `const authUserId = session?.user?.authUserId; if (!authUserId || !(await revalidateAdmin(authUserId))) notFound();`

Every denial path collapses to `notFound()` (404) — never a 403, never a rendered page (SC #1, threats T-52-05/T-52-06). `revalidateAdmin` is called with `session.user.authUserId` (the OIDC sub), NOT `session.user.id` (the adapter uuid) — the Phase-43 identity landmine. It then renders `<LeaderboardTable currentUserId={session.user.id} apiBase={apiBase()} />` under a `🥕 Leaderboard 🥕` heading. `currentUserId` correctly uses `session.user.id` because the own-row highlight matches `RunUser.userId` (per 52-CONTEXT) — a deliberately different value than the `authUserId` used for the gate. No nav link, menu entry, or header change was added.

**Task 2 — `lib/leaderboard-hidden.test.ts` (test, c50eb058).**
Vitest that reads every `.ts/.tsx/.js/.jsx` source under `src/components` + `src/app` from disk (`node:fs` + `import.meta.url`, mirroring `copy-catalog-human.test.ts`) and asserts none reference the leaderboard route (SC #2, threat T-52-07). Two assertions: (1) a `>0 files scanned` guard against a vacuous pass; (2) zero offending files. Feature-owned files that legitimately contain the route are excluded (`components/leaderboard/`, `app/(protected)/leaderboard/`, `app/api/leaderboard/`, `lib/leaderboard-*`, `lib/polyline-geometry`, this test). The needle is a path-boundary regex built at runtime (`/leaderboard` not followed by a word char, `-`, or `/`) so it never bakes the literal path (no self-trip) and never false-positives on lib/component import paths.

## Verification

- `npx tsc --noEmit` — no NEW error in `page.tsx` or the test; only the 2 known pre-existing out-of-scope errors remain (`dropdown-user.tsx` svg module, `entities/__tests__/checkin.test.ts` `.model`). No phase-52 file errors.
- `npx vitest run src/lib/leaderboard-hidden.test.ts` — 2/2 pass (≥1 nav file scanned, zero route references).
- Regex boundary cross-check (node one-liner): matches `href="/leaderboard"`, `` `/leaderboard` ``, `/leaderboard?page=1`, `'/leaderboard'`; ignores `@/lib/leaderboard-scoring`, `@/lib/leaderboard-data`, `@/components/leaderboard/LeaderboardTable`, `/leaderboardX`.
- Orchestrator local browser check (end-of-phase, not run here): admin session sees the ranked accordion at /leaderboard; non-admin/signed-out gets 404.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Route needle was too loose (substring → path-boundary regex)**
- **Found during:** Task 2, first test run.
- **Issue:** The planned `includes("/leaderboard")` substring match flagged `src/app/api/internal/accomplishment/__tests__/route.test.ts`, which imports `@/lib/leaderboard-scoring` — the substring `/leaderboard` occurs inside `/leaderboard-scoring`. A false positive, not a real nav leak.
- **Fix:** Replaced the substring needle with a path-boundary regex `new RegExp("/leaderboard(?![A-Za-z0-9_/-])")` that matches the route only at a true path boundary (quote, `?`, `#`, whitespace, end) and ignores lib/component import-path continuations. Verified against 8 positive/negative cases.
- **Files modified:** `apps/run.human/webapp/src/lib/leaderboard-hidden.test.ts`
- **Commit:** c50eb058

### Plan-checker hardening folded in

Per the plan-checker warning, the hidden-nav test was widened from a header-only scan (`src/components/header/`) to the full `src/components` + `src/app` tree with the feature's own files excluded — so a `/leaderboard` link in a dropdown, menu, footer, or profile is caught too (SC #2 requires "no nav entry ANYWHERE"). The `>0 files scanned` guard was preserved.

## Known Stubs

None. Both artifacts are fully wired: the page renders the real `LeaderboardTable` against the live Phase-51 API, and the test scans real source.

## Self-Check: PASSED

- FOUND: `apps/run.human/webapp/src/app/(protected)/leaderboard/page.tsx`
- FOUND: `apps/run.human/webapp/src/lib/leaderboard-hidden.test.ts`
- FOUND commit 648d676c (feat 52-03 page)
- FOUND commit c50eb058 (test 52-03 hidden-nav)
