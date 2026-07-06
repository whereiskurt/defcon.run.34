---
phase: 39-copy-migration-remaining-bib-shared-chrome
plan: 03
subsystem: run.bib shared chrome (header / mobile menu / profile menu / footer)
tags: [copy-catalog, migration, common-chrome, MIGR-03, words-only]
requires:
  - 39-01 common.* chrome floor + REQUIRED_COMMON_KEYS guard contract
  - Phase 37 bib copy toolkit (loadCopy/t, CopyProvider/useCopy) already live in bib root layout
provides:
  - run.bib as the first live reader of the unified common.* chrome namespace (half of SC-3 de-dup proof; run.human is 39-05)
  - bib header nav, mobile menu, and profile menu resolving labels via t()/useCopy() from common.* keys
affects:
  - 39-05 (wires run.human chrome to the SAME common.* keys — the other half of SC-3)
  - 39-06 (verifies bib/human common.* subsets byte-identical + live de-dup edit)
tech-stack:
  added: []
  patterns:
    - client chrome resolves labels via useCopy() bound t() against common.* keys
    - navItems carry a labelKey (not a literal label); rendered via t(labelKey)
key-files:
  created: []
  modified:
    - apps/run.bib/webapp/src/components/header.tsx
    - apps/run.bib/webapp/src/components/menu-dropdown.tsx
    - apps/run.bib/webapp/src/components/user-dropdown.tsx
decisions:
  - header navItems refactored from literal `label` to `labelKey` (common.header.*) resolved via t() at render; the Bib donate-sibling detector switched from `label === "Bib"` to `href === "/orderform"` so no nav label literal survives on the rendered elements.
  - donate trigger re-pointed from bib.donate.trigger to common.header.donate (the 39-01 re-homed shared key) in both header.tsx and menu-dropdown.tsx; bib.donate.trigger stays seeded in the snapshot (D-07) so nothing breaks.
  - footer.tsx left unchanged — it carries only the brand wordmark ("defcon.run 34", teal dot) + injected version string, both brand tokens (D-02); no chrome prose to migrate.
metrics:
  duration: ~8m
  completed: 2026-07-06
  tasks: 2
  files: 3
  commits: 2
status: complete
---

# Phase 39 Plan 03: Wire Bib Shared Chrome to common.* Summary

Wired run.bib's shared chrome — header nav, mobile menu-dropdown, and profile user-dropdown — to read their visible labels from the `common.*` catalog keys authored in 39-01, via the client `useCopy()` toolkit (CopyProvider already mounted in bib's root layout from Phase 37). Words-only: every rendered label is byte-identical to before; the change is purely the source (inline literal → `t()` catalog read against `common.header.*` / `common.profileMenu.*`). This makes run.bib the first live reader of the unified `common.*` chrome namespace — half of the SC-3 de-dup proof (run.human is the other half, 39-05).

## What Was Built

### Task 1 — bib header + mobile menu-dropdown (commit 0bf600f7)
- **header.tsx**: `navItems` refactored from a literal `label` field to a `labelKey` field (`common.header.maps` / `common.header.meshtastic` / `common.header.bib`), rendered via `t(labelKey)`. The Bib donate-sibling detector switched from `label === "Bib"` to `href === "/orderform"` so no rendered nav label literal remains. The "Admin" desktop link resolves via `t("common.header.admin")`. The donate trigger button re-pointed from `t("bib.donate.trigger")` to `t("common.header.donate")`.
- **menu-dropdown.tsx**: mobile item labels resolve via `t()` — "My bib" → `common.header.myBibMobile`, Maps/Meshtastic → `common.header.maps` / `common.header.meshtastic`, the donate item → `common.header.donate`, and the admin item "Admin reports" → `common.profileMenu.adminReports`. `textValue` attributes left literal (a11y/list-key values, D-04); icons and onPress behavior untouched.

### Task 2 — bib profile user-dropdown (commit 9ec3f2f9)
- **user-dropdown.tsx**: added `import { useCopy } from "@/components/CopyProvider"` and `const { t } = useCopy()`. All seven visible profile-menu labels resolve via `t()` from `common.profileMenu.*`: Profile → `profile`, My Bib → `myBib`, CMS → `cms`, Admin reports → `adminReports`, GPS Check-in → `gpsCheckin`, Show My QR → `showQr`, Sign out → `signOut`. Client-safe import boundary preserved (only `useCopy` from CopyProvider/copy-core, never the server-only `@/lib/copy` resolver — T-39-08).

## Footer Coverage Decision (SC-1 accounting)

`footer.tsx` was left **unchanged**. Its only text is the brand wordmark ("defcon.run 34" with teal dot) and the injected `versionTooltip` string. Per D-02 the wordmark is a documented brand token (stays literal), and the version string is a runtime-injected value, not chrome prose. bib's footer has **no FAQ/Credits/nav prose to migrate**, so SC-1's footer coverage is explicitly accounted for: there is nothing to catalog on this surface. (`common.footer.credits` exists in the floor for run.human's richer footer, wired in 39-05.)

## Deviations from Plan

None — plan executed exactly as written. Rules 1–4 not triggered. The one design choice made within planner discretion (switching the Bib donate-sibling detector from `label === "Bib"` to `href === "/orderform"`) was necessary to eliminate the last rendered nav label literal per the acceptance criteria, and is documented above as a decision rather than a deviation.

## Literals Intentionally Left (per D-04 / D-02)

- **aria-labels**: header/menu/dropdown aria-labels ("Navigation menu", "User menu", section aria labels "Profile" / "Check-in & QR" / "Sign out") stay literal.
- **textValue attributes**: menu/dropdown `textValue` (list-key / a11y values) stay literal.
- **brand tokens**: header wordmark ("defcon.run"), footer wordmark ("defcon.run 34"), version tooltip ("DC34 {version}").
- **user data**: runner name/email in the dropdown top content.

## Verification

- `npx vitest run src/__tests__/copy-catalog-bib.test.ts` → **9 passed** (key floor for all referenced common.* keys resolves from the snapshot floor) — run under node v23.6.0 (v22 hits ERR_REQUIRE_ESM in vitest config; documented project constraint).
- `npx tsc --noEmit` → clean (exit 0); the labelKey tuple refactor typechecks.
- Grep confirms `common.header.maps` in header.tsx, `common.header.donate` in menu-dropdown.tsx, `common.profileMenu.signOut` + `useCopy` in user-dropdown.tsx.
- Words-only: every migrated label maps to a floor value byte-identical to the prior on-screen text (per-variant keys preserve every label; e.g. bib "Sign out" via `common.profileMenu.signOut`, distinct from human's "Logout").

## Known Stubs

None. This plan wires existing keys to existing components; no placeholder data, no unresolved data sources.

## Self-Check: PASSED

- header.tsx, menu-dropdown.tsx, user-dropdown.tsx all present and modified.
- Commits 0bf600f7, 9ec3f2f9 present in git log.
