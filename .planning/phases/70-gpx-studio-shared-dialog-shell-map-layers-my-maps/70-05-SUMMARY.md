---
phase: 70-gpx-studio-shared-dialog-shell-map-layers-my-maps
plan: 05
subsystem: run.gpx / gpx-studio frontend
tags: [svelte5, runes, dialog, map-layers, basemap, a11y, hover-removal]
status: complete
requires:
  - DialogShell
  - Section
  - Row
  - PublicOverlays
  - MyConRuns
  - CommunityRoutes
provides:
  - "Map Layers on the shared dialog shell (dialogId=layers), click-only trigger"
  - "flattenLayerTree"
  - "BasemapSection"
  - "data-dc34-layers-btn"
  - "zero hover-open / mouseleave-close wiring in LayerControl.svelte"
affects:
  - 70-06
tech-stack:
  added: []
  patterns:
    - "Pure `*-pure.ts` tree flattener keeps the recursive walk out of the component so basemaps render as one flat radio list"
    - "Dialog rendered as a SIBLING of CustomControl — the control container is relocated into the mapbox corner element and the dialog portals to body"
    - "Dismissal delegated to the shell overlay + Esc instead of a hand-rolled window-level containment check"
key-files:
  created:
    - apps/run.gpx/gpx-studio/website/src/lib/logic/basemap-tree-pure.ts
    - apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/BasemapSection.svelte
  modified:
    - apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte
decisions:
  - "Two preserved-range code comments were reworded (code byte-identical) because they spelled a phrase the plan's own zero-count gate forbids — the plan's PRESERVE VERBATIM ranges and its gate were mutually unsatisfiable as written"
  - "layersBtn / basemapCollapsed / overlaysCollapsed were declared next to `open` rather than in the top variable block, keeping all new dialog state in one place"
  - "The basemap card starts collapsed, matching the old tree's closed default state"
metrics:
  duration: ~25m
  completed: 2026-07-30
  tasks: 2
  files: 3
---

# Phase 70 Plan 05: Map Layers Dialog Host Summary

The layers control is now a single click-only button that opens the 420px shared
Map Layers dialog; all hover-open wiring, the reveal transition and the
hand-rolled outside-click listener are deleted, and the nested basemap tree is a
flat radio list inside one shared section card.

## What Was Built

**`lib/logic/basemap-tree-pure.ts`** — one exported function,
`flattenLayerTree(tree)`, walking a `LayerTreeType` depth-first in key-insertion
order and returning the ids of every enabled leaf. Object values recurse,
disabled leaves are skipped, an absent tree yields `[]`. Insertion order is what
makes the `basemaps.world` group come out ahead of the per-country groups, so the
flat list reads in the same order the nested tree rendered. The only import is a
type-only one, matching the `strava-strip-pure.ts` precedent — gpx-studio has no
test runner, so keeping the recursion out of a component is the codebase's way of
making it inspectable.

**`BasemapSection.svelte`** — one `Section` card labelled `Basemap` whose body is
`{#each ids}` of radio `Row`s sharing a single input group name. It preserves two
things exactly:

- The write pair the old `LayerTree` `onselect` performed — `previousBasemap`
  takes the outgoing value before `currentBasemap` takes the new one. The rest of
  the app reads `previousBasemap` to restore a style, so this is load-bearing, not
  bookkeeping.
- The `LayerTreeNode` label chain — a user's own layer name, then the name an
  extension supplies, then the translated fallback.

The radio is checked against `$currentBasemap`, the user's stored choice, never
the effective style key: dark mode swaps `mapboxOutdoors` for `mapboxDark` when
rendering, and the selection must not move under the user.

`LayerTree.svelte` and `LayerTreeNode.svelte` are untouched — `LayerTree` still
serves the overlays tree here and `LayerControlSettings` elsewhere.

**`LayerControl.svelte`** — the template from the old `CustomControl` wrapper
through the window listener is replaced by two siblings:

1. `<CustomControl class="w-[29px] h-[29px] shrink-0">` holding one
   `<button>` with `data-dc34-layers-btn`, `aria-label="Map layers"`,
   `aria-expanded={open}` and a click handler that opens the dialog.
2. `<DialogShell dialogId="layers" heading="Map Layers">` with a 17px layers
   glyph snippet and, in UI-SPEC §4 order: `BasemapSection`, the overlays
   `Section` (behind `hasOverlays`, false for DEF CON), `PublicOverlays`
   (which itself emits All Runners / User Check-ins / the route-group cards),
   `MyConRuns`, `CommunityRoutes`. Closing focuses the trigger again.

Three new locals sit beside the existing `open` state: `layersBtn`,
`basemapCollapsed` (starts folded, matching the old tree's closed default) and
`overlaysCollapsed`.

## What was deleted (recorded here, not in code comments)

The plan's acceptance gates count each of these to zero in the source, so naming
them in a code comment would fail the gate exactly as using them would:

| Deleted | Was at | Why it can go |
|---|---|---|
| `onmouseenter` / `onmouseleave` open+close handlers | 449-450 | click-only trigger; this was the reported stutter (DLGS-04) |
| `onpointerenter` block + `cancelEvents` state + its 500ms `setTimeout` | 451-459, 400 | existed only to suppress the pointer/mouse double-fire on the hover-open path |
| grid-rows / grid-cols reveal transition | 461-471 | the dialog animates itself |
| `ScrollArea` wrapper + import | 473, 33 | the shell body scrolls itself (`overflow-y-auto` on a `flex-1 min-h-0` div) |
| four `Separator` rules + import | 488/499/505/514, 32 | section cards supply their own edges |
| `svelte:window` outside-click handler using `composedPath()` | 526-537 | the shell overlay owns dismissal; the rotating single-glyph chevron removed the icon-node-swap hazard the handler worked around |
| `container` binding + `let container: HTMLDivElement` | 447, 50 | nothing binds to it once the window listener is gone |
| the hand-written run-group label div | 507-509 | `MyConRuns` owns that label as of plan 03 |
| four `p-2 ml-1` wrapper divs | — | children emit their own top-level cards |

Everything else in the script is byte-identical: `darkBasemapFor` / `setStyle` /
the mode effect, `hasValidTileUrls` / `addOverlay` / `updateOverlays`, the entire
`map.onLoad` block (all eleven layer instantiations, the async-auth subscription,
the one-shot store subscriptions and the first-only `style.import.load` hook), the
`onMount` day-assign bridge, `hasOverlays`, the QuickStart subscription, the
run-reload subscription with its synchronous reveal capture, and the trailing
con-day dialog block.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two preserved-range comments spelled a token the plan gates to zero**

- **Found during:** Task 2
- **Issue:** The acceptance criterion `grep -c 'My DEF CON Runs' LayerControl.svelte`
  must be 0. That phrase appeared three times: the label div at line 508 (which
  this plan deletes) but also in two explanatory comments — line 60, inside the
  PRESERVE VERBATIM range 43-136, and line 422, inside the preserved
  run-reload-subscription range 421-444. The plan therefore asked for both
  "preserve these ranges verbatim" and "this phrase must not appear", which
  cannot both hold.
- **Fix:** reworded the two comments to say "the con-run layer above" and "the
  con-run manifest". Zero executable characters changed; both preserved ranges
  are semantically identical and the plan's own git-diff gates (no layer
  instantiation line removed, no bridge line removed) still pass at 0.
- **Files modified:** `LayerControl.svelte`
- **Commit:** a8e748da

This is the fifth occurrence of the same hazard in this phase (plan 01 hit it
twice, plan 03 once, and this is the first time it landed on text the plan also
told the executor not to touch). The gates are plain text counts, so prose that
names a gated token is indistinguishable from code that uses it.

### Notes on interpretation

The plan's action text describes the trigger button's own `aria-expanded` and the
focus-return handler; both are implemented exactly as specified. No architectural
deviation (Rule 4) arose.

## Authentication Gates

None.

## Verification Results

| Gate | Result |
|------|--------|
| Baseline `svelte-check` before any edit | 30 ` ERROR ` lines |
| Task 1 gate | `OK: 0 new errors (total 30)` |
| Task 2 gate | `OK: 0 new errors (total 30)` |
| Final plan gate | `OK (total 30)` — 0 lines matching either new file or `LayerControl.svelte` |
| `cd apps/run.gpx && ./build-frontend.sh` | **exit 0** — first full compile of the phase; all six touched components bundled for real (`chunks/LayerControl.js` 194.12 kB) |
| Native hover tooltip attribute in `LayerControl.svelte` | 0 |
| Raw-HTML interpolation (T-70-01) | `{@html` → 0 in all three files |
| New npm dependencies (T-70-03) | `package.json` / `package-lock.json` porcelain empty |
| Negative gates | `public-overlays.ts`, `my-con-runs.ts`, `community-routes.ts`, `LayerTree`, `LayerTreeNode`, `LayerControlSettings` → `git diff --stat` empty; `src/routes` porcelain empty |
| Post-commit deletion check | zero deletions in both commits |
| Untracked files after the build | none (build output is gitignored) |

Task 1 grep criteria: `export function flattenLayerTree` 1, `import type` 1, bare
`^import {` 0, `control="radio"` 1, `name="basemap"` 1, `previousBasemap` 2,
`$currentBasemap = id` 1, the i18n key prefix 1, `isLayerFromExtension` 2,
`LayerTree.svelte` / `LayerTreeNode.svelte` porcelain empty.

Task 2 grep criteria: hover-handler alternation 0, `svelte:window` 0,
`composedPath` 0, the re-entry guard state 0, the scroll wrapper 0, the rule
component 0, `data-dc34-layers-btn` 1, `aria-expanded={open}` 1, `<DialogShell` 1,
`dialogId="layers"` 1, `heading="Map Layers"` 1, `<BasemapSection` 1, the moved
label 0, all four section guards 1 each, `open = true` 3 (button + two QuickStart
branches), `layersBtn?.focus()` 1. Git-diff gates: 0 removed layer-instantiation
lines, 0 removed bridge lines.

No test runner exists in gpx-studio (`package.json` scripts are
dev/build/preview/check/check:watch/format/lint only), so `svelte-check`, the
grep gates and now the full production build are the complete available
verification surface. Rendered behaviour — click-only open, section order in the
DOM, Esc/overlay dismissal, focus return, basemap switching — is covered by the
plan-06 Playwright prod probe and Kurt's UAT.

## Known Stubs

None. Every layer, bridge and subscription the old popover hosted is live in the
dialog.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change.
T-70-12 (regression risk in the preserved script) is mitigated by the two
git-diff gates, both at 0. T-70-13 (event-target confusion) is mitigated by
deleting the hand-rolled containment check in favour of the overlay. T-70-01 is
mitigated by rendering all labels through `Row` text interpolation and `i18n._`.
T-70-03 is mitigated: zero dependencies added, lockfile unchanged.

## Notes for Plan 06

- The dialog is selectable as `[data-dc34-dialog="layers"]`; its trigger is
  `[data-dc34-layers-btn]`.
- A prod probe must stub `api/gpx/**` and `api/user/**` (established recipe) —
  the route-group, run and community sections are all data-gated, so without
  stubs only `Basemap` renders.
- `hasOverlays` is false for DEF CON, so the `Overlays` card is expected to be
  absent in production. That is the guard working, not a missing section.
- The basemap card starts collapsed; a probe asserting basemap rows must click
  the section chevron first.

## Self-Check: PASSED

All three files verified present on disk. Both commit hashes verified in
`git log`: ba4392d4, a8e748da.
