---
phase: 37-bib-donate-sponsor-proof-surface
plan: 02
subsystem: run.bib copy catalog (server surface)
tags: [copy-catalog, server-components, migration, run.bib]
requires:
  - "37-01 (authored bib.instructions.* / bib.landing.* keys into copy-snapshot.json)"
  - "Phase 36 toolkit: loadCopy/t/renderCopy (already on main)"
provides:
  - "Server donate/sponsor surface reads copy from the catalog (SC-1)"
  - "Snapshot-floor render proof for these server files (SC-4)"
affects:
  - apps/run.bib/webapp/src/components/SponsorInstructions.tsx
  - apps/run.bib/webapp/src/app/sponsor/venmo/page.tsx
  - apps/run.bib/webapp/src/app/sponsor/cashapp/page.tsx
  - apps/run.bib/webapp/src/app/orderform/page.tsx
tech-stack:
  added: []
  patterns:
    - "Server component: const copy = await loadCopy('default'); t(copy, key, vars) (D-02)"
    - "Split interpolated markup: reconcileNoteBefore + <code>{runnerCode}</code> + reconcileNoteAfter"
key-files:
  created: []
  modified:
    - apps/run.bib/webapp/src/components/SponsorInstructions.tsx
    - apps/run.bib/webapp/src/app/sponsor/venmo/page.tsx
    - apps/run.bib/webapp/src/app/sponsor/cashapp/page.tsx
    - apps/run.bib/webapp/src/app/orderform/page.tsx
decisions:
  - "SponsorInstructions became an async server component so it can await loadCopy — pages already await it (React 19 async server component)."
  - "Reconcile note split into before/after keys so the <code>{runnerCode}</code> monospace treatment survives (per plan/D-03)."
  - "aria-label and InstructionRow uppercase styling left literal (D-03)."
metrics:
  duration: ~12m
  completed: 2026-07-05
  tasks: 3
  files-changed: 4
status: complete
---

# Phase 37 Plan 02: Bib Donate/Sponsor Proof Surface (SERVER) Summary

Migrated the four SERVER-rendered donate/sponsor files in run.bib to resolve their visible copy from the `bib.instructions.*` / `bib.landing.*` catalog keys via the Phase 36 `loadCopy('default')` + `t()` path (D-02), consuming keys already authored into `copy-snapshot.json` by Wave 1 (37-01).

## What Was Built

- **Task 1 — SponsorInstructions.tsx** (`96964f34`): converted to an `async` server component that awaits `loadCopy('default')`. The provider eyebrow (`payVia`), "Send to" (`sendTo`), "Required comment" label + hint (`requiredComment` / `requiredCommentHint`), and the deep-link button (`openProvider`) now resolve via `t()` with `{ provider: providerLabel }` interpolation. The closing reconcile paragraph is split as `reconcileNoteBefore` + the existing `<code>{runnerCode}</code>` element + `reconcileNoteAfter`, preserving the monospace treatment. `aria-label` and `InstructionRow` styling left literal (D-03).
- **Task 2 — venmo/page.tsx + cashapp/page.tsx** (`8d2d928b`): both already-async pages add `const copy = await loadCopy('default')`. Titles/subheads resolve from `venmoTitle`/`venmoSubhead` and `cashappTitle`/`cashappSubhead`; both back links share `bib.instructions.backToBib` (D-09). Deep-link / handle / redirect / `recordPending` logic untouched; `providerLabel` props left as-is (they drive interpolation inside SponsorInstructions).
- **Task 3 — orderform/page.tsx** (`92cd1f8d`): the `Home` server component awaits `loadCopy('default')`; the landing `<h1>` reads `bib.landing.title` and the intro `<p>` reads `bib.landing.intro`. All child renders (StripeStatusBanner, ContributionChip, GetYourBib, PledgeTagline, ContributionChoice, ContributionTiles) and every data-fetch left untouched — those belong to other Wave 2 plans.

## Verification

- `npx tsc --noEmit` clean for run.bib/webapp after each task.
- Positive greps confirm `bib.instructions.*` / `bib.landing.*` usage in each file (1 each).
- Anchored negative greps confirm removed literals are gone: `! grep -q "Required comment<"`, `! grep -q "Sponsor via Venmo<"`, `! grep -q "Bibs &amp; Donation"`, `! grep -q "remains a FREE daily event"` — all pass.
- Existing copy suites green on Node v23.6.0: `copy.test.ts`, `copy-catalog-bib.test.ts`, `copy-markdown.test.tsx`, `copy-provider.test.tsx` — 32/32 passed. No test files changed this plan.

## Deviations from Plan

None — plan executed exactly as written. Rules 1–4 not triggered; no auth gates; no package installs.

## Success Criteria

- [x] All server sponsor/instruction/landing copy resolves from `bib.instructions.*` / `bib.landing.*` via `loadCopy`+`t` (SC-1).
- [x] `<code>{runnerCode}</code>` treatment preserved in the reconcile note.
- [x] Snapshot floor guarantees these render with the CMS down — keys resolve from `copy-snapshot.json` `default` map (SC-4).
- [x] No `useCopy()` in server code; no `@/lib/copy` import in any client file (only these four server files import it).

## Self-Check: PASSED

- FOUND: apps/run.bib/webapp/src/components/SponsorInstructions.tsx
- FOUND: apps/run.bib/webapp/src/app/sponsor/venmo/page.tsx
- FOUND: apps/run.bib/webapp/src/app/sponsor/cashapp/page.tsx
- FOUND: apps/run.bib/webapp/src/app/orderform/page.tsx
- FOUND commit: 96964f34 (Task 1)
- FOUND commit: 8d2d928b (Task 2)
- FOUND commit: 92cd1f8d (Task 3)
