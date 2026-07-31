---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 05
subsystem: ui
tags: [svelte, sveltekit, mapbox-gl, geojson, gpx-studio, heatmap, localstorage]

# Dependency graph
requires:
  - phase: 71-01
    provides: "heatmap-artifact.ts — the settled artifact/meta shape and the dc33|dc34 year allowlist this layer codes against"
  - phase: 71-03
    provides: "GET /api/gpx/public/heatmap/[year] and its ?meta=1 projection — the only surface this layer fetches"
  - phase: 71-04
    provides: "the live uploads/HEATMAP/dc33.json artifact (110 runs, 658.4 km) that makes the DC33 row real"
  - phase: 70
    provides: "the Map Layers dialog + Section/Row kit that 71-06 will plug this layer's rows into"
provides:
  - "HeatmapLayer — a lazy, per-year Mapbox line layer for the DC33 and DC34 heat maps"
  - "heatmapState — the store 71-06's HEAT MAP section renders from (availability, visibility, generatedAt, runCount, totalKm per year)"
  - "relativeStamp() — the pure 'last calculated' formatter the section header shows"
  - "LAYER.heatDc33 / LAYER.heatDc34 — the two persisted visibility ids"
affects: [71-06, 71-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cheap ?meta=1 availability probe at map load, geometry fetched only on first enable"
    - "Single atomic store commit for availability + restored visibility (never available-then-visible)"
    - "Deterministic z-order for lazily-built sibling layers via addLayer(spec, beforeId)"

key-files:
  created:
    - apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts
  modified:
    - apps/run.gpx/gpx-studio/website/src/lib/stores/layer-visibility.ts
    - .planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/deferred-items.md

key-decisions:
  - "HEAT_PAINT carries mapbox paint keys ('line-color'/'line-width'/'line-opacity') rather than the plan's loose {color,width,opacity} shape, with width+opacity in one shared HEAT_STROKE spread — one source of truth for the locked values and directly passable to addLayer"
  - "DC34-above-DC33 is enforced by inserting DC33 BENEATH an existing DC34 layer, not by 'DC33 added first' — enable order belongs to the runner, not to us"
  - "A stored ON for an unavailable year is ignored: visible = available && storedVisible(...), so a deleted artifact cannot resurrect a fetch"
  - "Studio-side verification is svelte-check delta (0 new errors against the exact 30-error upstream baseline) + a green production build; the package has no test runner, and behaviour is proven by the 71-08 production probe"

patterns-established:
  - "Two-phase layer loading: a bytes-cheap meta probe answers availability/staleness at load, geometry is deferred to first enable"
  - "Lazy sibling layers keep a fixed z-order by passing a beforeId computed from whichever sibling already exists"

requirements-completed: [HEAT-04]

coverage:
  - id: D1
    description: "Both years' availability and 'last calculated' meta are known after map load without fetching any geometry"
    requirement: HEAT-04
    verification:
      - kind: other
        ref: "source assertion: loadMeta() fetches only heatMetaUrl(); ensureGeometry() is the sole caller of heatUrl() and runs on first enable"
        status: pass
      - kind: e2e
        ref: "71-08 production probe (pending)"
        status: unknown
    human_judgment: false
  - id: D2
    description: "First enable renders that year with the locked paint (#ff0000 dc34 / #ff8c00 dc33, width 3, opacity 0.25), DC34 compositing above DC33, both legible together"
    requirement: HEAT-04
    verification:
      - kind: other
        ref: "grep gate: one line each for #ff0000, #ff8c00, 'line-width': 3, 'line-opacity': 0.25"
        status: pass
    human_judgment: true
    rationale: "\"dc33 and dc34 simultaneously = legendary\" is an aesthetic judgment about whether the two colors read as heat together — only a human looking at the live map can sign that off (71-08 probe + Kurt UAT)"
  - id: D3
    description: "Toggles survive a page load and the restore never moves the map camera"
    requirement: HEAT-04
    verification:
      - kind: other
        ref: "source assertion: exactly one heatmapState.set; restore path calls applyVisibility() → map.setLayoutProperty only, never a fitBounds-bearing setter"
        status: pass
      - kind: e2e
        ref: "71-08 production probe (pending)"
        status: unknown
    human_judgment: false
  - id: D4
    description: "A missing or malformed artifact leaves the studio visually unchanged and no artifact-derived value can reach the DOM"
    requirement: HEAT-04
    verification:
      - kind: other
        ref: "grep gate: 0 matches for innerHTML|insertAdjacentHTML|.properties; isFeatureCollection() gate precedes every addSource; both fetches credentials: 'omit'"
        status: pass
    human_judgment: false

# Metrics
duration: 22min
completed: 2026-07-30
status: complete
---

# Phase 71 Plan 05: Studio Heat-Map Layer Summary

**`HeatmapLayer` makes the two flame stacks real in gpx-studio: both con years announce themselves at map load for a few hundred bytes each, and only pay for their geometry the moment a runner actually turns them on.**

## Performance

- **Duration:** ~22 min
- **Tasks:** 2/2
- **Files modified:** 2 source files (1 created, 1 modified) + 1 planning doc

## Accomplishments

- **Two-phase loading.** `loadMeta()` probes `?meta=1` for both years concurrently at map load — that single response answers "does this year exist" *and* "when was it last calculated", which is what lets the section show a last-calculated stamp on a layer nobody has touched. Geometry (hundreds of KB for dc33's 110 runs) is fetched by `ensureGeometry()` on first enable and never otherwise.
- **One atomic restore.** Availability and restored visibility land in exactly one `heatmapState.set(...)`. The two-step "available, then visible" restore that Phase 70 proved gets read downstream as a user toggle is structurally impossible here — enforced by a `grep -c "heatmapState.set" == 1` gate.
- **The camera never moves.** Restore drives `map.setLayoutProperty` through a private `applyVisibility()`; no user-facing, `fitBounds`-bearing setter is reachable from the load path.
- **Deterministic z-order under lazy build.** "DC33 added first" is not achievable when the runner picks the enable order, so DC33 is instead inserted *beneath* an already-built DC34 layer via `addLayer(spec, beforeId)`. DC34 — the live year — wins the overlap however the two get switched on.
- **Untrusted input contained.** The artifact is shape-checked (`FeatureCollection` with a non-empty `features` array) before `addSource`, no feature attribute is ever read, both fetches are `credentials: 'omit'`, and the file contains zero DOM-writing primitives. Every one of those is a grep-enforced acceptance gate, not a claim.
- **Two new persisted ids** (`heat:dc33`, `heat:dc34`) registered in `LAYER` alongside `checkins`/`aggregate`, with no existing id renamed — a changed id silently discards a runner's saved preference.

## Task Commits

1. **Task 1: Register the two persisted heat-layer ids** — `e9e0c420` (feat)
2. **Task 2: The HeatmapLayer class** — `32f64382` (feat)

## Files Created/Modified

- `apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts` (created, 293 lines) — `HeatmapLayer` (`loadMeta` / `setVisible` / `remove`), the `heatmapState` store, the pure `relativeStamp()` formatter, `HEAT_YEARS` / `HeatYear` / `HeatYearState`, `HEAT_PAINT`, `heatSourceId` / `heatLayerId`, and local `regionPrefix()`.
- `apps/run.gpx/gpx-studio/website/src/lib/stores/layer-visibility.ts` (modified) — `LAYER.heatDc33` / `LAYER.heatDc34` plus the `heat:<year>` key shape in the module doc.
- `.planning/.../deferred-items.md` (modified) — logged two pre-existing, out-of-scope tooling findings (D-71-B, D-71-C).

## The seam 71-06 consumes

Plan 71-06 adds the HEAT MAP section to the Phase 70 dialog. Everything it needs is exported and nothing else is required of it:

| It needs | It uses | Note |
|---|---|---|
| whether to render a year's row | `$heatmapState[year].available` | false ⇒ row must not render |
| the toggle state | `$heatmapState[year].visible` | already restored by `loadMeta()` |
| the section-header stamp | `relativeStamp($heatmapState[year].generatedAt)` | pure; `—` when unknown |
| the hint-bar detail | `generatedAt`, `runCount`, `totalKm` | exact ISO + counts |
| the toggle action | `await layer.setVisible(year, next)` | persists and updates the store itself |
| wiring at map load | `void layer.loadMeta()` | one call; failures are already silent |

`setVisible` writes layout → store → localStorage in that order (matching `setAggregateVisible`), so the component must **not** also write `setLayerVisible` — that would double-write the persisted id.

## Decisions Made

1. **`HEAT_PAINT` keyed by mapbox paint names.** The plan specified `Record<HeatYear, {color, width, opacity}>`, but its own acceptance criteria require the literal lines `'line-width': 3` and `'line-opacity': 0.25` to each appear exactly once — unsatisfiable if the record is the sole carrier and the paint block reads from it. Resolved by making the record *be* the paint spec, with the year-independent stroke in a shared `HEAT_STROKE` spread. Same values, same per-year semantics, one source of truth, and the criteria pass honestly rather than by duplicating the locked numbers.
2. **`visible = available && storedVisible(...)`.** A year whose artifact has been deleted must not have a stale stored ON re-trigger a fetch. dc34 is exactly this case today (unbuilt until 71-07 runs).
3. **`relativeStamp` tops out at years.** dc33's `generatedAt` is 2025-08-15, so it renders as `~350d ago` today and `1y ago` next August — honest, and the DC33 stamp is meant to read as "this is the classic, frozen at export time".
4. **`console.warn` only, one per failure path.** Consistent with `community-routes.ts`; nothing throws into the map.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `npm run build` had no `PUBLIC_MAPBOX_TOKEN`**
- **Found during:** Task 2 verification
- **Issue:** The plan's `<verify>` block ran a bare `npm run build`, which fails at `src/lib/utils.ts (8:9): "PUBLIC_MAPBOX_TOKEN" is not exported by "virtual:env/static/public"` *after* transforming all 4859 modules. An env prerequisite, not a code error, and entirely unrelated to this plan's files.
- **Fix:** Re-ran verification as `PUBLIC_MAPBOX_TOKEN=pk.placeholder npm run build`, which is exactly what the shipped build path does (`apps/run.gpx/build-frontend.sh:210-215` sources the token from the webapp `.env` and falls back to `pk.placeholder`). No source or config changed.
- **Verification:** exit 0, `✓ 4859 modules transformed` + `✓ 6790 modules transformed`, `✓ built in 17.54s` / `26.75s`.
- **Committed in:** no code change; recorded as D-71-C in `deferred-items.md`.

**2. [Rule 3 - Blocking] `npm run check` and `npm run lint` cannot exit 0 in this vendored tree**
- **Found during:** Tasks 1 and 2 verification
- **Issue:** The plan asserts both exit 0. `svelte-check` carries a **30-error upstream baseline** in `gpx-studio/website` (documented and measured identically in Phase 70: `70-01-SUMMARY.md`, `70-03-SUMMARY.md`, `70-04-SUMMARY.md`, `70-06-SUMMARY.md`). `npm run lint`'s eslint half cannot start at all: the package ships `.eslintrc.cjs` while the installed binary is eslint 9.28.0.
- **Fix:** Used the delta gate Phase 70 established — `svelte-check --output machine`, hard-fail if the transcript is empty or has zero ` ERROR ` lines (liveness), then require **zero** errors attributed to the changed file. Ran the prettier half of `lint` directly against both changed files. Did not touch eslint config or any dependency (out of scope).
- **Verification:** Task 1 `OK: 0 new errors (total 30)`; Task 2 `total=30 heatmap=0` — the total is byte-identical to the Phase 70 baseline, so this plan introduced no type regression. Prettier: `All matched files use Prettier code style!` for both files.
- **Committed in:** no code change; recorded as D-71-B in `deferred-items.md`.

---

**Total deviations:** 2 auto-fixed (2× Rule 3 — blocking verification-environment issues, both pre-existing and both logged rather than fixed per the scope boundary)
**Impact on plan:** None on scope or behaviour. No source file changed as a result; both are verification-harness corrections, and neither weakens the gate (the delta gate is strictly stronger evidence than "exits 0" would have been on a tree that has never exited 0).

## Issues Encountered

**The plan's own paint-constant criteria were self-contradictory.** `HEAT_PAINT: Record<HeatYear, {color, width, opacity}>` plus "`grep -Ec \"'line-width': 3\"` returns 1" cannot both hold without writing the locked numbers twice. Resolved in favour of one source of truth (Decision 1) — the criteria all pass and the values appear exactly once each.

## Verification Results

| Gate | Command | Result |
|---|---|---|
| Type check (Task 1) | `svelte-check --output machine`, delta on `layer-visibility` | **PASS** — `OK: 0 new errors (total 30)` |
| Type check (Task 2) | `svelte-check --output machine`, delta on `heatmap-layer` | **PASS** — `total=30 heatmap=0` |
| Build | `PUBLIC_MAPBOX_TOKEN=pk.placeholder npm run build` | **PASS** — exit 0, built in 17.54s / 26.75s |
| Format | `prettier --check` on both changed files | **PASS** |
| ESLint | `npx eslint` | **BLOCKED (pre-existing)** — no flat config in the vendored package; D-71-B |
| No deps added | `git diff --stat .../website/package.json` | **PASS** — empty (T-71-SC) |

### Acceptance greps (Task 2 — all 12)

| Assertion | Required | Actual |
|---|---|---|
| `regionPrefix` present | ≥2 | 2 |
| root-absolute `/api/gpx` URL | 0 | 0 |
| `#ff0000` / `#ff8c00` | 1 / 1 | 1 / 1 |
| `'line-width': 3` / `'line-opacity': 0.25` | 1 / 1 | 1 / 1 |
| `heatmapState.set` | 1 | 1 |
| `innerHTML` \| `insertAdjacentHTML` \| feature-attribute read | 0 | 0 |
| `credentials: 'omit'` | ≥2 | 2 |
| `storedVisible` | ≥1 | 2 |
| hand-written `'heat:dc33'`/`'heat:dc34'` | 0 | 0 |
| race guard `if (!this.visible[year]) return` | ≥1 | 1 |

### Acceptance greps (Task 1)

`heat:dc33` = 1, `heat:dc34` = 1, no removed/renamed existing id in the diff.

## Threat Model Compliance

| Threat | Disposition | Evidence in shipped code |
|---|---|---|
| T-71-21 tampered artifact → map | mitigate | `isFeatureCollection()` gates every `addSource`; no feature attribute is read; zero DOM-writing primitives (grep-enforced) |
| T-71-22 cookie on a cacheable public request | mitigate | both fetches `credentials: 'omit'` |
| T-71-23 oversized artifact on a phone | mitigate | load pays only two meta responses; geometry deferred to first enable |
| T-71-24 hand-edited localStorage | accept | store already coerces to booleans; additionally an ON for an unavailable year is ignored |
| T-71-SC package installs | mitigate | none; `package.json` diff empty |

**Threat flags:** none — this plan adds no new network endpoint, auth path, file access or schema; it consumes an existing public read-only route.

## Known Stubs

None. Every export is fully wired to real behaviour against the live dc33 artifact; dc34 correctly probes unavailable until 71-07's scheduler runs, which is the designed state, not a stub.

## User Setup Required

None.

## Next Phase Readiness

**Ready for 71-06.** It should: call `void layer.loadMeta()` where the other layers load, render one Row per year gated on `available`, wire the toggle to `await layer.setVisible(year, next)`, and header the section with `relativeStamp(...)`. Phase 70's landmines still apply — gate the footer/trailing snippet via `cond ? snip : undefined`, and remember `Section.svelte` has no `trailing` prop.

Live expectation at UAT time: **dc33 renders (110 runs, 658.4 km, stamped 2025-08-15); dc34's row does not render at all** until 71-07 publishes its artifact.

## Self-Check: PASSED

- `apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts` — FOUND
- `apps/run.gpx/gpx-studio/website/src/lib/stores/layer-visibility.ts` — FOUND
- commit `e9e0c420` — FOUND
- commit `32f64382` — FOUND
