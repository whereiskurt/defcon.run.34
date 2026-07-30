---
phase: 70-gpx-studio-shared-dialog-shell-map-layers-my-maps
plan: 03
subsystem: run.gpx / gpx-studio frontend
tags: [svelte5, runes, design-system, map-layers, a11y, tooltip-removal]
status: complete
requires:
  - DialogShell
  - Section
  - Row
  - Chips
  - Chip
provides:
  - "PublicOverlays: top-level Section cards (All Runners / User Check-ins / one per route group)"
  - "MyConRuns: one My DEF CON Runs Section with plain per-day sub-sections"
  - "CommunityRoutes: one Community Routes Section"
  - "zero native hover tooltips in the three layer-control section components"
affects:
  - 70-05
  - 70-06
tech-stack:
  added: []
  patterns:
    - "Section cards as a component's own template top level — no outer wrapper, so the host drops them straight into the dialog body"
    - "prev-visible plain-object bookkeeping effect drives Section's collapsed prop (master-off-collapses without a bindable prop)"
    - "Section-wide cascade passes fit = false to avoid N fitBounds animations on one master click"
key-files:
  created: []
  modified:
    - apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/PublicOverlays.svelte
    - apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/MyConRuns.svelte
    - apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/CommunityRoutes.svelte
decisions:
  - "Check-ins master-off now COLLAPSES the filter body instead of unmounting it, so the chevron stays usable after turning the layer off"
  - "The MyConRuns whole-section cascade passes fit = false; the per-day toggle keeps the default fit so single-day camera behaviour is byte-identical"
  - "The per-day colour dot moved from the day header onto each run row, because Section has no dot slot"
  - "The route-group `{#if length > 0}` wrapper was dropped — an empty `{#each}` already renders nothing, and the wrapper existed only to hold the deleted layout div"
metrics:
  duration: ~20m
  completed: 2026-07-30
  tasks: 3
  files: 3
---

# Phase 70 Plan 03: Map Layers Sections on the Shared Kit Summary

The three Map Layers section components now render exclusively through the
plan-01 `Section` / `Row` / `Chips` / `Chip` kit, and the native hover tooltip
that caused the reported route-row stutter is gone from all three.

## What Was Built

**`PublicOverlays.svelte`** — its template top level is now exactly three
`<Section>` call sites:

1. `All Runners` — header-only, `collapsible={false}`, master wired to
   `setAggregateVisible`. No children, so `Section` renders the 18px chevron
   spacer and keeps its label aligned with the cards below it.
2. `User Check-ins` — count badge from `$publicCheckIns.count`, master wired to
   `setCheckInsVisible`, body = `Chips` (window) → handle-search input →
   a flex-wrap div of type `Chip`s plus the optional runner-clear `Chip`.
3. One card per `$publicOverlayGroups` entry — this is where the
   `DEF CON 34 Routes` and `Rabbit Routes` labels come from, via the preserved
   `\bMaps\b` → `Routes` rename.

`CHECKIN_WINDOWS` passes straight into `Chips` because it is already
`{ key, label }[]`; the `key` union `CheckinWindow` widens to `string`
covariantly, and the callback casts back on the way out. `TYPE_META` is reused
verbatim — the four spec colours are declared exactly once in the file.

**`MyConRuns.svelte`** — one `My DEF CON Runs` card (that label now lives here
rather than in LayerControl's hand-written div) whose body is one
plain-variant sub-section per con day. New locals: `rootCollapsed`, `totalRuns`,
`allDaysVisible`, `setAllDays`.

**`CommunityRoutes.svelte`** — one card. Its count moved out of the label text
into `Section`'s badge, so the label is now just `Community Routes`.

## Why the check-ins body gate became a collapse

The shipped code gated the whole filter body behind the master's visible flag,
so turning check-ins off unmounted the filters entirely and there was nothing
left to expand. Mirroring the group idiom — a `prevCheckinsVisible` plain object
plus an `$effect` that only rewrites `checkinsCollapsed` on an actual ON/OFF
transition — makes master-off fold the body instead, and leaves the chevron free
to unfold it again afterwards. That is the "one collapse affordance" rule from
UI-SPEC §2 applied to a block that previously had none.

## Why the cascade suppresses fitBounds

`MyConRunsLayer.setDayVisible(conDay, visible, fit = true)` fires a
`fitBounds` per call. The new whole-section master would therefore fire one
camera animation per con day on a single click. `setAllDays` passes
`fit = false`; the per-day sub-section master omits the third argument and keeps
the shipped default, so single-day camera behaviour is unchanged. This is
threat T-70-08's mitigation.

## Interface delivered to plan 05

Each component owns its own top-level cards and emits no wrapper. Plan 05 can
delete LayerControl's `p-2 ml-1` wrapper divs, its `<Separator>` rules and its
hand-written `My DEF CON Runs` label div (currently lines 509-513) and keep only
the `{#if}` guards.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Explanatory comment inflated an exact-count grep gate**

- **Found during:** Task 2
- **Issue:** The acceptance criterion `grep -c 'variant="plain"' MyConRuns.svelte`
  is an exact count of 1. A comment explaining what the plain sub-section
  variant does spelled that attribute literally, pushing the count to 2 and
  failing the gate on an otherwise-correct file.
- **Fix:** reworded the comment to describe the variant in prose without
  spelling the attribute. Same explanation, count back to 1.
- **Files modified:** `MyConRuns.svelte`
- **Commit:** 030373b8

This is the same hazard plan 01 hit twice and the same one the executor prompt's
gate-hygiene note warns about: these gates are plain text counts, so prose that
names a gated token is indistinguishable from code that uses it.

### Intentional structural change (covered by the plan's own template spec)

The route-group block lost its `{#if $publicOverlayGroups.length > 0}` guard and
its `flex flex-col gap-1 text-sm` wrapper div. The plan's action specifies the
`{#each}` as a top-level construct, and the interface contract with plan 05
requires no wrapper. An empty `{#each}` renders nothing, so the must-have
"empty groups still render nothing" holds by construction. Both `MyConRuns` and
`CommunityRoutes` keep their `length > 0` guards, which are still load-bearing
(they wrap a single unconditional Section, not an each-block).

## Authentication Gates

None.

## Verification Results

| Gate | Result |
|------|--------|
| Baseline `svelte-check` before any edit | 30 ` ERROR ` lines, 0 on the three files |
| Final `svelte-check` (all three files) | `OK (total 30)` — 0 matching the three files |
| Cross-file native tooltip gate | `:0` for all three files |
| Raw-HTML interpolation (T-70-01) | `{@html` → 0 in all three files |
| New npm dependencies (T-70-03) | `package.json` / `package-lock.json` porcelain empty |
| Own-files scope | only this plan's three paths appeared; clean after commits |
| Negative gates on untouched files | `public-overlays.ts`, `my-con-runs.ts`, `community-routes.ts`, `LayerTree`, `LayerTreeNode`, `LayerControlSettings`, `cloud-sync.ts`, `src/routes` → all clean |
| Post-commit deletion check | zero deletions across all three commits |

Per-task grep criteria, all passing:

- **PublicOverlays** — tooltip attribute 0, chevron imports 0, kit import 1,
  `prevGroupVisible` 3 with the plain-object declaration 1, `checkinsCollapsed`
  4, old body gate 0, `TYPE_META` 4, `#e6007a` 1, `setCheckInFilters` **4**
  (window / match / types / runner clear — T-70-07 pinned), `<Section` 3,
  `<Row` 1.
- **MyConRuns** — chevron imports 0, tooltip attribute 0, `<Section` 2, plain
  variant 1, `My DEF CON Runs` 1, `setDayVisible(g.conDay, v, false)` 1,
  plain-object declaration 1, `routeColor(i)` 1.
- **CommunityRoutes** — chevron imports 0, tooltip attribute 0, `<Section` 1,
  `<Row` 1, `toggleAll` 2, `collapsed = !visible` 1.

No test runner exists in gpx-studio (`package.json` scripts are
dev/build/preview/check/check:watch/format/lint only), so `svelte-check` plus the
grep gates are the full available verification surface. Rendered behaviour is
covered by the plan-06 Playwright prod probe.

## Known Stubs

None. All three components are fully wired. They do not render inside a dialog
yet because `LayerControl.svelte` still hosts them in the old popover — that is
plan 05, and it is the intended state at the end of plan 03.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change —
presentation layer only, zero dependencies added.

## Self-Check: PASSED

All three modified files verified present on disk. All three commit hashes
verified in `git log`: 7b1ecf35, 030373b8, a37f9584.
