---
phase: 39-copy-migration-remaining-bib-shared-chrome
plan: 01
subsystem: run.bib copy toolkit (authoring + import tooling)
tags: [copy-catalog, migration, snapshot-floor, import-script, MIGR-02, MIGR-03]
requires:
  - Phase 37-01 snapshot/import/test triad (bib.* floor + copy:import + guard test)
  - Phase 35 namespace enum [common, human, auth, gpx, bib, flash]
provides:
  - run.bib copy-snapshot.json `default` floor for all remaining bib.* + full common.* union
  - namespace-aware copy:import (one run seeds common.* and bib.* under correct namespaces)
  - REQUIRED_BIB_KEYS + REQUIRED_COMMON_KEYS guard contract (red/green floor for Wave 2)
affects:
  - 39-02 (authors byte-identical common.* subset into run.human snapshot)
  - 39-03 (wires bib chrome to common.*)
  - 39-04 (wires TransactionHistory -> bib.txn.*, AdminActions -> bib.admin.*)
  - 39-06 (verifies bib/human common.* subsets are byte-identical)
tech-stack:
  added: []
  patterns:
    - per-key namespace derivation from dotted-key prefix, enum-guarded
    - snapshot `default` map as offline source-of-truth floor (D-07)
key-files:
  created: []
  modified:
    - apps/run.bib/webapp/src/lib/copy-snapshot.json
    - apps/run.bib/webapp/scripts/import-copy.mjs
    - apps/run.bib/webapp/src/__tests__/copy-catalog-bib.test.ts
decisions:
  - Floor keys scoped to exactly what Wave 2 (39-03/39-04) consumes — chrome common.*, bib.txn.*, bib.admin.* — not the whole bib surface; admin dashboard/access-denied/signin/silent-callback prose stays literal (not migrated surfaces, so SC-1 holds).
  - common.header.donate re-homed as the shared chrome key; bib.donate.trigger left seeded (D-07) so nothing breaks before 39-04 re-points bib's header/menu.
metrics:
  duration: ~5m
  completed: 2026-07-06
  tasks: 3
  files: 3
  commits: 4
status: complete
---

# Phase 39 Plan 01: Author Remaining Bib + Shared Chrome Copy Floor Summary

Authored the offline source-of-truth floor (D-07) for everything Phase 39 migrates on the run.bib side — the remaining `bib.txn.*` / `bib.admin.*` prose (MIGR-02) plus the full shared `common.*` chrome union (MIGR-03) — into run.bib's `copy-snapshot.json`, made `copy:import` derive each row's Strapi namespace per-key from the dotted-key prefix (enum-guarded), and extended the key-floor guard test into the red/green contract the Wave 2 wiring plans build against. No component was wired (that is 39-03/39-04); no rendered pixels moved (values byte-identical to on-screen text).

## What Was Built

### Task 1 — remaining bib.* prose floor (commit 21427ab7)
Added to the snapshot `default` map and to the `REQUIRED_BIB_KEYS` guard contract:
- **bib.txn.*** (TransactionHistory.tsx): `totalContributed`, `kindBib` ("Bib"), `kindDonation` ("Donation"), `inProgress` ("In progress"), `reconcileNote` (the Venmo/Cash App note).
- **bib.admin.*** (AdminActions.tsx): `failText`, `dedupedText`, `approve` ("Approve"), `paid` ("PAID"), `alreadyBooked` ("Already booked."), `reject` ("Reject"), `rejectConfirm` (the window.confirm reject sentence).

### Task 2 — shared common.* chrome union (commit 853d1a10)
Added the full `common.header.*` / `common.profileMenu.*` / `common.footer.*` union (17 keys) with a new `REQUIRED_COMMON_KEYS` contract + `Test A2`. De-dup vs per-variant rule applied so no visible word changes: identical strings collapse to one shared key (Maps/Meshtastic/Bib/Donate $/Profile/My Bib/CMS/GPS Check-in/Show My QR); words that differ keep distinct keys (`admin`="Admin", `myBibMobile`="My bib", `adminReports`="Admin reports", `signOut`="Sign out", `logout`="Logout"). Both apps carry the full union as their offline floor (D-07), so run.human-only chrome (`whoami`/`faq`/`credits`/`logout`) is seeded into bib too. `common.header.donate`="Donate $" re-homes the donate trigger; `bib.donate.trigger` stays seeded (unchanged) until 39-04 re-points bib's header/menu.

### Task 3 — namespace-aware import (commit 4015f2da)
Replaced the hardcoded `NAMESPACE = "bib"` POST constant with `namespaceForKey(key) = key.split('.')[0]`, validated against `NAMESPACE_ENUM = {common,human,auth,gpx,bib,flash}`. An unknown prefix is skipped + logged (never POSTed — T-39-02). One import now seeds common.* and bib.* rows under correct namespaces. All token-safety properties preserved verbatim.

## Deviations from Plan

None — plan executed exactly as written. Rules 1–4 not triggered.

## SC-1 Exclusion Set (literals intentionally left un-migrated)

Per D-04, these visible/near-visible strings are deliberately NOT catalogued. The Wave 2 wiring scope is exactly the chrome (39-03) + TransactionHistory + AdminActions (39-04); surfaces outside that are not "migrated surfaces", so SC-1 ("no inline string literals left on migrated surfaces") holds.

**On the migrated components, kept literal (aria / data-value / numeric / error-detail — carries 37 D-03):**
- TransactionHistory.tsx: aria-label `"Your contributions"`; the `· {provider}` data value; `usd()` / `fmtDate()` formatted numerics.
- AdminActions.tsx: all aria-labels (`"Amount in cents"`, `"Approve payment"`, `"Mark paid in person"`, `"Reject bib"`); HTTP/`{detail}`/error-DETAIL interpolation tokens.

**Brand tokens (D-02, stay literal):**
- footer wordmark `"defcon.run 34"`; header wordmark `"defcon.run"`; version tooltip `"DC34 {version}"`.

**Surfaces NOT in Wave 2 scope (deferred, remain literal — not migrated surfaces):**
- `src/app/admin/page.tsx`: "Bib Admin", section titles (Print-name list / Payments · revenue / Outstanding + in-person / All registrations), empty states "no bibs paid yet" / "no donations yet", "Admin access required", "Your account is not in the admin group. Ask an organizer…". (39-04 wires AdminActions.tsx only, not the dashboard page.)
- `src/app/access-denied/page.tsx`: "Access Denied", the access-explanation prose, "Contact an administrator to request access.", "Return Home".
- `src/app/signin/page.tsx`: "Redirecting to defcon.run login…" (transitional redirect).
- `src/app/silent-callback/page.tsx`: "Completing sign-in…" (transitional).

## Verification

- `npx vitest run src/__tests__/copy-catalog-bib.test.ts` → 9 passed (key floor for all new bib.* + common.* keys; interpolation-shape tests; server->client token-boundary test) — run under node v23.6.0 (v22 hits an ERR_REQUIRE_ESM in vitest config; documented project constraint).
- `split('.')` namespace derivation present outside comments; no `filters[locale]` query key in any request URL (only in the explanatory comment).
- Missing-env guard: `env -u STRAPI_WRITE_TOKEN -u CMS_INTERNAL_URL node scripts/import-copy.mjs` exits 1 with a one-line reason, no CMS call.
- Namespace derivation sanity: `common`->true, `bib`->true, unknown->false (skipped).
- No rendered string values changed (byte-identical to current on-screen text); `bib.donate.trigger` still "Donate $".

## Known Stubs

None. This plan authors data + tooling only; it wires no components (by design — Wave 2).

## Self-Check: PASSED

- copy-snapshot.json, import-copy.mjs, copy-catalog-bib.test.ts all present and modified.
- Commits 21427ab7, 853d1a10, 4015f2da present in git log.
