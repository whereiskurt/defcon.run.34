---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 06
subsystem: ui
tags: [svelte, sveltekit, gpx-studio, dialog-shell, heatmap, localstorage]

# Dependency graph
requires:
  - phase: 71-05
    provides: "HeatmapLayer + heatmapState + relativeStamp + HEAT_PAINT — everything this section renders from and toggles through"
  - phase: 70
    provides: "the Map Layers DialogShell and the Section/Row kit this section is built out of, plus the persisted layer-section-collapse store"
provides:
  - "HeatMap.svelte — the HEAT MAP section of the Map Layers dialog (two flame rows, master toggle, last-calculated stamp)"
  - "SECTION.heatmap — the persisted collapse id for that section"
  - "the LayerControl wiring: HeatmapLayer constructed once per map load, meta probed unauthenticated"
affects: [71-07, 71-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Availability-gated section mount: the `{#if available}` guard at the mount site IS the empty-sections-stay-hidden behaviour"
    - "Section `count` used as a string stamp slot rather than adding a prop to the shared kit"
    - "Manual-only collapse (no visibility-drives-collapse effect) as a way to sidestep the seeding-sentinel bug class rather than re-guard it"

key-files:
  created:
    - apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/HeatMap.svelte
  modified:
    - apps/run.gpx/gpx-studio/website/src/lib/stores/layer-section-collapse.ts
    - apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts
    - apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte
    - .planning/phases/71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio/deferred-items.md

key-decisions:
  - "HEAT_PAINT had to be exported — 71-05 declared it module-private despite its summary listing it as an export. Exported rather than re-typing the two colours in the component, so a row swatch cannot drift from the line it stands for"
  - "Row swatch reads HEAT_PAINT[year]['line-color'] — 71-05 shipped mapbox paint keys, not the plan's {color,width,opacity} shape"
  - "The per-year hint is a plain function called from markup instead of a $derived record — same reactivity, and it bought the 6 lines needed to hold the plan's 90-line ceiling"
  - "The heat load sits OUTSIDE the auth subscription in map.onLoad: the artifact is a public surface and must work signed-out"

patterns-established:
  - "A section whose layers are default-OFF defaults to EXPANDED (flat `false`), inverting the siblings' `!visible` rule, so a default-off feature is not hidden behind a chevron on first visit"

requirements-completed: [HEAT-05]

coverage:
  - id: D1
    description: "Opening Map Layers shows a HEAT MAP section with a flame row per available year, both off, each swatch matching its map line"
    requirement: HEAT-05
    verification:
      - kind: other
        ref: "source assertion: Row color reads HEAT_PAINT[year]['line-color'], the same constant addLayer paints with; grep for a hardcoded #ff0000/#ff8c00 in the component returns 0"
        status: pass
      - kind: e2e
        ref: "71-08 production probe (pending)"
        status: unknown
    human_judgment: true
    rationale: "Whether the two swatches read as flames next to each other in the live dialog is a look judgment only Kurt can sign off"
  - id: D2
    description: "The section header carries a relative last-calculated stamp; hovering a row puts the exact timestamp plus run count in the hint bar"
    requirement: HEAT-05
    verification:
      - kind: other
        ref: "source assertion: count={relativeStamp(newestAt)} on Section; Row hint={detail(...)} composing exact local time + runCount + totalKm, delivered through Row's data-hint which HintBar reads"
        status: pass
      - kind: e2e
        ref: "71-08 production probe (pending)"
        status: unknown
    human_judgment: false
  - id: D3
    description: "The section is absent entirely when neither year has an artifact"
    requirement: HEAT-05
    verification:
      - kind: other
        ref: "source assertion: the {#if $heatmapState.dc33.available || $heatmapState.dc34.available} mount guard in LayerControl, mirroring the sibling guards; and per-row filtering on available inside the component"
        status: pass
    human_judgment: false
  - id: D4
    description: "Collapse survives a dialog close/reopen and a page reload"
    requirement: HEAT-05
    verification:
      - kind: other
        ref: "grep gate: 0 occurrences of a state rune in HeatMap.svelte; collapse reads/writes SECTION.heatmap in the persisted store (2 occurrences, one read one write)"
        status: pass
      - kind: e2e
        ref: "71-08 production probe (pending)"
        status: unknown
    human_judgment: false
  - id: D5
    description: "The Phase 70 dialog-shell probe still passes its section-order assertion"
    requirement: HEAT-05
    verification:
      - kind: other
        ref: "spec analysis against 70-06-probes/dialog-shell-probe.cjs:337-380 — 'Heat Map' matches none of the five order predicates, Basemap stays first, and the insertion point preserves every pairwise order"
        status: pass
      - kind: e2e
        ref: "71-08 re-run of dialog-shell-probe.cjs (pending)"
        status: unknown
    human_judgment: false

# Metrics
duration: 10min
completed: 2026-07-30
status: complete
---

# Phase 71 Plan 06: HEAT MAP Section Summary

**The two flame stacks now have a front door: a HEAT MAP card in the Phase 70 Map Layers dialog, one row per con year that actually has an artifact, with the build stamp in the header and the exact numbers a hover away.**

## Performance

- **Duration:** ~10 min
- **Tasks:** 3/3
- **Files modified:** 3 source files (1 created, 2 modified) + 1 modified by deviation + 1 planning doc

## Accomplishments

- **The section is built out of the Phase 70 kit, not around it.** No prop was added to `Section` and no shared component was touched. The "last calculated" stamp that CONTEXT D-11 puts in a trailing slot goes into `count` instead — which is typed `number | string` and already renders in a muted mono span at the exact spot the design wanted. The shared kit ships unchanged.
- **Swatch and line cannot drift.** The row colour is read from `HEAT_PAINT`, the same constant `addLayer` paints the map line with. A grep gate proves neither hex literal appears in the component.
- **Availability is honoured, not worked around.** Today dc33 probes available (110 runs, 658.4 km, stamped 2025-08-15) and dc34 does not — its artifact lands when 71-07's scheduler runs. So the shipped dialog shows exactly one flame row right now, and grows the second one on its own the moment the artifact publishes. Nothing is hardcoded to make it look fuller than it is.
- **Both Phase 70 landmines respected.** Zero state runes in the component (the portalled dialog destroys its whole subtree on close), and collapse lives in the persisted store. No `trailing` prop was assumed to exist — because it does not.
- **The seeding-sentinel bug class is sidestepped rather than re-guarded.** `PublicOverlays` carries ~50 lines of `$effect` plus per-entry `undefined` sentinels purely to stop a first sighting being misread as an ON transition. This section simply has no visibility-drives-collapse behaviour at all, so none of that machinery is needed. Both the reasoning and a "do not restore parity" warning are in the file.
- **Signed-out visitors get the heat map.** The load sits outside `map.onLoad`'s auth subscription, deliberately and with a comment, because the artifact is a public unauthenticated surface.
- **Section order is provably safe.** "Heat Map" matches none of the Phase 70 probe's five order predicates, Basemap stays first, and every pairwise constraint among Basemap → Check-ins → route groups → My DEF CON Runs → Community Routes is preserved by the chosen insertion point.

## Task Commits

1. **Task 1: Register the heat-map section collapse id** — `7b4d67aa` (feat)
2. **Task 2: The HEAT MAP section component** — `063684cc` (feat)
3. **Task 3: Mount the layer and the section in LayerControl** — `868df636` (feat)

## Files Created/Modified

- `.../layer-control/HeatMap.svelte` (created, 88 lines) — the section: `ROWS` in display order, `exact()`/`detail()` hint composition, `shown`/`allOn`/`newestAt` deriveds, one `Section` with a `Row` per available year.
- `.../stores/layer-section-collapse.ts` (modified) — `SECTION.heatmap` plus its entry in the module's stable-id list. No existing id renamed.
- `.../map/heatmap-layer.ts` (modified, deviation) — `HEAT_PAINT` exported.
- `.../layer-control/LayerControl.svelte` (modified) — `HeatMap` + `heatmap-layer` imports, the `heatmapLayer` rune, the `map.onLoad` construct-and-probe block, and the guarded mount between `PublicOverlays` and `MyConRuns`.
- `.planning/.../deferred-items.md` (modified) — logged D-71-D and D-71-E.

## Decisions Made

1. **`HEAT_PAINT` exported (see Deviation 1).** The alternative — re-typing `#ff0000` / `#ff8c00` in the component — is exactly the drift the plan's own grep gate forbids.
2. **`HEAT_PAINT[year]['line-color']`, not `.color`.** The plan's action text says `.color`; 71-05 shipped mapbox paint keys (its Decision 1). Followed the shipped code.
3. **Hint is a function call in markup, not a `$derived` record.** The plan asked for a `$derived` string. Both are equally reactive (a markup expression re-runs when `$heatmapState` changes), and the record form cost 6 lines to prettier's type-argument wrapping — which put the file at 94 against a hard 90-line acceptance ceiling. Chose the ceiling.
4. **Collapse fallback is a flat `false`.** Per the plan, and commented in the file: the siblings' `!visible` rule assumes default-ON layers, and applying it to default-OFF layers would fold the whole feature away on first visit.
5. **Heat construction placed after the auth-subscribe block in `map.onLoad`, not spliced into it.** The plan said "after the `communityRoutesLayer` block"; that block's tail (`myConRunsLoadAttempted = false` and the subscription) belongs to the auth-gated machinery, so splitting it would have read as if heat were part of it. Same execution order, clearer intent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `HEAT_PAINT` was not exported by `heatmap-layer.ts`**
- **Found during:** Task 2
- **Issue:** The plan (and 71-05's own summary, which lists `HEAT_PAINT` among its exports) both assume the constant is importable. It is declared `const HEAT_PAINT`, module-private. The component cannot compile against it.
- **Fix:** Added `export` to the declaration in `heatmap-layer.ts`, with a comment recording why it is public (so the swatch and the line share one source of truth). No value, type or behaviour changed — one keyword.
- **Files modified:** `apps/run.gpx/gpx-studio/website/src/lib/components/map/heatmap-layer.ts` (outside this plan's declared `files_modified`; unavoidable, and the minimum possible edit).
- **Committed in:** `063684cc`

**2. [Rule 3 - Blocking] Three acceptance greps failed against my own comment prose**
- **Found during:** Task 2 and Task 3
- **Issue:** `grep -c trailing` and `grep -c '\$state'` must both return 0 for `HeatMap.svelte`, and `grep -c isAuthenticated` on `LayerControl.svelte` must be unchanged. My first drafts explained each landmine *by naming it* — "Section has no `trailing` prop", "NO `$state` in this file", "not inside the `isAuthenticated` subscription" — which tripped all three gates on comments, not code.
- **Fix:** Reworded each comment to describe the constraint without the forbidden token ("Section takes no snippet after its label", "NO LOCAL RUNE HOLDS STATE HERE", "the auth-gated subscription above"). Every warning is still in the file; only the wording moved.
- **Files modified:** `HeatMap.svelte`, `LayerControl.svelte`
- **Committed in:** `063684cc`, `868df636`

**3. [Rule 3 - Blocking] The component was 6 lines over the 90-line ceiling**
- **Found during:** Task 2
- **Issue:** First complete draft was 99 lines, then 94 after compressing prose. The acceptance criterion is a hard `wc -l ≤ 90`.
- **Fix:** Replaced the `hints` `$derived` record (6 lines, inflated by prettier wrapping the `as Record<HeatYear, string>` type argument) with a direct `detail($heatmapState[r.year])` call in the `Row`. Final: 88 lines with both landmine comments intact.
- **Committed in:** `063684cc`

### Out-of-scope, logged not fixed

- **D-71-D** — `LayerControl.svelte` fails `prettier --check` on the untouched tree. Proven pre-existing: a pristine `git show HEAD:` copy warns identically, and `prettier --write` on a copy of the working file changes only lines 125-186 and 375-377, none of which this plan added. Not reformatted — ~20 unrelated lines of churn would bury a 15-line diff.
- **D-71-E** — the studio's "30-error svelte-check baseline" is really 26 + 4 env-dependent errors (see below).

---

**Total deviations:** 3 auto-fixed (all Rule 3), 2 logged as out-of-scope
**Impact on plan:** None on scope or behaviour. Deviation 1 is a one-keyword unblock in a sibling file; 2 and 3 are wording and structure inside this plan's own new file.

## Issues Encountered

**The 30-error svelte-check baseline moved to 26 mid-plan, with no source change able to explain it.** Diffing the two machine-output transcripts showed the four departures are all the same message — `Module '"$env/static/public"' has no exported member 'PUBLIC_MAPBOX_TOKEN'` in `utils.ts`, `Map.svelte`, `embedding.ts`, `EmbeddingPlayground.svelte`. Cause: the Task 2 verification build (`PUBLIC_MAPBOX_TOKEN=pk.placeholder npm run build`) regenerated `.svelte-kit`'s `$env/static/public` type declaration *with* the token, retiring those four. Nothing to do with any source file, and the gate that matters — 0 errors attributed to changed files — held at every step. Logged as D-71-E so a future plan does not quote a bare "total must be 30" and mis-fire depending on whether a build ran first.

## Verification Results

| Gate | Command | Result |
|---|---|---|
| Type check (Task 1) | `svelte-check --output machine`, delta on `layer-section-collapse` | **PASS** — total 30, 0 on the changed file |
| Type check (Task 2) | delta on `HeatMap.svelte` + `heatmap-layer.ts` | **PASS** — total 30, 0 on changed files |
| Type check (Task 3) | delta on all four changed files | **PASS** — total 26 (= 30 − 4 env, D-71-E), 0 on changed files |
| Build (Task 2) | `PUBLIC_MAPBOX_TOKEN=pk.placeholder npm run build` | **PASS** — exit 0 |
| Build (Task 3) | same | **PASS** — exit 0, 4861 + 6792 modules, built in 16.94s / 25.68s |
| Format | `prettier --check` on the store, the component, `heatmap-layer.ts` | **PASS** |
| Format | `prettier --check LayerControl.svelte` | **PRE-EXISTING FAIL** — D-71-D; proven identical on the pristine HEAD copy, and no added line is implicated |
| ESLint | — | **BLOCKED (pre-existing)** — D-71-B, no flat config in the vendored package |
| No deps added | `git diff --stat .../website/package.json` | **PASS** — empty (T-71-SC) |

### Acceptance greps

**Task 1:** `heatmap: 'heatmap'` = 1; diff removes exactly one line (the doc-comment id list, replaced) and renames no existing id.

**Task 2 (`HeatMap.svelte`):**

| Assertion | Required | Actual |
|---|---|---|
| `wc -l` | ≤ 90 | 88 |
| `trailing` | 0 | 0 |
| `HintBar` | 0 | 0 |
| state rune | 0 | 0 |
| `SECTION.heatmap` | 2 | 2 |
| `DC34 — live` / `DC33 — the classic` | 1 / 1 | 1 / 1 |
| `#ff0000\|#ff8c00` | 0 | 0 |
| `relativeStamp` | ≥ 1 | 2 |
| `{@html` | 0 | 0 |

**Task 3 (`LayerControl.svelte`):** `new HeatmapLayer` = 1, `heatmapLayer.loadMeta` = 1, `HeatmapLayer | undefined = $state()` = 1, `<HeatMap layer={heatmapLayer} />` = 1, `isAuthenticated` = 4 (unchanged from HEAD). Ordering: `<PublicOverlays` 528 < `<HeatMap` 531 < `<MyConRuns` 534. The diff is pure addition — zero removed lines — so no `BasemapSection` / `*.length` guard line was touched.

## Threat Model Compliance

| Threat | Disposition | Evidence in shipped code |
|---|---|---|
| T-71-25 artifact meta rendered into the dialog | mitigate | stamp and hint strings reach the DOM only through Svelte text bindings and `data-hint`, both auto-escaping; `grep -c '{@html'` = 0 |
| T-71-26 malformed `generatedAt` | mitigate | `relativeStamp` already returns an em dash for null/unparseable; the component's own `exact()` guards `Date.parse` with `Number.isFinite` and returns `unknown` rather than constructing an Invalid Date — nothing in the render path can throw into the portalled dialog |
| T-71-27 hand-edited collapse store | accept | the store already coerces to booleans only |
| T-71-SC package installs | mitigate | none; `package.json` diff empty |

**Threat flags:** none — this plan adds no network endpoint, auth path, file access or schema. It renders state a prior plan already fetched.

## Known Stubs

None. Every row, toggle and stamp is wired to live behaviour. dc34's row not rendering today is the designed availability gate, not a stub — 71-07 publishes its artifact and the row appears with no further code change.

## User Setup Required

None.

## Next Phase Readiness

**Ready for 71-07 and 71-08.** 71-08 should re-run `70-06-probes/dialog-shell-probe.cjs` to convert this plan's section-order reasoning from source analysis into a live pass, and should confirm live that the DC33 row renders with a `~350d ago` stamp and a hint bar reading `Last built 8/15/2025, … · 110 runs · 658.4 km`.

Expected at UAT time before 71-07 runs: **one flame row (DC33)**, not two. A second row appearing is the signal 71-07's artifact landed.
