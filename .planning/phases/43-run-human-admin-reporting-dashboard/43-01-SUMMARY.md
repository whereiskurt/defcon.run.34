---
phase: 43-run-human-admin-reporting-dashboard
plan: 01
subsystem: run.auth internal API
tags: [quota, gsi, internal-api, admin-reporting, admn-04]
requires:
  - byQuotaRemaining GSI (gsi1pk-gsi1sk-index) on run-quota-electro (existing, unchanged)
  - AUTH_INTERNAL_SECRET env (existing internal-secret gate)
provides:
  - listQuotaByType(quotaId) service function (single-query bulk read)
  - GET /api/internal/quota/by-type/[quotaId] internal route (bare array)
affects:
  - run.human admin dashboard (Phase 43 later plans join this by userId)
tech-stack:
  added: []
  patterns:
    - Reuse existing GSI for bulk read (pages:"all"), no per-user fan-out
    - verifyInternalSecret gate copied verbatim from sibling internal route
key-files:
  created:
    - apps/run.auth/webapp/src/services/quota.by-type.test.ts
    - apps/run.auth/webapp/src/app/api/internal/quota/by-type/[quotaId]/route.ts
  modified:
    - apps/run.auth/webapp/src/services/quota.ts
decisions:
  - Return the bare array (not object-wrapped) so run.human consumes it directly
  - updatedAt typed as number | undefined (source attr is optional in UserQuotaItem)
  - No admin session check in this route — server-to-server; admin gate lives in run.human
metrics:
  duration: ~30m (most spent repairing the vitest runtime environment)
  completed: 2026-07-11
  tasks: 2
  files: 3
status: complete
---

# Phase 43 Plan 01: run.auth bulk quota-by-type internal endpoint Summary

Read-only, internal-secret-gated bulk endpoint on run.auth that returns every user's
consumption for one quota type in a SINGLE query over the existing `byQuotaRemaining`
GSI — the cross-app signal that powers run.human's "who uses gpx a lot" admin view
(ADMN-04). No DynamoDB schema/GSI change; no per-user fan-out.

## What Was Built

**Task 1 — `listQuotaByType(quotaId)` service function** (`src/services/quota.ts`)
- Single call to `UserQuota.query.byQuotaRemaining({ quotaId }).go({ pages: "all" })`,
  then `.data.map` to `{ userId, consumptionCount: q.consumptionCount ?? 0, remaining, updatedAt }`.
- Mirrors the existing `getUserQuotas` mapping style. Exactly one `.go(` call in the
  function body — no per-user loop.
- TDD: `quota.by-type.test.ts` written first (RED, 4 failing tests), then implemented
  to green. Tests mock `@/entities/user-quota` so `UserQuota.query.byQuotaRemaining(...).go`
  resolves a fixed fixture — no live DynamoDB. Covers mapped shape, the consumptionCount
  0-default, the empty-result `[]` case, and the single-query guarantee
  (`byQuotaRemaining` called once with `{ quotaId }`, `.go` called once with `{ pages: "all" }`).

**Task 2 — `GET /api/internal/quota/by-type/[quotaId]` route**
(`src/app/api/internal/quota/by-type/[quotaId]/route.ts`)
- `verifyInternalSecret` copied verbatim from the sibling `internal/quota/[userId]` route:
  reads `process.env.AUTH_INTERNAL_SECRET`, compares the `X-Internal-Secret` header,
  returns 401 (`INVALID_INTERNAL_SECRET`) before any GSI read.
- Flow: verify secret → await params → 400 (`MISSING_QUOTA_ID`) if absent →
  `listQuotaByType(quotaId)` → `NextResponse.json(rows)` (bare array). try/catch → 500
  (`INTERNAL_ERROR`). ~60 lines with docblocks, read-only.

## Verify-Gate Results

| Gate | Command | Result |
|------|---------|--------|
| Task 1 vitest | `npx vitest run quota.by-type` | PASS — 4/4 (mapping, 0-default, empty, single-query) |
| Task 2 grep | `grep verifyInternalSecret` / `grep listQuotaByType` in route | PASS — both present |
| Task 2 typecheck | `npx tsc --noEmit` | PASS — exit 0, no output |
| Full suite | `npx vitest run` | PASS — 3 files, 14 tests |

## Threat Model Compliance

- **T-43-05 (Spoofing/Elevation, high, mitigate):** ENFORCED. `verifyInternalSecret`
  guards the handler before any data read; a request without a matching `X-Internal-Secret`
  returns 401. Gate copied verbatim from the audited sibling route. Endpoint is internal-only.
- **T-43-I1 (Info disclosure, low, accept):** Payload is `userId` + consumption counters
  only — no email/PII.
- **T-43-SC (supply chain, accept):** No new npm packages added to the project. See
  environment note below re: restoring an already-locked optional binding.

Prohibitions honored: request without the secret returns 401 (no data); no per-user
fan-out (one `.go(` call). Both must_haves truths satisfied.

## Deviations from Plan

### [Rule 3 - Blocking issue] Repaired the vitest runtime environment

The worktree's `node_modules` could not run vitest as delivered. Two independent problems,
both resolved by restoring the state the committed `package-lock.json` already describes —
no new project dependency added, `package.json`/`package-lock.json` unchanged (git stayed clean):

1. **Missing rolldown native binding.** vitest 4.1.9 (rolldown-vite) needs
   `@rolldown/binding-darwin-arm64@1.1.4` — an optional dep already pinned in rolldown's
   own `optionalDependencies` and present in the lockfile — but it was absent from the
   worktree tree (optional deps had been omitted at install). Restored via
   `npm install --include=optional` (lockfile-respecting).
2. **Node version.** The default shell node was v22.1.0, where `require(esm)` is behind a
   flag. vitest's `config.cjs` does `require('std-env')`, and `std-env@4.1.0` (the locked,
   registry-published version) is ESM-only, so config load threw `ERR_REQUIRE_ESM`. Switched
   to **Node v23.6.0** (already installed; MEMORY notes "Node v23.6.0 for tests"), where
   `require(esm)` is unflagged. Tests then ran clean.

   A mid-course `npm install --no-save --no-package-lock` (attempting to grab only the
   binding) transiently drifted transitive deps (bumped `std-env` to 4.2.0); recovered with
   `npm ci` + `npm install --include=optional` to snap the tree back to the lockfile.

No source or config file was changed to accommodate this — the fix is purely
"install the tree the lockfile already specifies, on the node version the project uses."

**Follow-up for later Phase-43 plans / CI:** run run.auth vitest under Node 23.x and ensure
optional deps are installed (`npm ci` on darwin-arm64 dropped the rolldown binding; a CI
step may need `npm install --include=optional` or a node-version pin).

## Known Stubs

None. Both functions are fully wired to the live GSI; no placeholder data paths.

## Self-Check: PASSED

- FOUND: apps/run.auth/webapp/src/services/quota.ts (listQuotaByType export)
- FOUND: apps/run.auth/webapp/src/services/quota.by-type.test.ts
- FOUND: apps/run.auth/webapp/src/app/api/internal/quota/by-type/[quotaId]/route.ts
- FOUND commit 42f8aaaa (test RED), 7ffd4fbb (feat listQuotaByType), d81c50cb (feat route)
