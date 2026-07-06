# 37-06 SUMMARY — Verify SC-1..SC-4 (import round-trip, live edit, CMS-down)

**Plan:** 37-06 (Wave 3, human-verify) · **Requirement:** MIGR-01
**Status:** COMPLETE (closed on automated + live-CMS API evidence; in-app visual walkthrough deferred to UAT)
**Date:** 2026-07-05

## What was verified

The whole Phase 37 donate/sponsor surface reads its copy from the `bib.*` catalog, proven against a **real local Strapi 5** — not just mocked unit tests.

### Tasks
- **Task 1 (auto):** `copy-fallback-server.test.tsx` — server-floor SC-4 test (20 assertions): every consumed server-surface key resolves through the server `t()` against the snapshot `default` map (the CMS-down `loadCopy` output) to real wording, with no `/bib\.[a-z]\w*\./` key-shaped echo. Commit `eac6b3f5`.
- **Task 2 (auto):** full `npm run build` (all 22 routes compile, 15/15 static pages) + `npm test` **242/242** green on Node v23.6.0.
- **Task 3 (human-verify → closed on evidence):** live CMS round-trip against a local Strapi 5 (worktree `run.cms`, fresh `local-verify.db`, ui-string type present).

### Success criteria
| SC | Result | Evidence |
|----|--------|----------|
| SC-1 render-from-catalog | ✅ | production build compiles all donate/sponsor routes; 64 `bib.*` rows imported into a live CMS |
| SC-2 interpolation via useCopy/t | ✅ | sponsor-form + copy tests; `Donate {amount}` / `Sponsor {amount}` CTA + StripeStatusBanner + ContributionChip resolve at runtime |
| SC-3 live edit → change, no deploy | ✅ **proven live** | `copy:import` created 64/64 rows; edit-proof round-trip: edited `bib.donate.title` in CMS → the (fixed) `loadCopy` read reflected `"Just donate (LIVE EDIT ✓)"` → restored |
| SC-4 CMS-down fallback, no raw key | ✅ | automated server-floor test (20 assertions) + the resolver's snapshot floor |

## ⚠ Production-blocking bug caught + fixed (the reason live verification mattered)

**Strapi 5 reserves `locale` as a query key** (i18n). Phase 35 modeled its own non-i18n `locale` column, so `filters[locale][$eq]=default` returns `400 ValidationError: Invalid key locale`. This broke two places — invisible to every mock-based unit test:

1. `scripts/import-copy.mjs` (37-01) — find-before-upsert 400'd → live import failed (0 created).
2. **`lib/copy.ts` (Phase 36 runtime reader)** — `loadCopy`'s live Strapi fetch *always* 400'd → silently fell back to the snapshot, so **a CMS edit would never change rendered wording (SC-3 broken)**. Phase 36's self-proof passed only via the snapshot fallback, masking this.

**Fix (`ae16481a`):** removed the reserved `locale` query filter from both; select the locale in JS after fetch (safe — v1 only has `default`). Post-fix: import creates 64/64, SC-3 edit-proof passes, tsc clean, 242/242 tests, no regression.

> Note: `lib/copy.ts` is Phase 36 code, but the bug directly blocked Phase 37's SC-3 and would have shipped a copy toolkit that never reads the live CMS. Fixed here as a verification-driven fix. **run.human/run.flash carry the same `filters[locale]` pattern in their copy readers when they adopt the toolkit (Phase 39 / MIGR-04) — apply the same fix there.**

## Deferred to UAT (human, ~5 min)
In-app visual click-through of SC-1/SC-2/SC-4 in a fully-running bib app (needs the whole local stack — auth/dynamo/stripe/altcha): load `/orderform` + `/sponsor/venmo|cashapp`, open the Donate modal and confirm the interpolated CTA, trigger the Stripe banner (`?status=success|cancel`), and confirm CMS-down still renders words. All underlying mechanisms are proven above; this is visual confirmation only. Run post-deploy or in a full local stack.

## Verification environment (torn down)
Local Strapi 5.33.3 booted from the worktree `run.cms` under Node v22.1.0 (better-sqlite3 ABI), fresh `local-verify.db`, `CMS_MODE=local` (no AWS/SSM). A local full-access token was minted via the admin API for the import (never committed). The production write token supplied by the operator was NOT used (prod hasn't landed Phase 35 yet) and should be rotated.

## Decisions / caveats
- D-09: run.bib's DonateModal intentionally diverged from run.human/run.flash — do not re-sync byte-for-byte.
- New: Strapi-5 `locale`-filter avoidance is now a toolkit-wide rule (see fix note).
