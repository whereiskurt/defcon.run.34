---
phase: 37-bib-donate-sponsor-proof-surface
plan: 05
subsystem: run.bib copy catalog
tags: [copy-catalog, migration, useCopy, checkout, bibform, stamps]
requires:
  - 37-01 (authored bib.sponsor.*/bib.donate.*/bib.checkout.*/bib.bibform.*/bib.status.* in copy-snapshot.json)
  - Phase 36 toolkit (CopyProvider/useCopy, copy-core t/interpolate)
provides:
  - Client checkout form (SponsorForm bib+general) copy fully catalog-driven, incl. interpolated Sponsor/Donate CTA (SC-2)
  - Bib name-entry proof (BibForm buttons/hints, RunnerCodeBadge labels) catalog-driven
  - BibPreview rubber-stamp copy (UNSAVED/DRAFT/PAID!/THANK YOU!) + BurningBib alt catalog-driven (D-08)
affects:
  - apps/run.bib/webapp/src/components/SponsorForm.tsx
  - apps/run.bib/webapp/src/components/BibForm.tsx
  - apps/run.bib/webapp/src/components/BibPreview.tsx
  - apps/run.bib/webapp/src/components/RunnerCodeBadge.tsx
  - apps/run.bib/webapp/src/components/BurningBib.tsx
tech-stack:
  added: []
  patterns:
    - "Client component copy via useCopy() t() in all five files"
    - "Interpolated CTA t('bib.checkout.cta', { label, amount }) — SC-2"
    - "Nested/leaf helper (SaveStateHint) calls useCopy() directly rather than threading t"
    - "Snapshot floor lets useCopy() resolve stamp text under renderToStaticMarkup with no provider"
    - "SVG <text> children resolved via useCopy() (BibPreview stamps)"
key-files:
  created: []
  modified:
    - apps/run.bib/webapp/src/components/SponsorForm.tsx
    - apps/run.bib/webapp/src/components/BibForm.tsx
    - apps/run.bib/webapp/src/components/BibPreview.tsx
    - apps/run.bib/webapp/src/components/RunnerCodeBadge.tsx
    - apps/run.bib/webapp/src/components/BurningBib.tsx
decisions:
  - "MECHANISM: BibPreview + BurningBib use useCopy() (NOT loadCopy) — both render only inside BibForm's client tree; corrects 37-CONTEXT's 'server' labels for these two files"
  - "No 'use client' directive added to BibPreview/BurningBib — they are only imported by BibForm (client) so they are transitively client-bundled; hooks resolve fine and Test C (T-37-03) stays green (negative check on @/lib/copy import)"
  - "D-08 honored: four BibPreview stamps migrate to bib.status.stamp*"
  - "D-09 honored: shared bib.checkout.* keys (payment method, pills, provider note, redirecting, error, slider helper) referenced — not re-authored"
  - "D-03 honored: user-facing error SENTENCE migrates (bib.checkout.error / bib.bibform.saveError); {detail} passes as raw var; aria-labels (Sponsor a bib / slider / runner code) + amount-input aria + placeholder='1337' left literal"
  - "resolvedCtaLabel default now t('bib.contribution.sponsorVerb'/'donateVerb'); the ctaLabel prop from ContributionTiles is already a resolved string and overrides it"
  - "orderform/page.tsx references BibPreview only in comments (no actual import) — making BibPreview a client hook consumer required no server-page edit"
metrics:
  duration: ~12m
  completed: 2026-07-06
  tasks: 3
  files: 5
status: complete
---

# Phase 37 Plan 05: Client Checkout + Bib Name-Entry Copy Migration Summary

Migrated the run.bib client checkout form and the bib name-entry proof surface to
catalog copy via `useCopy()` — SponsorForm (both bib + general variants), BibForm
buttons/hints, RunnerCodeBadge labels, the four BibPreview rubber stamps (D-08), and
the BurningBib alt text. All five components render inside the client tree, so all
resolve through `useCopy().t()` (never the server-only `@/lib/copy` resolver). The
interpolated Sponsor/Donate CTA resolves via `t('bib.checkout.cta', { label, amount })`,
completing SC-2 for the client checkout path.

## What Was Built

### Task 1 — SponsorForm checkout copy (commit `c346725e`)
- Added `const { t } = useCopy();` to the `SponsorForm` component.
- Migrated: per-variant amount label (`bib.sponsor.amountLabel` / `bib.donate.amountLabel`),
  slider helper (`bib.checkout.sliderHelper` interpolating `{min}`/`{max}`), "Payment method"
  (`bib.checkout.paymentMethod`), the three provider pill labels (`bib.checkout.providerCard`
  / `providerCashApp` / `providerVenmo`), the organizer-confirm note (`bib.checkout.providerNote`),
  the submit CTA (`bib.checkout.redirecting` / `bib.checkout.cta` interpolating `{label} {amount}`),
  and the error sentence (`bib.checkout.error` with raw `{detail}`).
- `resolvedCtaLabel` default became `variant === 'bib' ? t('bib.contribution.sponsorVerb') : t('bib.contribution.donateVerb')`; the `ctaLabel` prop (already-resolved string from ContributionTiles) still overrides.
- Left literal (D-03): the two form `aria-label`s, the slider `aria-label`, and the amount-input aria.
- Exported pure helpers (`clampForVariant`, `performSponsorCheckout`, etc.) and the fetch/checkout logic untouched.

### Task 2 — BibForm + RunnerCodeBadge copy (commit `b8af81e0`)
- BibForm: `useCopy()` in the component drives the Save-button ternary
  (`bib.bibform.verifying` / `saving` / `save`) and Cancel (`bib.bibform.cancel`).
  The nested `SaveStateHint` helper calls `useCopy()` directly to resolve the locked
  hint (`bib.bibform.lockedHint`) and the save error (`bib.bibform.saveError` with raw `{detail}`).
- RunnerCodeBadge: `useCopy()` drives the eyebrow (`bib.bibform.runnerCodeLabel`) and the
  Copy/Copied button (`bib.bibform.copy` / `bib.bibform.copied`).
- Left literal: `aria-label`s ("Name on bib", "Your runner code", "Copy runner code"),
  `aria-describedby`, and `placeholder="1337"` (D-05 design token).

### Task 3 — BibPreview stamps + BurningBib alt (commit `4b3a7d7c`, D-08)
- BibPreview: `useCopy()` in the component replaces the four SVG `<text>` stamp contents
  with `bib.status.stampUnsaved` / `stampDraft` / `stampPaid` / `stampThankYou`.
- BurningBib: `useCopy()` sets the img `alt` to `bib.status.burningBibAlt`.
- Both render only inside BibForm's client tree (verified: `orderform/page.tsx` references
  BibPreview in comments only, no import), so they are transitively client-bundled and use
  `useCopy()` — NOT `loadCopy`. The stamp `aria-label`s on the `<g>` groups and
  `PRIMARY_PLACEHOLDER = "1337"` stay literal (D-05).

## Verification

- `npx tsc --noEmit` — clean (exit 0) after each task.
- `npm test -- sponsor-form` — 18/18 pass (Node v23.6.0).
- `npm test -- bib-preview` — 8/8 pass; the snapshot floor resolves stamp text under
  `renderToStaticMarkup` with no provider, so the direct-render tests stay green.
- `npm test -- copy-catalog-bib` — 7/7 pass; Test C (T-37-03 server→client token boundary)
  confirms no `"use client"` file imports the server-only `@/lib/copy`.
- Positive greps: `bib.checkout.cta`, `bib.sponsor.amountLabel`, `bib.bibform.save`,
  `bib.bibform.copied`, `bib.status.stampPaid`, `bib.status.burningBibAlt` all present.
- Negative greps: `"Payment method"`, `Name locked for print`, and the four anchored
  stamp literals (`^\s*UNSAVED\s*$` etc.) confirmed gone.
- Interpolation note: `bib.checkout.sliderHelper = "Slide or type any amount from ${min} up to ${max}."`
  — the `${min}` renders correctly because `interpolate`'s `/\{(\w+)\}/g` matches `{min}`,
  leaving the literal `$` in place (→ `$20 up to $2000`).

## Key Catalog Keys Referenced (all pre-authored in 37-01, none invented)

`bib.sponsor.amountLabel`, `bib.donate.amountLabel`, `bib.checkout.sliderHelper`,
`bib.checkout.paymentMethod`, `bib.checkout.providerCard/CashApp/Venmo`,
`bib.checkout.providerNote`, `bib.checkout.redirecting`, `bib.checkout.cta`,
`bib.checkout.error`, `bib.contribution.sponsorVerb/donateVerb`,
`bib.bibform.verifying/saving/save/cancel/lockedHint/saveError/runnerCodeLabel/copy/copied`,
`bib.status.stampUnsaved/stampDraft/stampPaid/stampThankYou`, `bib.status.burningBibAlt`.

## Deviations from Plan

None — plan executed exactly as written. The plan's MECHANISM note (BibPreview/BurningBib
use useCopy, not loadCopy) was pre-authored and followed; no in-flight fixes were required.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema surface introduced. All copy renders
as auto-escaped React text children (including SVG `<text>` and img `alt`); interpolated
`amount`/`detail`/`min`/`max` pass as `vars` with no `dangerouslySetInnerHTML` (T-37-02),
and no file imports `@/lib/copy` (T-37-03).

## Self-Check: PASSED

All 5 modified component files and the SUMMARY exist on disk; all three task commits (c346725e, b8af81e0, 4b3a7d7c) are present in git history.
