---
phase: 43-run-human-admin-reporting-dashboard
plan: 04
subsystem: run.human admin reporting
tags: [admin, reporting, pii-masking, csv-export, dynamodb-scan]
requires:
  - 43-01 (run.auth /api/internal/quota/by-type/[quotaId] + listQuotaByType)
  - 43-02 (admin-gate.ts: requireAdmin / revalidateAdmin / isAdmin)
  - 43-03 (scanAllRunUsers, scanAllUploads, auth-user.ts email + scanAccountSubs, scanRunnerCodesBySub, getQuotaByType)
provides:
  - "lib/admin-report.ts (buildUserReport, maskEmail, runnerQrUrl, csvCell, toCsv, sortRows, filterByEmail, summaryTiles, lastActivityOf, UserReportRow)"
  - "GET /api/admin/users (masked JSON + reveal + search/sort/page + ?format=csv)"
affects:
  - "Plan 05 admin users page (consumes /api/admin/users JSON + CSV link)"
tech-stack:
  added: []
  patterns:
    - "Pure PII helpers (mask/csv/sort/filter) separated from async scans for unit-testability"
    - "Fan-out-free join: two namespace maps composed for bib code; single uploads scan map"
    - "Bare-404 non-disclosure gate (requireAdmin + fresh-claims revalidateAdmin)"
key-files:
  created:
    - apps/run.human/webapp/src/lib/admin-report.ts
    - apps/run.human/webapp/src/lib/admin-report.test.ts
    - apps/run.human/webapp/src/app/api/admin/users/route.ts
  modified: []
decisions:
  - "revalidateAdmin wired to session.user.authUserId (OIDC sub), NOT session.user.id (adapter uuid)"
  - "UserReportRow.services defaults to [] — no read helper in this join carries a group/services claim; documented, not a functional stub for the report core"
  - "uploads column = gpx+photo total from the single scanAllUploads() map"
metrics:
  duration: ~15m
  completed: 2026-07-11
status: complete
---

# Phase 43 Plan 04: Admin Report Assembly + Users API Summary

Built the join/mask/CSV/QR assembly library (`lib/admin-report.ts`) plus its vitest
unit, and the admin-gated `GET /api/admin/users` route that serves the masked JSON
dashboard view (search/sort/paginate + per-row reveal) and the full `?format=csv`
export — every denial a bare 404.

## What Was Built

### Task 1 — `lib/admin-report.ts` + `admin-report.test.ts`
- `buildUserReport()` fires the reads concurrently: ONE `scanAllRunUsers()` spine,
  `getAuthUserEmails()`, three `getQuotaByType("gpx_upload"|"gpx_save"|"gpx_share")`
  bulk fetches, ONE `scanAllUploads()` count map, and the two bib-namespace maps
  (`scanAccountSubs()` adapterId→sub composed with `scanRunnerCodesBySub()` sub→code).
  Bib code and uploads are pure map lookups — zero per-row fan-out.
- `lastActivityAt = max(updatedAt, lastLoginAt, lastCheckInAt)` via the extracted
  pure `lastActivityOf()` (unit-tested without mocking scans).
- `maskEmail()` keeps only the first local-part char + full domain
  (`kurt@gmail.com → k•••@gmail.com`); `""` for null; `•••` for malformed input.
- `runnerQrUrl(hash)` = `https://run.<SITE_DOMAIN>/<REGION_SHORT>/r?h=<hash>`
  (defaults `defcon.run` / `use1`), matching run-user.ts:191.
- `csvCell`/`toCsv` copied verbatim (RFC-4180). `sortRows` (desc), `filterByEmail`
  (full-email substring), `summaryTiles` (total / 7d signups / 7d active / gpx-active).
- Test: 16 cases covering maskEmail non-leak (asserts masked output never contains
  the rest of the local part), CSV escaping of `" , \n`, sort desc per key,
  lastActivity max, filter, and QR template.

### Task 2 — `GET /api/admin/users`
- `runtime = "nodejs"` + `dynamic = "force-dynamic"`.
- Gate: `requireAdmin(session)` → on `!ok`, bare 404. Then fresh-claims
  `revalidateAdmin(session.user.authUserId)` — a missing `authUserId` OR a claims
  denial both return a bare 404 (fail-closed). No 403 anywhere.
- Params: `q` (server-side full-email filter), `sort`
  (`lastActivity`|`gpxUsage`|`signup`, default lastActivity, desc), `page`/`pageSize`,
  `reveal`, `format`.
- JSON: masked emails on the paginated slice; full email ONLY on the row whose
  `userId === ?reveal`; includes `total`, `page`, `pageSize`, `sort`, `summary`.
- `?format=csv`: the FULL filtered/sorted set (not just the page) with full
  emails/QR/bib codes + ISO timestamps as `run-users-YYYY-MM-DD.csv` (no-store).

## Identifier Wiring (the landmine)
`revalidateAdmin` is called with `session.user.authUserId` (the auth.defcon.run
OIDC sub, exposed by `config/auth.ts:300`), NOT `session.user.id` (the Auth.js
DynamoDB-adapter local uuid). The run.auth validate path is keyed by the OIDC sub;
passing the adapter id would silently 404 a real admin. Missing `authUserId` and a
fresh-claims failure both collapse to the same bare 404.

## Verify-Gate Results
- Task 1 greps: PASS. `npx vitest run src/lib/admin-report.test.ts` → **16 passed / 16**.
- Task 2 greps: PASS.
- `npx tsc --noEmit`: my three files typecheck clean. The only remaining errors are
  the two documented pre-existing baseline items, out of scope for this plan:
  - `components/header/dropdown-user.tsx` (missing `@public/header/dcjack.svg` type decl)
  - `entities/__tests__/checkin.test.ts` (ElectroDB `.model` typing)
- Node v23.6.0 used for all vitest/tsc runs.

## Deviations from Plan
- **[Rule 2 — shape completeness]** `UserReportRow.services` is defined per the plan
  but populated as `[]`: no read helper consumed by this join carries a group/services
  claim (services live on the Auth.js session, not on RunUser or any Plan-03 scan).
  Documented inline; the report core (email/bib/gpx/QR/activity) does not depend on it.
  Not a functional stub — no future plan is required to "wire" it unless a services
  column is later demanded, which would need a new authjs-record projection.

## Known Stubs
None affecting the plan goal. (`services: []` noted above is a stable-shape default,
not a data stub in the rendered report columns.)

## Commits
- `44d824a3` feat(43-04): admin-report assembly + mask/CSV/QR helpers + vitest
- `0686c41e` feat(43-04): admin users API (404 gate, masked JSON, reveal, search/sort/page, CSV)

## Self-Check: PASSED
- FOUND: apps/run.human/webapp/src/lib/admin-report.ts
- FOUND: apps/run.human/webapp/src/lib/admin-report.test.ts
- FOUND: apps/run.human/webapp/src/app/api/admin/users/route.ts
- FOUND commit: 44d824a3
- FOUND commit: 0686c41e
