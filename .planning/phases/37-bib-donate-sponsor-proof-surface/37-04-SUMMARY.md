---
phase: 37-bib-donate-sponsor-proof-surface
plan: 04
subsystem: run.bib copy catalog
tags: [copy-catalog, migration, useCopy, loadCopy, contribution]
requires:
  - 37-01 (authored bib.contribution.* + bib.donate.title in copy-snapshot.json)
  - Phase 36 toolkit (loadCopy/t, CopyProvider/useCopy)
provides:
  - Contribution cluster copy fully catalog-driven (tiles + choice + chip)
affects:
  - apps/run.bib/webapp/src/components/ContributionTiles.tsx
  - apps/run.bib/webapp/src/components/ContributionChoice.tsx
  - apps/run.bib/webapp/src/components/ContributionChip.tsx
tech-stack:
  added: []
  patterns:
    - "Client component copy via useCopy() (ContributionTiles, ContributionChoice)"
    - "Server component copy via async loadCopy('default') + t() (ContributionChip)"
    - "Module-scope helper takes t as a param (hintFor) to resolve catalog keys"
    - "Interpolated aria via t(copy, key, { amount, providers }) — SC-2"
key-files:
  created: []
  modified:
    - apps/run.bib/webapp/src/components/ContributionTiles.tsx
    - apps/run.bib/webapp/src/components/ContributionChoice.tsx
    - apps/run.bib/webapp/src/components/ContributionChip.tsx
decisions:
  - "ContributionChip made async server component (loadCopy) — orderform already renders server children, no orderform edit needed"
  - "D-03 honored: error SENTENCE migrates (saveError), {detail} token passes as raw var; aria-labels on tiles/choice stay literal"
  - "D-09 honored: donate tile title shares bib.donate.title with the modal"
metrics:
  duration: ~15m
  completed: 2026-07-06
  tasks: 3
  files: 3
status: complete
---

# Phase 37 Plan 04: Contribution Cluster Copy Migration Summary

Migrated the bib contribution cluster (largest copy group, `bib.contribution.*`) to the CMS copy catalog, proving BOTH toolkit mechanisms in one cluster: `ContributionTiles` + `ContributionChoice` resolve copy client-side via `useCopy()`, while the server-rendered `ContributionChip` resolves via async `loadCopy('default') + t()`.

## What Was Built

- **Task 1 — ContributionTiles (client, useCopy):** Tile titles/bodies/kickers and the CTA verbs passed to `SponsorForm` now resolve from the catalog. Donate title shares `bib.donate.title` (D-09); donate body `bib.contribution.donateBody`; sponsor title/body `sponsorTitle`/`sponsorBody`; kickers `kickerSupport`/`kickerThis`/`kickerOrThat`; CTA verbs `donateVerb`/`sponsorVerb`. Commit `a2dc24e4`.
- **Task 2 — ContributionChoice (client, useCopy):** Limit note (`limitNote`), both checkbox labels (`optInPerson`/`optBurn`), the three hint lines (`hintInPerson`/`hintBurn`/`hintNothing`), and the error sentence (`saveError`) resolve via `useCopy()`. The module-scope `hintFor` helper was given a `t` parameter to resolve inside its switch. Per D-03 the `{detail}` token passes as a raw var and the `aria-label="Contribution options"` stays literal. Commit `41e6a1d7`.
- **Task 3 — ContributionChip (server, loadCopy):** The chip became an `async` server component resolving `const copy = await loadCopy('default')`. The thank-you pill uses `bib.contribution.thanks`; the interpolated aria uses `bib.contribution.chipAria` with `{ amount, providers }` (SC-2). No orderform edit needed — the orderform page is already an async server component rendering server children. Commit `b123e346`.

## Mechanism Split (verified)

- `ContributionTiles.tsx` + `ContributionChoice.tsx`: `"use client"` → `useCopy()`. Neither imports `@/lib/copy` (server-only) — confirmed by grep.
- `ContributionChip.tsx`: no `"use client"`, imports `loadCopy, t` from `@/lib/copy`; async server component. Confirmed by grep + header check.

## Verification

- `npx tsc --noEmit` clean after each task (touched files + whole webapp).
- Positive greps confirm `bib.contribution.*` usage across all three files; negative greps confirm removed visible literals gone ("Sponsor this bib", "Free bib without customization", `"Thank you"` string literal).
- Import-boundary invariant confirmed: no `@/lib/copy` in the client files; present in the chip.
- Full vitest suite: **222 passed / 23 files** on Node v23.6.0 (includes copy-catalog-bib, copy-provider, copy tests).
- All 18 referenced keys (17 `bib.contribution.*` + `bib.donate.title`) confirmed authored in `copy-snapshot.json` before use — none invented.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — no new security surface. Copy renders as auto-escaped React text children; interpolated `amount`/`providers`/`detail` pass as `t()` vars (no `dangerouslySetInnerHTML`). Client/server import boundary preserved (T-37-03).

## Self-Check: PASSED

- Files modified exist and typecheck.
- Commits `a2dc24e4`, `41e6a1d7`, `b123e346` present in git log.
