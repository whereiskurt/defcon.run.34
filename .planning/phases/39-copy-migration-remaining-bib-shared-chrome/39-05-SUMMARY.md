---
phase: 39-copy-migration-remaining-bib-shared-chrome
plan: 05
subsystem: ui
tags: [copy-catalog, useCopy, next, react, heroui, strapi, run.human]

# Dependency graph
requires:
  - phase: 39-02
    provides: run.human copy toolkit (copy-core, CopyProvider/useCopy) + copy-snapshot.json common.* floor + guard test
  - phase: 39-03
    provides: run.bib chrome now reads the SAME common.* keys (shared de-dup surface)
provides:
  - run.human header nav + Donate sibling render from common.header.* via useCopy()
  - run.human mobile dropdown-menu renders from common.header.* via useCopy()
  - run.human profile dropdown-user renders from common.profileMenu.* (per-variant Logout) via useCopy()
  - run.human footer FAQ/Credits render from common.header.faq / common.footer.credits via useCopy()
  - SC-3 made LIVE and demonstrable — one CMS edit to a shared common.* row changes wording in BOTH run.human and run.bib
affects: [39-06, MIGR-04, copy-usage-index]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client chrome resolves labels via useCopy().t('common.*') at render (no shared React component; catalog is the shared surface)"
    - "Per-variant keys preserve each app's current word verbatim (run.human common.profileMenu.logout vs run.bib common.profileMenu.signOut — no forced merge, no visible change)"

key-files:
  created: []
  modified:
    - apps/run.human/webapp/src/components/header/header.tsx
    - apps/run.human/webapp/src/components/header/dropdown-menu.tsx
    - apps/run.human/webapp/src/components/header/dropdown-user.tsx
    - apps/run.human/webapp/src/components/footer.tsx

key-decisions:
  - "Added a labelKey field to header.tsx navItems so t() resolves at render while keeping the label==='Bib' donate-sibling check stable"
  - "Logout modal + QR modal prose left literal (deep modal/client-state surfaces scoped to MIGR-04, D-06 bias-to-defer)"
  - "Brand wordmark ('defcon.run 34', teal dot) left literal (D-02 brand token)"
  - "No new human.* keys authored — 39-02 snapshot carries ONLY the common.* union (D-06); guard test enforces zero non-common keys"

patterns-established:
  - "Shared-catalog de-dup: two apps read byte-identical common.* keys so a single CMS row edit repricing wording flows to both with no deploy"

requirements-completed: [MIGR-03]

coverage:
  - id: D1
    description: "run.human header nav (Maps/Meshtastic/Bib) + Donate sibling render from common.header.* via useCopy()"
    requirement: "MIGR-03"
    verification:
      - kind: unit
        ref: "src/lib/__tests__/copy-catalog-human.test.ts (Test A common.* key-floor)"
        status: pass
      - kind: other
        ref: "grep common.header.donate src/components/header/header.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "run.human mobile dropdown-menu renders Who Am I/Maps/Meshtastic/Bib/Donate/FAQ from common.header.* via useCopy()"
    requirement: "MIGR-03"
    verification:
      - kind: other
        ref: "grep common.header.faq src/components/header/dropdown-menu.tsx"
        status: pass
    human_judgment: false
  - id: D3
    description: "run.human profile dropdown-user renders Profile/My Bib/CMS/GPS Check-in/Show My QR + per-variant Logout from common.profileMenu.* via useCopy()"
    requirement: "MIGR-03"
    verification:
      - kind: other
        ref: "grep common.profileMenu.logout src/components/header/dropdown-user.tsx"
        status: pass
      - kind: integration
        ref: "npx next build (run.human) — Compiled successfully"
        status: pass
    human_judgment: false
  - id: D4
    description: "run.human footer FAQ + Credits render from common.header.faq / common.footer.credits via useCopy()"
    requirement: "MIGR-03"
    verification:
      - kind: other
        ref: "grep common.footer.credits src/components/footer.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "SC-3 LIVE: run.human chrome reads the SAME common.* keys run.bib reads — one CMS edit changes both apps' wording, no visible word change now (words-only)"
    verification: []
    human_judgment: true
    rationale: "Requires a human to edit a shared common.* CMS row and visually confirm the wording changes in BOTH run.human and run.bib chrome with no deploy — cross-app live behavior automation cannot assert"

# Metrics
duration: 3min
completed: 2026-07-06
status: complete
---

# Phase 39 Plan 05: Wire run.human Shared Chrome to Common.* Catalog Summary

**run.human's header nav, mobile menu, profile menu, and footer now resolve every label via useCopy().t() from the SAME common.* keys run.bib reads — making the copy-paste de-dup win (SC-3) live and demonstrable while changing zero visible words.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-06T16:30:35Z
- **Completed:** 2026-07-06T16:33:47Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- header.tsx nav labels (Maps/Meshtastic/Bib) and the "Donate $" sibling button resolve through `t()` from `common.header.*`; `common.header.donate` is the exact key run.bib also reads (the SC-3 cross-app surface).
- dropdown-menu.tsx (mobile) resolves Who Am I / Maps / Meshtastic / Bib / Donate $ / FAQ through `t()` from `common.header.*`.
- dropdown-user.tsx (profile) resolves Profile / My Bib / CMS / GPS Check-in / Show My QR through `common.profileMenu.*` and the per-variant Logout ITEM through `common.profileMenu.logout` (keeps run.human's word "Logout", distinct from bib's "Sign out" — no forced merge).
- footer.tsx resolves FAQ through the shared `common.header.faq` key and Credits through `common.footer.credits`.
- Second reader wired: editing one shared common.* CMS row now changes wording in BOTH run.human and run.bib with no shared component and no deploy.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire run.human header + mobile dropdown-menu to common.* keys** - `6ca587bd` (feat)
2. **Task 2: Wire run.human profile dropdown-user + footer to common.* keys** - `3d215fc2` (feat)

## Files Created/Modified
- `apps/run.human/webapp/src/components/header/header.tsx` - Added useCopy(); nav labels via labelKey→t(), Donate sibling via t('common.header.donate')
- `apps/run.human/webapp/src/components/header/dropdown-menu.tsx` - Added useCopy(); six mobile-menu labels resolve from common.header.*
- `apps/run.human/webapp/src/components/header/dropdown-user.tsx` - Added useCopy(); five profile labels + per-variant Logout item resolve from common.profileMenu.*; Logout/QR modals left literal (MIGR-04)
- `apps/run.human/webapp/src/components/footer.tsx` - Added useCopy(); FAQ + Credits resolve from common.*; brand wordmark left literal

## Decisions Made
- Introduced a `labelKey` field on the header.tsx `navItems` array so labels resolve via `t()` at render while the `label === 'Bib'` guard that appends the Donate sibling stays stable.
- Left the Logout modal ("Logout?" + body sentence) and the QR modal prose literal — deeper modal/client-state surfaces are MIGR-04 scope (D-06 bias-to-defer).
- Left the brand wordmark and aria-labels/textValue/user-data literal (D-02 brand token; words-only migration).
- Authored no new `human.*` keys — the 39-02 snapshot carries only the `common.*` union and the guard test asserts zero non-common keys.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- One Edit for the CMS DropdownItem initially failed to match because it is nested inside a `hasCms ? (...)` ternary with deeper indentation; re-matched against the exact indented text. No behavior impact.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- 39-06 can now verify that run.human's and run.bib's snapshot common.* subsets are byte-identical and that both apps read the shared keys (SC-3 assertion).
- run.human complex surfaces (CheckInModal, dashboard, profile map/history, QR/logout modal prose) remain MIGR-04 — scope fence intact.

## Self-Check: PASSED

---
*Phase: 39-copy-migration-remaining-bib-shared-chrome*
*Completed: 2026-07-06*
