---
phase: 43-run-human-admin-reporting-dashboard
plan: 03
subsystem: run.human data layer
tags: [admin, reporting, dynamodb, scan, quota, pii]
requires:
  - run.auth /api/internal/quota/by-type/[quotaId] (Plan 01)
provides:
  - scanAllRunUsers (run-user.ts)
  - scanAllUploads (user-upload.ts)
  - getAuthUserEmail / getAuthUserEmails / scanAccountSubs (auth-user.ts, NEW)
  - scanRunnerCodesBySub (bib.ts)
  - getQuotaByType (quota-client.ts)
affects:
  - Plan 04 (admin API/page assembly + masking + CSV)
tech-stack:
  added: []
  patterns: [electrodb-scan-pages-all, single-scan-reduce-to-map, fan-out-free-join, degrade-to-empty]
key-files:
  created:
    - apps/run.human/webapp/src/entities/auth-user.ts
  modified:
    - apps/run.human/webapp/src/entities/run-user.ts
    - apps/run.human/webapp/src/entities/user-upload.ts
    - apps/run.human/webapp/src/entities/bib.ts
    - apps/run.human/webapp/src/lib/quota-client.ts
decisions:
  - "USER# key = adapter default pk=sk=USER#{id} (direct get) with GSI1 fallback wired for shape-drift resilience."
  - "RunUserItem cast reconciles ElectroDB optional-map typing vs the hand-authored required-field contract."
  - "getQuotaByType degrades to [] on failure (getUserQuotas throws by design; report must survive quota outage)."
metrics:
  duration: ~20m
  completed: 2026-07-11
  tasks: 3
  files: 5
status: complete
---

# Phase 43 Plan 03: run.human Read-Only Admin Data Helpers Summary

Added the five fan-out-free, server-only read helpers the Phase 43 admin API will join: a RunUser full-table scan, a one-scan userId→{gpx,photo} upload-count map, a new authjs-adapter email lookup + adapterId→OIDC-sub bridge map, a one-scan Bib ownerSub→runnerCode map, and a bulk gpx-usage client for the Plan-01 run.auth endpoint — all typecheck-clean with no schema/GSI change.

## What Was Built

**Task 1 — `run-user.ts` + `user-upload.ts` (commit `82e70f26`)**
- `scanAllRunUsers(): Promise<RunUserItem[]>` — `RunUser.scan.go({ pages: "all" })`; ElectroDB auto-filters to the RunUser entity. Cast to `RunUserItem[]` (see decision below).
- `scanAllUploads(): Promise<Record<string, { gpx: number; photo: number }>>` — ONE `UserUpload.scan.go({ pages: "all" })` reduced to a per-user count map keyed by `uploadType`. This is the fan-out-free replacement for a per-user `listUploadsByUser` loop (all existing readers are userId-partitioned and page-capped at ~20, so they cannot produce a cross-user total count).

**Task 2 — `auth-user.ts` NEW (commit `501eed04`)**
- `getAuthUserEmail(userId)` — direct `dynamodbClient.get` on `pk=sk=USER#{id}`, `ProjectionExpression: "email"`, with a GSI1 fallback (`GSI1PK=USER#{id}`).
- `getAuthUserEmails(userIds)` — sequential resolution → `userId→email|null` map; centralizes the key logic so Plan 04 never re-derives it.
- `scanAccountSubs()` — ONE paginated scan of `ACCOUNT#run.defcon.run#` items projecting `userId, providerAccountId` → adapterUserId→OIDC-sub map. This is the namespace bridge (run.human adapter uuid ↔ run.bib OIDC sub).

**Task 3 — `bib.ts` + `quota-client.ts` (commit `f23dc978`)**
- `scanRunnerCodesBySub()` — ONE `Bib.scan.go({ pages: "all" })` reduced to `ownerSub→runnerCode` (rows without a code skipped). `getRunnerCode` + the Bib entity untouched. Plan 04 composes this with `scanAccountSubs` for per-user bib codes with zero per-row `resolveOidcSub`.
- `getQuotaByType(quotaId)` — calls `/api/internal/quota/by-type/{quotaId}` via the existing `quotaRequest` (attaches `X-Internal-Secret` + private auth base URL); wrapped in try/catch that degrades to `[]` on failure. Added a `QuotaByTypeRow` interface matching the endpoint's bare-array contract.

## USER#-Key Decision

Task 2 required confirming the authjs `USER#` sort-key shape. I did NOT invent it — I anchored on two in-repo proofs:
- `entities/bib.ts:60-69` (`resolveOidcSub`) confirms the authjs base table keys users under `pk = USER#{adapterUserId}` and stores account records at `sk = ACCOUNT#{provider}#{sub}` with `userId` + `providerAccountId` attributes.
- `api/internal/user/[oidcSub]/route.ts` confirms account records are indexed on `GSI1` (`GSI1PK=ACCOUNT#{provider}`) and carry a `userId` attribute linking to the adapter user.

The `@auth/dynamodb-adapter` default stores the **user** record at `pk = sk = USER#{id}`. I used the direct get on that key. Because I could not hit a live record from this typecheck-only environment, I **wired the GSI1 fallback the plan mentions** (`GSI1PK=USER#{id}`, `begins_with(GSI1SK, USER#)`) so a base-`sk` shape drift degrades to a second indexed lookup rather than a silent `null`. `scanAccountSubs` projects the account record's own `userId` attribute (not a parsed pk), which is the shape the internal user route already relies on.

## Verify-Gate Results

All three `<verify>` gates passed (Node v23.6.0). grep assertions all matched. `npx tsc --noEmit` is clean for every new/edited file (`run-user.ts`, `user-upload.ts`, `auth-user.ts`, `bib.ts`, `quota-client.ts`). The only remaining tsc errors are the two documented pre-existing baseline items (`components/header/dropdown-user.tsx` missing svg decl; `entities/__tests__/checkin.test.ts` ElectroDB typing) — both out of scope and untouched.

## Deviations from Plan

**1. [Rule 3 — Blocking type friction] `RunUserItem` cast in `scanAllRunUsers`**
- **Found during:** Task 1 tsc gate.
- **Issue:** ElectroDB infers `meshtasticRadios` map subfields (`id`, `nodeId`, …) as optional, whereas the hand-authored `RunUserItem` marks them required → `TS2322` on `return result.data`.
- **Fix:** `return result.data as RunUserItem[]` (same entity, reconciled to the declared external contract) with an explanatory comment. No runtime behavior change.
- **Commit:** `82e70f26`

No other deviations. No architectural changes, no new packages, no schema/GSI changes.

## Threat Model Compliance

- **T-43-03 (PII disclosure):** `getAuthUserEmail`/`getAuthUserEmails` return full emails only from server modules (`entities/`), `ProjectionExpression`-limited to `email`; file header documents server-only + never-import-into-client. Masking enforced downstream (Plan 04).
- **T-43-04 (enumeration):** scan + email map are server-only building blocks; no unauthenticated entry point added.
- **T-43-05 (spoofing):** `getQuotaByType` reuses `quotaRequest` (internal secret); no new auth surface.
- **T-43-SC:** no new npm packages.

No new threat surface introduced beyond the register.

## Known Stubs

None — all helpers are fully wired reads; assembly/masking/CSV are intentionally deferred to Plan 04 per the plan's objective.

## Self-Check: PASSED
- FOUND: apps/run.human/webapp/src/entities/auth-user.ts
- FOUND commits: 82e70f26, 501eed04, f23dc978
