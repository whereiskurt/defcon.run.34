# gpx.studio map polish — z-order bands, route styling, Runners layer, copy

**Date:** 2026-08-02
**App:** `run.gpx` (gpx.defcon.run studio)
**Status:** approved, ready to plan

## Problem

Six issues on the public studio map, reported from a live screenshot at `?layers=routes#14.55/36.12964/-115.16137`:

1. Route lines paint **over** ghost pins and check-in cluster badges — the markers you are meant to click are buried under the lines.
2. Routes render as hard 10px pipes that dominate the map.
3. The PublicUs beacon label is two lines (`PublicUs / KPH Coffee`) where one would do.
4. The "Check out the routes" QuickStart card turns on **every** route folder, including Rabbit Routes.
5. CTA copy: "Log a run" and "Add run" should be activity-centric.
6. The live runner layer is forced on with no way to turn it off.

### Root cause of (1)

Of ~30 `map.addLayer(...)` call sites under `apps/run.gpx/gpx-studio/website/src/`, only **two** pass a `beforeId`:

- `gpx-layer/gpx-layer.ts:266` — direction arrows beneath `distance-markers`
- `heatmap-layer.ts:357` — DC33 heat line beneath DC34's

Every other layer is appended, landing on top of the stack at the moment it is created. Each family — public overlays, con runs, community routes, check-ins, ghosts, rabbits — adds its layers when **its own fetch resolves**. Stacking is therefore a load-timing race, not a design. Four bare `moveLayer(id)` calls (no anchor) make it worse by slamming layers to the absolute top:

- `gpx-layer.ts:394/397/400` (`moveToFront()`, fires on track selection)
- `gpx-layer/distance-markers.ts:84`
- `toolbar/tools/scissors/split-controls.ts:128`
- `toolbar/tools/reduce/utils.svelte.ts:157`

A targeted fix (anchor markers above a known route layer) cannot work: public route layer ids are per-file and created asynchronously, so the anchor frequently does not exist when the marker layers load. It would fix the screenshot and regress silently on a slow connection.

## Design

### 1. Z-order bands (`lib/components/map/z-bands.ts`, new)

Five zero-feature `line` layers on one shared empty GeoJSON source, installed **synchronously at style load** — before any feed resolves. Each anchor is the **ceiling** of its band:

| # | Anchor id | Band contents |
|---|---|---|
| 1 | `dc34-z-heat` | DC33/DC34 heatmaps |
| 2 | `dc34-z-routes` | all glow+core route pairs (public, community, con-runs), `public-all-runners` aggregate, route POIs, Overpass POIs, Deuce/Monorail, rainbow arches |
| 3 | `dc34-z-tracks` | user's own GPX layers, waypoints, direction arrows, distance markers |
| 4 | `dc34-z-markers` | check-in cluster/count/pin, live runner cluster/count/pin, ghost pins |
| 5 | `dc34-z-tools` | scissors split-controls, reduce preview, clean rectangle |

API:

```ts
export type Band = 'heat' | 'routes' | 'tracks' | 'markers' | 'tools';
export function installBands(map: mapboxgl.Map): void;          // idempotent
export function addInBand(map, spec, band, beneath?): void;     // addLayer(spec, beneath ?? anchor(band))
export function moveToBand(map, id: string, band: Band): void;  // moveLayer(id, anchor(band))
export function bandAnchor(band: Band): string;                 // pure, unit-testable
```

`addInBand` calls `installBands` defensively, so a basemap swap (`removeImport`/`addImport`, `LayerControl.svelte:113-134`) that ever wipes root layers self-heals.

The two existing `beforeId` uses are **preserved within their band** via the optional `beneath` parameter — `beneath ?? anchor(band)` — so DC33 stays under DC34 and arrows stay under distance markers.

The four bare `moveLayer(id)` calls become `moveToBand(...)`. This is load-bearing: without it, clicking a track re-runs `moveToFront()` and undoes the fix.

**Rationale for sentinels over the alternatives.** A central `restack()` sweep needs an explicit call after every add and leaves late-arriving feeds floating on top until the next trigger. A band-classifier helper avoids dummy layers but needs an id→band lookup table that must be kept in sync with every new layer id. Sentinels make the ordering explicit in the style (visible when debugging), need no lookup table, and are immune to arrival order.

### 2. Route styling — zoom-aware (`lib/components/map/route-style.ts`, new)

Constants are currently duplicated in four files (`public-overlays.ts:57-60`, `my-con-runs.ts:33-34`, `community-routes.ts:38-39`, `deuce-layer.ts`). Consolidate, and replace fixed widths with zoom interpolation:

```
core  = interpolate(linear, zoom, 12 → 3px, 16 → 8px) × (mapWeight / 4)   @ line-opacity 0.80
glow  = core × 3.6                                      line-blur 10      @ line-opacity 0.42
```

Today's values for comparison: core `(mapWeight ?? 4) × 2.5` = **10px flat** @ 0.95, glow 20px blur 6 @ 0.35.

CMS `mapWeight` scales the ramp; CMS `mapOpacity` still overrides core opacity per route.

**`gpx-layer.ts` is deliberately not touched.** It paints from `['get','width']` feature properties, it is the vendor-forked upstream file, and it draws the track being edited — which stays crisp so dragging points is unaffected.

### 3. Live runner layer becomes a full citizen

`RabbitLayer` (`dc34-rabbits`) is currently forced visible at `LayerControl.svelte:308-311` with no control row, no persistence, and no URL token — explicitly excluded by `layer-url.ts:30-32`. Bring it in:

- `layer-visibility.ts` — add `LAYER.runners = 'runners'`
- `layer-url.ts` — add `runners` to `LITERAL_TOKENS`, and update the out-of-scope doc comment (ghost mode stays excluded)
- `rabbit-layer.ts` — publish a `rabbitState` store (`{ available, visible }`), mirroring `heatmapState`
- `layer-control/LiveRunners.svelte` (new, ~40 lines) — one checkbox row, mirroring `HeatMap.svelte`
- `LayerControl.svelte:308-311` — replace the hard `setVisible(true)` with `storedVisible(LAYER.runners, true)` and apply the `requestedLayers()` override
- `LayerControl.svelte:440-441` — the QuickStart `runners` action persists ON through the same setter

Default **ON**. Choice persisted to `dc34LayerVisibility`. Deep-linkable in both directions like every other layer.

**Row label: "Runners on the Map"** — not "Live Runners", which sits confusingly next to the existing "All Runners" aggregate row.

Note: there are no simulated runners in the codebase. `rabbit-svg.ts` mentions "sim rabbits" but is dead code (nothing imports `rabbitSvg`); the layer serves real opted-in `verified && showOnMap` users from `/api/gpx/public/rabbits`.

### 4. "Check out the routes" scope

`LayerControl.svelte:427-438` loops every `publicOverlayGroups` entry. Filter to the DEF CON 34 folder — `DEFAULT_ON_FOLDER` already exists at `public-overlays.ts:55` and needs exporting.

**Behaviour:** the card turns DEF CON 34 routes **on** and leaves other folders exactly as they were. It does not force Rabbit Routes off. This differs deliberately from a `?layers=routes` deep link, which is authoritative in both directions — a card click is an additive user gesture, a deep link is a declared state.

### 5. Copy

| File:line | From | To |
|---|---|---|
| `QuickStartHub.svelte:173` | Log a run | Record Activity |
| `QuickStartHub.svelte:225` | Log a run (sub-flow header) | Record Activity |
| `Menu.svelte:571` (aria-label), `:574` | Add run | +Activity |
| `Menu.svelte:592` (aria-label), `:595` | Add run | +Activity |
| `coffee-cup.ts:73` | `PublicUs<br>KPH Coffee` | `PublicUs` |

Out of scope by decision: `CloudStorage.svelte:664` and `:1038` keep "Add run" (they sit in prose); `StravaStrip.svelte:406`'s tooltip is unchanged; the "Get today's run on the map" subtitle is unchanged.

None of these strings are i18n keys — gpx-studio uses a custom `i18n.svelte.ts` with `locales/en.json`, but all five are hardcoded DEF CON additions. No test asserts any of them.

## Testing

| What | How |
|---|---|
| `bandAnchor()` mapping and band ordering invariant | `npx vitest run` in `apps/run.gpx/webapp` (reaches into the studio tree, as `checkin-cluster.test.ts` already does) |
| `coreWidth()` / `glowWidth()` expressions evaluated at z12 / z14.55 / z16 | same |
| `runners` token parses and round-trips through `parseLayerParam` | same |
| No type regressions | `npx svelte-check` — **zero delta** against the branch point (~30 pre-existing upstream errors; count only changed files) |
| Real stacking on prod | Playwright probe: stub `**/use1/api/gpx/**` + `**/use1/api/user/**` first, mapbox token via `aws ssm get-parameter --with-decryption`, wait `window._map`, screenshot |

## Ship

Branch → PR → `gh pr merge --squash --admin` → `gh workflow run buildpub.yml -f apps=run.gpx -f regions=use1 -f deploy=false` → `gh workflow run deploy.yml -f region=us-east-1 -f pr_number=skip -f invalidate_cache=true`.

Check `gh run list --workflow=buildpub.yml` for in-flight run.gpx runs first — ECR repos are immutable and a concurrent same-app run causes a tag collision.

## Out of scope

- Ghost mode (`stores/ghost.ts`) visibility rules — unchanged, still outside `layer-visibility.ts`
- The `history` waypoint-only map
- Any change to `gpx-layer.ts` paint properties
- `mapillary.ts` street-view layers (control is unmounted)
