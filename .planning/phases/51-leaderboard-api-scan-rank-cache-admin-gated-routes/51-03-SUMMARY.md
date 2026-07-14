---
phase: 51-leaderboard-api-scan-rank-cache-admin-gated-routes
plan: 03
subsystem: api
tags: [nextjs, route-handler, admin-gate, electrodb, leaderboard, privacy-hook]

# Dependency graph
requires:
  - phase: 43-run-human-admin-reporting-dashboard
    provides: requireAdmin + revalidateAdmin admin gate, 404 non-disclosure contract, authUserId identity landmine
  - phase: 49
    provides: getAccomplishmentsByUser reader + Accomplishment entity (metadata.polyline)
provides:
  - "GET /api/leaderboard/[userId]/accomplishments — admin-gated per-runner drill-down returning runs incl. metadata.polyline"
  - "Named no-op applyPrivacyFilter seam for the launch-time privacy filter (spec §9)"
affects: [phase-52, leaderboard-ui, polyline-renderer, launch-privacy-flip]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Admin-gated route handler: requireAdmin -> revalidateAdmin(authUserId) -> bare 404 on every denial (non-disclosure)"
    - "Importable-handler vitest: mock @/config/auth (auth+revalidateAdmin) so the real pure requireAdmin runs"
    - "Named privacy seam (applyPrivacyFilter) instead of a buried TODO comment"

key-files:
  created:
    - apps/run.human/webapp/src/app/api/leaderboard/[userId]/accomplishments/route.ts
    - apps/run.human/webapp/src/app/api/leaderboard/[userId]/accomplishments/__tests__/route.test.ts
  modified: []

key-decisions:
  - "Denial always maps to a bare 404 (never 403/401) — route existence is not advertised (T-51-04)"
  - "revalidateAdmin keyed by session.user.authUserId (OIDC sub), NOT session.user.id (adapter uuid) — Phase-43 identity landmine"
  - "metadata is kept whole in the response DTO so metadata.polyline survives for the Phase-52 renderer"
  - "applyPrivacyFilter is a named identity no-op today (admin-only surface); the launch filter slots in here"

patterns-established:
  - "Per-user leaderboard drill-down route mirrors app/api/admin/users/route.ts gate exactly"

requirements-completed: [LDBR-08]

coverage:
  - id: D1
    description: "Non-admin / anonymous / stale-admin callers get a bare 404 with no body and the data layer is never hit"
    requirement: LDBR-08
    verification:
      - kind: unit
        ref: "src/app/api/leaderboard/[userId]/accomplishments/__tests__/route.test.ts#404s (bare, no body) for a non-admin and NEVER hits the data layer"
        status: pass
      - kind: unit
        ref: "src/app/api/leaderboard/[userId]/accomplishments/__tests__/route.test.ts#404s (fresh-claims deny) for a stale admin whose revalidation fails"
        status: pass
    human_judgment: false
  - id: D2
    description: "Admin caller gets 200 { accomplishments } including metadata.polyline; revalidateAdmin keyed by authUserId"
    requirement: LDBR-08
    verification:
      - kind: unit
        ref: "src/app/api/leaderboard/[userId]/accomplishments/__tests__/route.test.ts#returns 200 with accomplishments including metadata.polyline for an admin"
        status: pass
    human_judgment: false
  - id: D3
    description: "A clearly-marked no-op privacy-filter hook sits between fetch and response for the launch-time filter (spec §9)"
    requirement: LDBR-08
    verification:
      - kind: other
        ref: "code inspection: applyPrivacyFilter named + called as const visible = applyPrivacyFilter(accomplishments)"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-14
status: complete
---

# Phase 51 Plan 03: Per-User Accomplishments Route Summary

**Admin-gated `GET /api/leaderboard/[userId]/accomplishments` — 404 non-disclosure + fresh-claims gate over the Phase-49 `getAccomplishmentsByUser`, returning a runner's runs with `metadata.polyline` intact and a named no-op privacy seam for launch.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-14T05:42:00Z
- **Completed:** 2026-07-14T05:43:34Z
- **Tasks:** 1 (TDD: test → feat)
- **Files modified:** 2 (both created)

## Accomplishments
- Shipped the lazy per-runner drill-down route the Phase-52 accordion will call on row-expand.
- Admin gate mirrors `app/api/admin/users/route.ts` exactly: `requireAdmin` → `revalidateAdmin(authUserId)` → bare 404 on every denial path (no session, non-admin group, missing OIDC sub, stale claims). Never 403/401, never a body.
- Reuses shipped helpers as-is (`requireAdmin`/`revalidateAdmin` from `@/lib/admin-gate`, `getAccomplishmentsByUser` from `@/entities/accomplishment`) — nothing re-implemented.
- Response keeps `metadata` whole so `metadata.polyline` survives for the future PolylineRenderer (SC #4).
- Named `applyPrivacyFilter` no-op seam records the spec §9 launch debt where the privacy filter will slot in — not buried in a comment.

## Task Commits

1. **Task 1 (RED): failing admin-gate/polyline test** - `39a0420` (test)
2. **Task 1 (GREEN): per-user accomplishments route** - `7803b02` (feat)

No REFACTOR commit — implementation was clean on first pass.

## Files Created/Modified
- `apps/run.human/webapp/src/app/api/leaderboard/[userId]/accomplishments/route.ts` - The admin-gated GET handler (gate → read → privacy seam → shaped JSON).
- `apps/run.human/webapp/src/app/api/leaderboard/[userId]/accomplishments/__tests__/route.test.ts` - Importable-handler vitest: 4 branches (non-admin 404, anon 404, admin 200 w/ polyline, stale-admin 404).

## Decisions Made
None beyond the plan — followed the LOCKED gate contract, identity landmine, and privacy-hook marking as specified.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Verification
- Route vitest: **4/4 pass** (`nvm use 23.6.0`, from `apps/run.human/webapp`).
- `npx tsc --noEmit`: PASS per plan criteria — only the two KNOWN pre-existing out-of-scope errors remain (`dropdown-user.tsx` svg import, `__tests__/checkin.test.ts` `.model`); neither references the new route file, and no new errors were introduced.
- Signing no-ops on this host (expected per environment notes).

## Next Phase Readiness
- The per-user drill-down endpoint is ready for Phase 52's accordion lazy-load.
- Launch-time privacy filter has a named seam (`applyPrivacyFilter`) to fill when the gate relaxes from admin-only to signed-in.

## Self-Check: PASSED

- Files verified on disk: route.ts, route.test.ts, 51-03-SUMMARY.md — all FOUND.
- Commits verified in git log: `39a0420a` (test/RED), `7803b029` (feat/GREEN) — all FOUND.

---
*Phase: 51-leaderboard-api-scan-rank-cache-admin-gated-routes*
*Completed: 2026-07-14*
