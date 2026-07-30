---
phase: 70-gpx-studio-shared-dialog-shell-map-layers-my-maps
plan: 02
subsystem: run.gpx / gpx-studio frontend
tags: [svelte5, copy, affordance, strava, ui]
status: complete
requires: []
provides:
  - "Pick a day"
  - "+ Import"
affects: []
tech-stack:
  added: []
  patterns:
    - "Chip copy as the card's affordance: every non-terminal card state names the action its click performs"
    - "Quiet chip reuses the type-badge token (rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground) minus uppercase, since it is sentence copy not a type code"
key-files:
  created: []
  modified:
    - apps/run.gpx/gpx-studio/website/src/lib/components/StravaStrip.svelte
decisions:
  - "The quiet chip drops the type badge's uppercase: it is sentence-cased copy, not a type code, and uppercasing it would read as a second type badge"
  - "Both chips live inside the existing card button with no handlers of their own — openPopover's a.imported ? 'assign' : 'import' already routes each state correctly"
  - "The {:else} arm is unconditional rather than predicated on a new never-imported helper, because isTagged and isUntaggedImport together already partition the imported cards"
metrics:
  duration: ~10m
  completed: 2026-07-30
  tasks: 1
  files: 1
---

# Phase 70 Plan 02: Strava Card Chip States Summary

Three explicit chip states on the Strava strip — `✓ {weekday}` when tagged,
amber `Pick a day` when imported but untagged, quiet `+ Import` when never
imported — so two cards that behave differently on click no longer look
identical.

## What Was Built

A single copy/markup change inside the card `<button>` in
`StravaStrip.svelte`, in the chip block that follows the `{a.type}` badge:

1. **Tagged** — untouched. Still the green
   `text-[10px] font-semibold text-green-600 dark:text-green-400` span rendering
   `✓ {weekdayShort(a.conDay as string)}`, on a card that stays `opacity-60` and
   `disabled`.
2. **Imported-but-untagged** — amber classes kept verbatim
   (`rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-500`);
   only the text changed, `Assign a day` → `Pick a day`. An imperative, so the
   chip names the action the card performs rather than describing the card's
   state.
3. **Never-imported** — new `{:else}` arm rendering
   `<span class="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">+ Import</span>`.

Net diff is 7 insertions, 1 deletion.

## Why the third state needed a chip at all

Before this change the never-imported card carried no chip whatsoever, so it was
visually indistinguishable from an imported-untagged card except for the amber
pill — which read as a *status* ("this one is missing a day"), not as an
invitation. Two cards, same silhouette, two different popover modes on click,
with the difference expressed only by the presence of a status-shaped badge on
one of them. Giving the fresh state its own quiet chip makes the pair
self-describing: every clickable card now names its own outcome, and the amber
chip is reserved for the one state that is genuinely mid-flight.

## Why the quiet chip is not uppercase

`70-PATTERNS.md` suggested mirroring the `{a.type}` badge token wholesale,
including its `uppercase`. The plan's own action text overrides that with "minus
its `uppercase`", and that is what shipped. `+ IMPORT` next to `RUN` would read
as a second activity-type code sitting in the same badge row; sentence case
keeps it legible as copy. Every other token — radius, background, padding, size,
weight, foreground — is identical to the type badge, so the two still share one
visual weight class and the chip stays subordinate to the amber one.

## What was deliberately not touched

`isTagged`, `isUntaggedImport`, `openPopover`, `popoverMode`, the card button's
`onclick`, its `disabled={tagged}` guard and its dim classes are all byte-
unchanged. This is asserted mechanically, not by inspection: a git-diff gate
requires zero added or removed lines matching
`(isTagged|isUntaggedImport|popoverMode|openPopover)`, and it returned 0. That
gate is what closes threat **T-70-06** — a tagged, already-scored activity
cannot become re-assignable through this change, because the code path that
would have to change to allow it is proven untouched.

## Deviations from Plan

None — plan executed exactly as written.

## Authentication Gates

None.

## Verification Results

| Gate | Expected | Actual |
|------|----------|--------|
| `grep -c 'Pick a day'` | 1 | 1 |
| `grep -c '+ Import'` | 1 | 1 |
| `grep -c 'Assign a day'` | 0 | 0 |
| `grep -c 'bg-amber-500/15'` | 1 | 1 |
| `git diff -U0 \| grep -cE '^[-+][^-+]'` | ≤ 16 | 8 |
| `git diff \| grep -cE '^[-+].*(isTagged\|isUntaggedImport\|popoverMode\|openPopover)'` | 0 | 0 |
| `svelte-check` errors matching `StravaStrip.svelte` | 0 | 0 |
| `svelte-check` total ` ERROR ` lines | ~26-30 (liveness) | 30 |
| `package.json` / `package-lock.json` status | empty | empty (threat T-70-03) |
| Own-files scope | only `StravaStrip.svelte` | only `StravaStrip.svelte` |
| Negative gates: LayerTree, LayerTreeNode, LayerControlSettings, public-overlays.ts, my-con-runs.ts, community-routes.ts, cloud-sync.ts, src/routes | empty | empty |
| Post-commit deletion check | none | none |

The svelte-check gate is written to hard-fail on an empty transcript or on zero
total ` ERROR ` lines, so the "0 new errors" result cannot be produced by a
crashed run. The observed total of 30 is exactly the documented upstream
baseline for this branch, unchanged from plan 01's final run.

No test runner exists in gpx-studio, so `svelte-check` plus the grep gates are
the full available verification surface. Visual confirmation of the three chip
states is deferred to the Playwright prod probe in plan 06.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path, file access pattern, or schema change.
Both new chips render hardcoded literals, so no external data enters the new
markup (threat T-70-05 accepted as planned); the surrounding `{a.name}` and
`{a.type}` interpolations are unchanged Svelte text interpolations, not `{@html}`.

## Notes for Downstream Plans

- This plan shares no symbols with the dialog-shell kit and imports nothing from
  it. `StravaStrip.svelte` is outside every other plan's file set in this phase,
  so there is no merge surface to coordinate.
- Reassignment of a tagged activity still lives in the My Maps "Save as
  defcon.run Activity" dialog, unchanged — plan 04 owns that surface.

## Self-Check: PASSED

`apps/run.gpx/gpx-studio/website/src/lib/components/StravaStrip.svelte` verified
present on disk. Commit `2e29c08e` verified in `git log`.
