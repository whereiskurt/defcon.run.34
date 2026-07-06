---
phase: 39-copy-migration-remaining-bib-shared-chrome
plan: 04
subsystem: run.bib copy migration (TransactionHistory + AdminActions wiring)
tags: [copy-catalog, migration, MIGR-02, bib.txn, bib.admin, words-only]
requires:
  - 39-01 authored floor (bib.txn.* + bib.admin.* keys in copy-snapshot.json + guard test)
  - Phase 36 toolkit live in run.bib (loadCopy/t server, useCopy client, CopyProvider)
provides:
  - TransactionHistory reads visible prose from bib.txn.* (async server component)
  - AdminActions reads visible prose from bib.admin.* (client component via useCopy)
  - SC-1 closed for the two 37-deferred bib remaining-copy surfaces
affects:
  - 39-06 (verifies bib migrated surfaces render from catalog, no raw dotted keys)
tech-stack:
  added: []
  patterns:
    - server component -> loadCopy('default') + t(copy, key) (37-04 ContributionChip pattern)
    - client component -> useCopy() bound t (no module-scope copy reads)
key-files:
  created: []
  modified:
    - apps/run.bib/webapp/src/components/TransactionHistory.tsx
    - apps/run.bib/webapp/src/components/AdminActions.tsx
decisions:
  - Renamed the TransactionHistory row-map callback param `t` -> `tx` so it no longer shadows the imported `t` copy resolver (blocking-issue fix, Rule 3).
  - Kept the WR-01 deduped-notice rationale as an inline comment attached to bib.admin.dedupedText after removing the module-scope const.
metrics:
  duration: ~10m
  completed: 2026-07-06
  tasks: 2
  files: 2
  commits: 2
status: complete
---

# Phase 39 Plan 04: Migrate Remaining Bib Copy (TransactionHistory + AdminActions) Summary

Wired run.bib's two 37-deferred remaining-copy surfaces off inline literals onto the `bib.txn.*` / `bib.admin.*` keys authored in 39-01 (MIGR-02, D-04). Words-only: every rendered string is byte-identical to before — only the source of each string changed from an inline literal to a catalog read. `TransactionHistory` (server) resolves via `loadCopy('default') + t(copy, key)`; `AdminActions` (client) resolves via `useCopy()`. Aria-labels, provider/data values, numeric formatting, and fetch/refresh/dedupe logic are untouched (D-04). This closes SC-1 ("no inline string literals left on migrated surfaces") for these two components.

## What Was Built

### Task 1 — TransactionHistory -> bib.txn.* (commit 7bbf8ffd)
Converted `TransactionHistory` to an **async** server component that calls `const copy = await loadCopy("default")` and resolves its four visible-prose strings via `t(copy, key)`:
- "Total contributed" -> `bib.txn.totalContributed`
- row kind "Bib" / "Donation" -> `bib.txn.kindBib` / `bib.txn.kindDonation`
- "In progress" pending badge -> `bib.txn.inProgress`
- the Venmo/Cash App reconcile note -> `bib.txn.reconcileNote` (plain `t()`; the authored value carries no markdown, and `&` renders byte-identically to the prior `&amp;`).

Kept literal (D-04): the `aria-label="Your contributions"`, the `· {t.provider}` data value, and all `usd()` / `fmtDate()` numeric formatting. Layout, styles, and the `{ totalCents, txns }` props shape are unchanged. The only structural change is the `await` — the component was already a server component; its sole external reference (`orderform/page.tsx`) imports only the `type Txn`, not the default export.

### Task 2 — AdminActions -> bib.admin.* (commit f486d8d3)
Added `useCopy()` from `@/components/CopyProvider` to each of the three exported components and resolved visible prose via the bound `t()`:
- `ReconcileAction`: "Approve" -> `bib.admin.approve`, fail -> `bib.admin.failText`, deduped -> `bib.admin.dedupedText`
- `MarkPaidAction`: "PAID" -> `bib.admin.paid`, fail -> `bib.admin.failText`, "Already booked." -> `bib.admin.alreadyBooked`
- `RejectAction`: `window.confirm(...)` sentence -> `bib.admin.rejectConfirm`, "Reject" -> `bib.admin.reject`, fail -> `bib.admin.failText`

The module-scope `FAIL_TEXT` / `DEDUPED_TEXT` constants were removed (a hook cannot be read at module scope); their values now resolve at render through the catalog. The WR-01 rationale for the deduped notice is preserved as an inline comment. Kept literal (D-04): every aria-label (`"Amount in cents"`, `"Approve payment"`, `"Mark paid in person"`, `"Reject bib"`). No fetch URL, request body, `router.refresh()`, or dedupe branch was changed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Variable shadowing between the copy resolver `t` and the row-map callback `t`**
- **Found during:** Task 1
- **Issue:** `TransactionHistory`'s row map used `txns.map((t, i) => ...)`, whose param `t` would shadow the imported `t` copy resolver, breaking `t(copy, "bib.txn.kindBib")` inside the map.
- **Fix:** Renamed the callback param `t` -> `tx` and updated all references (`tx.status`, `tx.kind`, `tx.provider`, `tx.timestamp`, `tx.amountCents`). No behavior change.
- **Files modified:** apps/run.bib/webapp/src/components/TransactionHistory.tsx
- **Commit:** 7bbf8ffd

## SC-1 Exclusion Set (literals intentionally left un-migrated)

Per D-04, on the two migrated components these strings stay literal (aria / data-value / numeric — carries 37 D-03):
- TransactionHistory.tsx: `aria-label="Your contributions"`; the `· {provider}` data value; `usd()` / `fmtDate()` formatted numerics.
- AdminActions.tsx: all aria-labels (`"Amount in cents"`, `"Approve payment"`, `"Mark paid in person"`, `"Reject bib"`). No HTTP/`{detail}` error-DETAIL tokens exist in these components (failures surface the single `bib.admin.failText` line).

Surfaces outside this plan's scope (admin dashboard page, access-denied, signin, silent-callback) remain literal by design — they are not Wave 2 migrated surfaces (see 39-01-SUMMARY SC-1 exclusion set).

## Verification

- `npx vitest run src/__tests__/copy-catalog-bib.test.ts` -> 9 passed (key floor + interpolation-shape + server->client token-boundary guard), run under node v23.6.0 (v22 hits ERR_REQUIRE_ESM in the vitest config — documented project constraint).
- `npx tsc --noEmit` -> exit 0 (full run.bib/webapp typecheck clean; no shadowing, no missing keys).
- Grep: both surfaces read the toolkit — `loadCopy` + `bib.txn` in TransactionHistory.tsx; `useCopy` + `bib.admin` in AdminActions.tsx.
- No module-scope copy reads remain in AdminActions (`FAIL_TEXT` / `DEDUPED_TEXT` gone).
- Words-only: authored snapshot values are byte-identical to the prior on-screen text, so no rendered word changed.

## Known Stubs

None. Both surfaces are fully wired to the authored floor; the toolkit's snapshot floor guarantees a present key never renders as a raw dotted key even if CMS/S3 are down.

## Self-Check: PASSED

- apps/run.bib/webapp/src/components/TransactionHistory.tsx present and modified.
- apps/run.bib/webapp/src/components/AdminActions.tsx present and modified.
- Commits 7bbf8ffd, f486d8d3 present in git log.
