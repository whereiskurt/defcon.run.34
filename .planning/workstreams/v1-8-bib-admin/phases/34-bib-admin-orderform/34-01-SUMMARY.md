---
phase: 34-bib-admin-orderform
plan: 01
subsystem: api
tags: [next, react, zod, electrodb, dynamodb, admin, payments, vitest]

# Dependency graph
requires:
  - phase: 22-05
    provides: admin-reports buildReports/loadReports, Bib.applyPayment, GeneralDonation.recordDonation, PendingContribution helpers, quota-client
provides:
  - "isRegistered(bib) predicate + phantom-bib filtering of admin totals.bibs and the registrations roster"
  - "OutstandingRow pending-intent rows carry pendingId/ownerSub/kind; RegistrationRow carries ownerSub"
  - "POST /api/admin/bib/reconcile (admin-gated, zod-validated, per-kind idempotent)"
  - "POST /api/admin/bib/reject (admin-gated; deletes bib, clears pendings, restores quota; donations survive)"
  - "AdminActions.tsx (ReconcileAction, RejectAction) wired into the /admin Outstanding + roster tables"
affects: [34-02, 34-03, bib-admin, orderform]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Admin-gated mutation route: requireAdmin(await auth()) → 401 no_session / 403 not_admin before any work"
    - "Per-kind reconcile idempotency: bib via reconciled_via marker, donation via deterministic donationId PK"
    - "Server-component table renders inline client-action cells via React.ReactNode[][] rows"

key-files:
  created:
    - apps/run.bib/webapp/src/app/api/admin/bib/reconcile/route.ts
    - apps/run.bib/webapp/src/app/api/admin/bib/reject/route.ts
    - apps/run.bib/webapp/src/components/AdminActions.tsx
  modified:
    - apps/run.bib/webapp/src/lib/admin-reports.ts
    - apps/run.bib/webapp/src/__tests__/admin-reports.test.ts
    - apps/run.bib/webapp/src/app/admin/page.tsx

key-decisions:
  - "Amount input holds integer cents (cents-int discipline) prefilled from the intent's amountCents, matching 34-UI-SPEC.md"
  - "Reject clears pendings by iterating both kinds × both providers via clearPendingForOwner (best-effort, swallowed errors)"
  - "printNames / inPersonPledges / bibCollectedCents still read the full bib list; only totals.bibs + roster are filtered"

patterns-established:
  - "isRegistered predicate is the single source of truth for 'a bib counts' across totals + roster"
  - "Inline admin actions refresh the server component on success and surface a non-refreshing inline error on failure"

requirements-completed: [BIB-ADM-01, BIB-ADM-02, BIB-ADM-03, BIB-ADM-09]

coverage:
  - id: D1
    description: "Empty visit-created bibs are excluded from admin totals.bibs and the registrations roster (SC34.1)"
    requirement: "BIB-ADM-01"
    verification:
      - kind: unit
        ref: "src/__tests__/admin-reports.test.ts#registrations lists only registered bibs (empty phantom excluded)"
        status: pass
      - kind: unit
        ref: "src/__tests__/admin-reports.test.ts#totals sum correctly (bibs counts only registered)"
        status: pass
      - kind: unit
        ref: "src/__tests__/admin-reports.test.ts#isRegistered()"
        status: pass
    human_judgment: false
  - id: D2
    description: "Pending-intent OutstandingRows carry pendingId/ownerSub/kind and RegistrationRows carry ownerSub for the inline actions"
    requirement: "BIB-ADM-02"
    verification:
      - kind: unit
        ref: "src/__tests__/admin-reports.test.ts#pending-intent outstanding rows carry pendingId, ownerSub and kind"
        status: pass
      - kind: unit
        ref: "src/__tests__/admin-reports.test.ts#registration rows carry ownerSub for the reject action"
        status: pass
    human_judgment: false
  - id: D3
    description: "POST /api/admin/bib/reconcile applies a pending Venmo/Cash App intent, admin-gated, zod-validated, per-kind idempotent (SC34.2)"
    requirement: "BIB-ADM-02"
    verification:
      - kind: automated
        ref: "npx tsc --noEmit + npx next build (route type-checks and compiles)"
        status: pass
    human_judgment: true
    rationale: "No route-level unit tests in this plan; the reconcile write path (applyPayment/recordDonation against DynamoDB, idempotency, 401/403 gating) needs a manual admin walkthrough to confirm end-to-end behavior."
  - id: D4
    description: "POST /api/admin/bib/reject deletes the bib + owner pendings and restores bibname_change quota while donations survive (SC34.3)"
    requirement: "BIB-ADM-03"
    verification:
      - kind: automated
        ref: "npx next build (route type-checks and compiles)"
        status: pass
    human_judgment: true
    rationale: "Destructive delete + cross-service quota restore has no unit coverage here; requires a manual admin verification that the bib is removed, quota reset, and donations retained."
  - id: D5
    description: "AdminActions (Approve editable-amount + Reject-behind-confirm) render in the admin tables and refresh on success (SC34.2/SC34.3, IC-4)"
    requirement: "BIB-ADM-09"
    verification:
      - kind: automated
        ref: "npx next build succeeds in apps/run.bib/webapp with AdminActions wired into /admin"
        status: pass
    human_judgment: true
    rationale: "Visual/interaction contract (mint Approve pill, destructive Reject, confirm dialog, router.refresh, inline failure text) needs a human UI pass per 34-UI-SPEC.md."

# Metrics
duration: 25min
completed: 2026-07-04
status: complete
---

# Phase 34 Plan 01: Admin — Truthful Dashboard + Reconcile/Reject Summary

**`isRegistered` phantom-bib filtering plus two admin-gated inline actions — reconcile a pending Venmo/Cash App intent (per-kind idempotent) and reject/reset a runner's bib with quota restore — wired into the plain dark-theme /admin tables.**

## Performance

- **Duration:** ~25 min (includes a fresh `npm ci` in the worktree)
- **Completed:** 2026-07-04
- **Tasks:** 3
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- `isRegistered(bib)` exported and used to exclude empty visit-created bibs from `totals.bibs` and the registrations roster (SC34.1), leaving print-names / pledges / $-collected reading the full list intentionally.
- Row action keys threaded through `admin-reports.ts`: pending-intent `OutstandingRow`s carry `pendingId`/`ownerSub`/`kind`; `RegistrationRow` carries `ownerSub`.
- New admin-gated `POST /api/admin/bib/reconcile` — zod-validated, per-kind idempotent (bib via `reconciled_via`, donation via `donationId` PK), defensively clears the pending hint.
- New admin-gated `POST /api/admin/bib/reject` — deletes the bib, clears the owner's pending intents across both kinds × providers, restores `bibname_change` quota in an isolated try/catch; donations survive.
- `AdminActions.tsx` (`ReconcileAction`, `RejectAction`) wired into the Outstanding + All-registrations tables; `/admin` stays a server component rendering `React.ReactNode[][]` rows.

## Task Commits

Each task was committed atomically:

1. **Task 1: Filter empty bibs + carry action keys (TDD)** - `27f5ac7f` (feat)
2. **Task 2: Admin reconcile + reject API routes** - `59ecdd37` (feat)
3. **Task 3: AdminActions component + wire into admin tables** - `d4d0a60c` (feat)

_Task 1 followed TDD (RED assertions added first, confirmed failing, then implementation → GREEN) within a single commit._

## Files Created/Modified
- `apps/run.bib/webapp/src/lib/admin-reports.ts` - `isRegistered` predicate; filtered totals.bibs + roster; new OutstandingRow/RegistrationRow/PendingLike fields.
- `apps/run.bib/webapp/src/__tests__/admin-reports.test.ts` - Empty-bib exclusion, row-key, and `isRegistered` unit tests.
- `apps/run.bib/webapp/src/app/api/admin/bib/reconcile/route.ts` - Admin reconcile route.
- `apps/run.bib/webapp/src/app/api/admin/bib/reject/route.ts` - Admin reject route.
- `apps/run.bib/webapp/src/components/AdminActions.tsx` - Client ReconcileAction + RejectAction.
- `apps/run.bib/webapp/src/app/admin/page.tsx` - Action columns; ReactNode[][] Table rows.

## Decisions Made
- Amount input carries integer cents (matches the monospace table cells and 34-UI-SPEC "cents-int discipline") rather than a dollar field; the server re-validates `amountCents` as `int().positive()`.
- Reject clears pending intents by iterating both `PENDING_KINDS` × `PENDING_PROVIDERS` via the existing `clearPendingForOwner` helper (best-effort, errors swallowed) instead of importing the entity for a raw scan-delete.

## Deviations from Plan

None - plan executed exactly as written. Automated verifications (`npx vitest run`, `npx tsc --noEmit`, `npx next build`) all pass.

## Issues Encountered
- The worktree had an empty `node_modules`; ran `npm ci` (v23.6.0) to install the committed lockfile before tests/build. No source impact. `tsconfig.tsbuildinfo` (a tracked build artifact) was left unstaged, out of task scope.

## User Setup Required
None - reconcile/reject use the existing `AUTH_INTERNAL_SECRET` quota hop already configured for run.bib; no new env or external service.

## Next Phase Readiness
- Slice A (admin) shipped; Slice B (orderform UX) and Slice C (social QR) remain for 34-02 / 34-03.
- Route write paths (reconcile/reject) and the AdminActions UI carry no unit coverage in this plan — flagged `human_judgment: true` for a manual admin walkthrough in verify-work.

## Self-Check: PASSED

All created files present on disk; all four commits (`27f5ac7f`, `59ecdd37`, `d4d0a60c`, `0105e692`) verified in git history.

---
*Phase: 34-bib-admin-orderform*
*Completed: 2026-07-04*
