---
phase: 37-bib-donate-sponsor-proof-surface
plan: 03
subsystem: ui
tags: [copy-catalog, useCopy, react, nextjs, i18n, donate, stripe]

# Dependency graph
requires:
  - phase: 37-01
    provides: authored copy-snapshot.json keys (bib.donate.*, bib.checkout.*, bib.status.*, bib.contribution.donateVerb) + client import boundary test (Test C)
  - phase: 36
    provides: CopyProvider/useCopy client toolkit + copy-core t/interpolate + copy-snapshot floor
provides:
  - DonateModal reads all visible copy from the catalog via useCopy(), including the runtime-interpolated submit CTA (SC-2)
  - StripeStatusBanner success/cancel sentences resolve from bib.status.* via useCopy() (SC-2 confirmation surface)
  - PledgeTagline resolves from bib.status.pledgeTagline via useCopy()
  - The single "Donate $" chrome trigger (desktop header + mobile menu) resolves from bib.donate.trigger (D-07)
affects: [37-04, 37-05, 37-06, phase-39-chrome-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client component copy: const { t } = useCopy(); t('bib.<key>', { vars }) resolved at render/handler time"
    - "Interpolated CTA composed inside the component: t('bib.checkout.cta', { label: t('bib.contribution.donateVerb'), amount: displayAmount })"
    - "Provider pill [value,label] tuples mapped through t() so labels stay catalog-driven"

key-files:
  created: []
  modified:
    - apps/run.bib/webapp/src/components/DonateModal.tsx
    - apps/run.bib/webapp/src/components/StripeStatusBanner.tsx
    - apps/run.bib/webapp/src/components/PledgeTagline.tsx
    - apps/run.bib/webapp/src/components/header.tsx
    - apps/run.bib/webapp/src/components/menu-dropdown.tsx

key-decisions:
  - "Interpolated submit CTA composed in-component via nested t() calls (label + amount) rather than string concatenation (SC-2)"
  - "{detail} error token and all aria-labels left literal per D-03; only the user-facing error SENTENCE migrated"
  - "Rephrased descriptive docstring comments that echoed the migrated literals (Just donate / You promised) so the plan's negative acceptance greps pass and comments reflect the new catalog-driven reality"

patterns-established:
  - "Pattern 1: D-07 chrome seam — header.tsx/menu-dropdown.tsx touch exactly one key (bib.donate.trigger) and nothing else; textValue a11y prop untouched"
  - "Pattern 2: run.bib DonateModal intentionally diverges from run.human/run.flash copies (D-09) — catalog is now run.bib's source of truth; do NOT re-sync"

requirements-completed: [MIGR-01]

coverage:
  - id: D1
    description: "DonateModal title/subhead/labels/slider-helper/payment-method/provider-pills/provider-note/error + interpolated submit CTA resolve through useCopy() (SC-1/SC-2)"
    requirement: MIGR-01
    verification:
      - kind: unit
        ref: "src/__tests__/copy-catalog-bib.test.ts (catalog keys present) + src/__tests__/copy-provider.test.tsx (useCopy resolution/interpolation)"
        status: pass
      - kind: other
        ref: "cd apps/run.bib/webapp && grep -c useCopy + grep -c bib.checkout.cta + negative greps (Just donate/Payment method gone) + npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D2
    description: "StripeStatusBanner success/cancel + PledgeTagline resolve from bib.status.* via useCopy()"
    requirement: MIGR-01
    verification:
      - kind: other
        ref: "grep -c bib.status.paymentSuccess + bib.status.pledgeTagline; negative grep (Checkout cancelled gone); npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D3
    description: "The one chrome 'Donate $' trigger (desktop header + mobile menu) resolves from bib.donate.trigger; no other chrome copy changed (D-07)"
    requirement: MIGR-01
    verification:
      - kind: other
        ref: "grep -c bib.donate.trigger in both files; anchored negative greps; git diff confirms only import+hook+trigger changed; npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D4
    description: "No 'use client' donate file imports the server-only @/lib/copy resolver (T-37-03); no dangerouslySetInnerHTML (T-37-02)"
    requirement: MIGR-01
    verification:
      - kind: other
        ref: "grep -L '@/lib/copy\"' across all 5 touched files (none import it); grep dangerouslySetInnerHTML (none)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Live CMS edit → rendered wording changes within the propagation window (SC-3) on the deployed donate surface"
    verification: []
    human_judgment: true
    rationale: "Requires a running deploy + operator write-token CMS edit + visual confirmation of the rendered modal/banner — not exercisable in unit tests."

# Metrics
duration: 6min
completed: 2026-07-06
status: complete
---

# Phase 37 Plan 03: Bib Donate/Sponsor Proof Surface (Client) Summary

**The run.bib donate modal, Stripe status banner, pledge tagline, and the "Donate $" chrome trigger now resolve all visible copy from the catalog via useCopy() — including the runtime-interpolated submit CTA `t('bib.checkout.cta', { label, amount })` (SC-2).**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-06T02:17:42Z
- **Completed:** 2026-07-06T02:23:43Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- DonateModal: title/subhead/amountLabel → `bib.donate.*`; slider helper, payment-method label, Card/Cash App/Venmo pills, organizer-confirm note, redirecting state, and error sentence → `bib.checkout.*`; submit CTA interpolates `bib.checkout.cta` with `{ label: t('bib.contribution.donateVerb'), amount: displayAmount }` at render time (SC-2).
- StripeStatusBanner + PledgeTagline resolve their success/cancel/pledge sentences from `bib.status.*` via useCopy(); dismiss-on-interaction and rain-store subscription behaviour untouched.
- The single `"Donate $"` trigger label migrated to `bib.donate.trigger` in the desktop header and the mobile menu — the only chrome strings this phase touches (D-07); everything else in those two files stays literal for Phase 39.
- All 22 copy-toolkit unit tests pass; `npx tsc --noEmit` clean; client import boundary (T-37-03) and no-`dangerouslySetInnerHTML` (T-37-02) both verified.

## Task Commits

Each task was committed atomically:

1. **Task 1: DonateModal copy via useCopy** - `9309133e` (feat)
2. **Task 2: StripeStatusBanner + PledgeTagline via useCopy** - `cbc62a10` (feat)
3. **Task 3: Migrate ONLY the "Donate $" trigger label (D-07)** - `8981591f` (feat)

_Note: TDD tasks may have multiple commits (test → feat → refactor). This plan was not TDD._

## Files Created/Modified
- `apps/run.bib/webapp/src/components/DonateModal.tsx` - All visible modal copy + interpolated CTA now catalog-driven via useCopy(); aria + checkout/fetch logic unchanged.
- `apps/run.bib/webapp/src/components/StripeStatusBanner.tsx` - Success/cancel message from `bib.status.paymentSuccess`/`paymentCancel`.
- `apps/run.bib/webapp/src/components/PledgeTagline.tsx` - Tagline from `bib.status.pledgeTagline`.
- `apps/run.bib/webapp/src/components/header.tsx` - Desktop trigger → `t('bib.donate.trigger')` (D-07; nothing else changed).
- `apps/run.bib/webapp/src/components/menu-dropdown.tsx` - Mobile trigger → `t('bib.donate.trigger')` (D-07; `textValue="Donate"` a11y prop untouched).

## Decisions Made
- Composed the interpolated submit CTA in-component with nested `t()` calls (`label` from `bib.contribution.donateVerb`, `amount` from `displayAmount`) instead of string concatenation — satisfies SC-2 and keeps the verb catalog-driven.
- Per D-03, the `{detail}` error token and every aria-label stay literal; only the user-facing error/success/cancel SENTENCE migrated.
- Rephrased three docstring comments that quoted the now-removed literals ("Just donate", "OK! You promised 🙏") so the plan's anchored negative acceptance greps (`! grep -q ...` over the whole file) pass and the comments describe the new catalog-driven behaviour.

## Deviations from Plan

None - plan executed exactly as written. (The docstring-comment rephrasings above are in service of the plan's own acceptance greps, not scope changes: no behaviour, logic, or non-trigger chrome copy was altered.)

## Issues Encountered
- First Task 3 commit attempt was issued after a `cd` into the sibling main-repo checkout (`/Users/khundeck/working/defcon.run.34`) rather than this `cms` worktree; git correctly staged nothing there and refused an empty commit, so nothing landed on `main`. Re-ran the commit from the worktree default cwd — landed on `gsd/phase-37-bib-donate-sponsor-proof-surface` as `8981591f`. Restored the incidental `tsconfig.tsbuildinfo` build-cache churn to keep the tree clean.

## User Setup Required
None - no external service configuration required. (SC-3 live-CMS-edit proof is a UAT item, not a setup step.)

## Next Phase Readiness
- Client half of the copy toolkit is proven on the hardest surface (client, interpolated, modal-heavy): remaining Wave 2 plans (37-04/05/06) can follow the same `useCopy()` pattern.
- Phase 39 owns the rest of `header.tsx`/`menu-dropdown.tsx` chrome (the documented D-07 seam) plus footer/user-dropdown.
- run.human/run.flash DonateModal copies now intentionally diverge from run.bib (D-09) — deferred to MIGR-04/v2; do not re-sync.

## Self-Check: PASSED

All 5 modified files present on disk; all 3 task commits (`9309133e`, `cbc62a10`, `8981591f`) found in git history.

---
*Phase: 37-bib-donate-sponsor-proof-surface*
*Completed: 2026-07-06*
