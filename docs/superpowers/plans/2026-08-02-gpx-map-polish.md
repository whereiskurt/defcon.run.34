# gpx.studio Map Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put ghosts, check-in clusters and live runners above route lines; soften routes to a zoom-aware neon; give the runner layer a real toggle; stop the routes card enabling Rabbit Routes; refresh three CTA strings.

**Architecture:** Five invisible "anchor" layers installed synchronously at style load define a fixed z-order. Every `addLayer` inserts beneath its band's anchor, so async feed arrival order stops mattering. Route paint constants — duplicated across four files today — consolidate into one module with zoom-interpolated widths.

**Tech Stack:** Svelte 5 (runes), mapbox-gl v3 (style-import fragments, not Standard slots), TypeScript, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-02-gpx-map-polish-design.md`
- Node **22.12.0** (`nvm use 22.12.0`) — vitest requires ≥22.12
- gpx-studio deps install **only** via `apps/run.gpx/./build-frontend.sh`; a bare `npm install` in `website/` fails
- `npx svelte-check` has **~30 pre-existing upstream errors** — the gate is *zero delta*, not zero errors. Baseline before touching anything.
- `gpx-layer.ts` paint properties are **never** modified (vendor fork; draws the track being edited)
- Ghost *mode* (`stores/ghost.ts`) stays outside `layer-visibility.ts`
- Bundle greps for prod verification must include a **control string** — a component chunk only loads on demand
- Repo path prefix for all studio files below: `apps/run.gpx/gpx-studio/website/src/`

---

### Task 1: Z-band module

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/map/z-bands.ts`
- Test: `apps/run.gpx/webapp/src/lib/z-bands.test.ts`

**Interfaces:**
- Produces: `Band`, `BANDS`, `bandAnchor(band): string`, `installBands(map): void`, `addInBand(map, spec, band, beneath?): void`, `moveToBand(map, id, band): void`

- [ ] **Step 1: Baseline svelte-check before any edit**

```bash
cd apps/run.gpx/gpx-studio/website && npx svelte-check 2>&1 | tail -3 > /tmp/svelte-baseline.txt
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/run.gpx/webapp/src/lib/z-bands.test.ts
import { describe, it, expect } from 'vitest';
import { BANDS, bandAnchor, installBands, addInBand, moveToBand }
  from '../../../gpx-studio/website/src/lib/components/map/z-bands';

/** Minimal mapbox-gl stand-in that records stack order. */
function fakeMap() {
  const layers: string[] = [];
  const sources = new Set<string>();
  return {
    layers,
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    addSource: (id: string) => { sources.add(id); },
    getLayer: (id: string) => (layers.includes(id) ? { id } : undefined),
    addLayer: (spec: { id: string }, before?: string) => {
      const at = before ? layers.indexOf(before) : -1;
      if (at === -1) layers.push(spec.id); else layers.splice(at, 0, spec.id);
    },
    moveLayer: (id: string, before?: string) => {
      const cur = layers.indexOf(id);
      if (cur !== -1) layers.splice(cur, 1);
      const at = before ? layers.indexOf(before) : -1;
      if (at === -1) layers.push(id); else layers.splice(at, 0, id);
    },
  };
}

describe('z-bands', () => {
  it('declares bands bottom-to-top', () => {
    expect(BANDS).toEqual(['heat', 'routes', 'tracks', 'markers', 'tools']);
  });

  it('installs one anchor per band, in order, idempotently', () => {
    const m = fakeMap();
    installBands(m as never);
    installBands(m as never);
    expect(m.layers).toEqual(BANDS.map(bandAnchor));
  });

  it('keeps markers above routes no matter which arrives first', () => {
    const m = fakeMap();
    installBands(m as never);
    addInBand(m as never, { id: 'ghosts' }, 'markers');
    addInBand(m as never, { id: 'route-a' }, 'routes');
    expect(m.layers.indexOf('ghosts')).toBeGreaterThan(m.layers.indexOf('route-a'));
  });

  it('honours an in-band beneath anchor', () => {
    const m = fakeMap();
    installBands(m as never);
    addInBand(m as never, { id: 'heat-dc34' }, 'heat');
    addInBand(m as never, { id: 'heat-dc33' }, 'heat', 'heat-dc34');
    expect(m.layers.indexOf('heat-dc33')).toBeLessThan(m.layers.indexOf('heat-dc34'));
  });

  it('ignores a beneath anchor that does not exist yet', () => {
    const m = fakeMap();
    installBands(m as never);
    addInBand(m as never, { id: 'arrows' }, 'tracks', 'distance-markers');
    expect(m.layers).toContain('arrows');
    expect(m.layers.indexOf('arrows')).toBeLessThan(m.layers.indexOf(bandAnchor('tracks')));
  });

  it('moveToBand re-seats a layer inside its band instead of the top', () => {
    const m = fakeMap();
    installBands(m as never);
    addInBand(m as never, { id: 'track' }, 'tracks');
    addInBand(m as never, { id: 'ghosts' }, 'markers');
    moveToBand(m as never, 'track', 'tracks');
    expect(m.layers.indexOf('track')).toBeLessThan(m.layers.indexOf('ghosts'));
  });

  it('self-installs when a caller skipped installBands', () => {
    const m = fakeMap();
    addInBand(m as never, { id: 'ghosts' }, 'markers');
    expect(m.layers).toContain(bandAnchor('heat'));
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
nvm use 22.12.0 && cd apps/run.gpx/webapp && npx vitest run src/lib/z-bands.test.ts
```
Expected: FAIL — cannot resolve `z-bands`.

- [ ] **Step 4: Implement**

```ts
// apps/run.gpx/gpx-studio/website/src/lib/components/map/z-bands.ts
import type mapboxgl from 'mapbox-gl';

/**
 * Explicit paint order for every DEF CON map layer.
 *
 * WHY THIS EXISTS — of ~30 addLayer() calls in this tree, two passed a beforeId. Every
 * other layer was appended, landing on top at the moment it was created, and each family
 * (public overlays, con runs, community routes, check-ins, ghosts, rabbits) adds its
 * layers when ITS OWN fetch resolves. Stacking was therefore a race: on a slow link the
 * routes landed last and buried the very markers you are meant to click.
 *
 * HOW — five zero-feature anchor layers are installed SYNCHRONOUSLY at style load, before
 * any feed resolves. Each anchor is the CEILING of its band, so inserting "before" it puts
 * you inside that band. Arrival order stops mattering entirely.
 *
 * The anchors are real layers on purpose: they cost nothing (no features), they need no
 * id->band lookup table to be kept in sync, and the ordering is visible in the style when
 * you are debugging a stack that looks wrong.
 */
export const BANDS = ['heat', 'routes', 'tracks', 'markers', 'tools'] as const;
export type Band = (typeof BANDS)[number];

const SOURCE = 'dc34-z-anchors';

const ANCHOR: Record<Band, string> = {
    heat: 'dc34-z-heat',
    routes: 'dc34-z-routes',
    tracks: 'dc34-z-tracks',
    markers: 'dc34-z-markers',
    tools: 'dc34-z-tools',
};

/** The layer id that marks the top of `band`. Pure — safe to assert on in tests. */
export function bandAnchor(band: Band): string {
    return ANCHOR[band];
}

/**
 * Idempotent. Call once at style load; every helper below also calls it defensively so a
 * basemap swap that ever wiped root layers self-heals.
 *
 * ORDER MATTERS ON FIRST INSTALL: anchors appended to a stack that already holds content
 * would sit ABOVE it, dropping that content into the bottom band. That is why map.ts
 * installs before LayerControl constructs anything.
 */
export function installBands(map: mapboxgl.Map): void {
    if (!map.getSource(SOURCE)) {
        map.addSource(SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
        });
    }
    for (const band of BANDS) {
        const id = ANCHOR[band];
        if (!map.getLayer(id)) {
            map.addLayer({ id, type: 'line', source: SOURCE, layout: { visibility: 'none' } });
        }
    }
}

/**
 * `beneath` preserves a relative rule that already exists INSIDE a band (DC33 under DC34,
 * direction arrows under distance markers). It is ignored when that layer is not on the
 * map yet, which is the common case on a cold load.
 */
export function addInBand(
    map: mapboxgl.Map,
    spec: mapboxgl.AnyLayer,
    band: Band,
    beneath?: string
): void {
    installBands(map);
    const before = beneath && map.getLayer(beneath) ? beneath : ANCHOR[band];
    map.addLayer(spec, before);
}

/**
 * Replaces bare `moveLayer(id)`, which moves to the ABSOLUTE top of the stack. Four call
 * sites did that — most damagingly GPXLayer.moveToFront(), which fires on every track
 * selection and would otherwise undo this module's whole purpose on the first click.
 */
export function moveToBand(map: mapboxgl.Map, id: string, band: Band): void {
    if (!map.getLayer(id)) return;
    installBands(map);
    map.moveLayer(id, ANCHOR[band]);
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd apps/run.gpx/webapp && npx vitest run src/lib/z-bands.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/run.gpx/gpx-studio/website/src/lib/components/map/z-bands.ts apps/run.gpx/webapp/src/lib/z-bands.test.ts
git commit -m "feat(gpx): z-band anchors for deterministic map layer order"
```

---

### Task 2: Install bands and convert every call site

**Files:**
- Modify: `lib/components/map/map.ts` (style-load hook — install before anything else)
- Modify: `ghost-layer.ts:83`, `rabbit-layer.ts:83/93/104`, `public-overlays.ts:613/828/886/902/1004/1019/1143`, `my-con-runs.ts:290/305`, `community-routes.ts:341/355`, `deuce-layer.ts:120/129/160`, `heatmap-layer.ts:357`, `rainbow-arch.ts:64`, `layer-control/overpass-layer.ts:88`
- Modify: `gpx-layer/gpx-layer.ts:192/228/266` and `:394/397/400`, `gpx-layer/distance-markers.ts:47/84`
- Modify: `toolbar/tools/Clean.svelte:66`, `toolbar/tools/reduce/utils.svelte.ts:147/157`, `toolbar/tools/scissors/split-controls.ts:111/128`

**Interfaces:**
- Consumes: `addInBand`, `moveToBand`, `installBands`, `Band` from Task 1

- [ ] **Step 1: Install at style load**

In `map.ts`, immediately after the map's style is ready (the same place the style-import fragments are registered), call `installBands(map)`. This must run before `LayerControl`'s `map.onLoad` constructs any layer class.

- [ ] **Step 2: Convert band by band**

Mechanical substitution — `this.map.addLayer(SPEC)` becomes `addInBand(this.map, SPEC, '<band>')`:

| Band | Layers |
|---|---|
| `heat` | `heatmap-layer.ts:357` — keep its `beneath` as the 4th argument |
| `routes` | `public-overlays.ts:613` (aggregate), `:1004`/`:1019` (glow/core), `:1143` (POI); `my-con-runs.ts:290/305`; `community-routes.ts:341/355`; `deuce-layer.ts:120`×2/`:129`/`:160`; `rainbow-arch.ts:64`; `overpass-layer.ts:88` |
| `tracks` | `gpx-layer.ts:192/228`, `:266` (pass existing `distance-markers` value as `beneath`), `distance-markers.ts:47` |
| `markers` | `public-overlays.ts:828/886/902`; `rabbit-layer.ts:83/93/104`; `ghost-layer.ts:83` |
| `tools` | `Clean.svelte:66`, `reduce/utils.svelte.ts:147`, `split-controls.ts:111` |

- [ ] **Step 3: Fix the four bare moveLayer calls**

`gpx-layer.ts:394/397/400` (`moveToFront`) and `distance-markers.ts:84` → `moveToBand(map, id, 'tracks')`. `split-controls.ts:128` and `reduce/utils.svelte.ts:157` → `moveToBand(map, id, 'tools')`.

- [ ] **Step 4: Verify no bare appends remain**

```bash
cd apps/run.gpx/gpx-studio/website/src
grep -rn "\.addLayer(" lib/ | grep -v "z-bands.ts" | grep -v "addInBand"
grep -rn "\.moveLayer(" lib/ | grep -v "z-bands.ts"
```
Expected: only `mapillary.ts` (third-party street-view control, unmounted) remains.

- [ ] **Step 5: svelte-check delta must be zero**

```bash
cd apps/run.gpx/gpx-studio/website && npx svelte-check 2>&1 | tail -3
```
Compare against `/tmp/svelte-baseline.txt`.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix(gpx): ghosts, clusters and runners paint above route lines"
```

---

### Task 3: Zoom-aware route styling

**Files:**
- Create: `lib/components/map/route-style.ts`
- Test: `apps/run.gpx/webapp/src/lib/route-style.test.ts`
- Modify: `public-overlays.ts:57-60` + `:993-1030`, `my-con-runs.ts:33-34` + `:290-313`, `community-routes.ts:38-39` + `:341-365`, `deuce-layer.ts`

**Interfaces:**
- Produces: `ROUTE_BLUR`, `CORE_OPACITY`, `GLOW_OPACITY`, `coreWidth(weight?)`, `glowWidth(weight?)`, `coreWidthAt(zoom, weight?)`

- [ ] **Step 1: Write the failing test**

```ts
// apps/run.gpx/webapp/src/lib/route-style.test.ts
import { describe, it, expect } from 'vitest';
import { coreWidth, glowWidth, coreWidthAt, ROUTE_BLUR, CORE_OPACITY, GLOW_OPACITY }
  from '../../../gpx-studio/website/src/lib/components/map/route-style';

describe('route-style', () => {
  it('interpolates the core 3px at z12 to 8px at z16', () => {
    expect(coreWidthAt(12)).toBeCloseTo(3);
    expect(coreWidthAt(16)).toBeCloseTo(8);
    // the zoom the reported screenshot was taken at
    expect(coreWidthAt(14.55)).toBeCloseTo(6.1125, 3);
  });

  it('is thinner at every zoom than the old flat 10px', () => {
    for (const z of [12, 13, 14.55, 16]) expect(coreWidthAt(z)).toBeLessThan(10);
  });

  it('scales with the CMS mapWeight, nominal 4', () => {
    expect(coreWidthAt(16, 4)).toBeCloseTo(8);
    expect(coreWidthAt(16, 8)).toBeCloseTo(16);
    expect(coreWidthAt(16, 2)).toBeCloseTo(4);
  });

  it('emits a mapbox linear-zoom interpolate expression matching coreWidthAt', () => {
    const e = coreWidth() as unknown[];
    expect(e[0]).toBe('interpolate');
    expect(e[1]).toEqual(['linear']);
    expect(e[2]).toEqual(['zoom']);
    expect(e[3]).toBe(12);
    expect(e[4]).toBeCloseTo(coreWidthAt(12));
    expect(e[5]).toBe(16);
    expect(e[6]).toBeCloseTo(coreWidthAt(16));
  });

  it('makes the glow 3.6x the core at both stops', () => {
    const c = coreWidth() as number[];
    const g = glowWidth() as number[];
    expect(g[4] / c[4]).toBeCloseTo(3.6);
    expect(g[6] / c[6]).toBeCloseTo(3.6);
  });

  it('is softer and less shouty than the shipped values (blur 6, core .95, glow .35)', () => {
    expect(ROUTE_BLUR).toBeGreaterThan(6);
    expect(CORE_OPACITY).toBeLessThan(0.95);
    expect(GLOW_OPACITY).toBeGreaterThan(0.35);
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL (module missing)**

```bash
cd apps/run.gpx/webapp && npx vitest run src/lib/route-style.test.ts
```

- [ ] **Step 3: Implement**

```ts
// apps/run.gpx/gpx-studio/website/src/lib/components/map/route-style.ts
/**
 * One source of truth for the DEF CON neon route look — glow halo under a crisp core.
 *
 * These constants lived in four files (public-overlays, my-con-runs, community-routes,
 * deuce-layer), all with the same values and no link between them.
 *
 * WIDTH FOLLOWS ZOOM. The old core was a flat (mapWeight ?? 4) * 2.5 = 10px, which reads
 * as a fat pipe at street zoom and as clutter when the whole Strip is on screen. Kurt
 * picked the interpolated option (2026-08-02): thin when zoomed out, full-bodied close in.
 *
 * NOT USED BY gpx-layer.ts — that draws the track you are editing, straight from feature
 * properties, and stays crisp so dragging points is unaffected.
 */
type ZoomExpr = ['interpolate', ['linear'], ['zoom'], number, number, number, number];

/** Nominal CMS `mapWeight`; 4 is what a route without a curated weight gets. */
export const NOMINAL_WEIGHT = 4;

const CORE_AT_Z12 = 3;
const CORE_AT_Z16 = 8;
const GLOW_RATIO = 3.6;

export const ROUTE_BLUR = 10;
export const CORE_OPACITY = 0.8;
export const GLOW_OPACITY = 0.42;

/** Plain linear interpolation, mirroring what mapbox does with the expression below. */
export function coreWidthAt(zoom: number, weight: number = NOMINAL_WEIGHT): number {
    const scale = weight / NOMINAL_WEIGHT;
    const t = Math.min(1, Math.max(0, (zoom - 12) / 4));
    return (CORE_AT_Z12 + (CORE_AT_Z16 - CORE_AT_Z12) * t) * scale;
}

function ramp(lo: number, hi: number): ZoomExpr {
    return ['interpolate', ['linear'], ['zoom'], 12, lo, 16, hi];
}

export function coreWidth(weight: number = NOMINAL_WEIGHT): ZoomExpr {
    const s = weight / NOMINAL_WEIGHT;
    return ramp(CORE_AT_Z12 * s, CORE_AT_Z16 * s);
}

export function glowWidth(weight: number = NOMINAL_WEIGHT): ZoomExpr {
    const s = (weight / NOMINAL_WEIGHT) * GLOW_RATIO;
    return ramp(CORE_AT_Z12 * s, CORE_AT_Z16 * s);
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Apply at the four renderers**

In `public-overlays.ts:993-1030`: drop `CORE_WIDTH`/`GLOW_BLUR`/`WIDTH_SCALE` and the local `coreW`/`glowW`; glow becomes `'line-width': glowWidth(m.mapWeight), 'line-blur': ROUTE_BLUR, 'line-opacity': GLOW_OPACITY`; core becomes `'line-width': coreWidth(m.mapWeight), 'line-opacity': m.mapOpacity ?? CORE_OPACITY`. **`m.mapOpacity` must still win.** Same substitution in `my-con-runs.ts`, `community-routes.ts` and `deuce-layer.ts`, which pass no weight and take the default.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(gpx): zoom-aware route widths, softer neon glow"
```

---

### Task 4: Runners layer becomes a real toggle

**Files:**
- Modify: `lib/stores/layer-visibility.ts` (add `LAYER.runners`)
- Modify: `lib/stores/layer-url.ts` (add token, update the out-of-scope comment)
- Modify: `lib/components/map/rabbit-layer.ts` (publish `rabbitState`)
- Modify: `lib/components/map/layer-control/LayerControl.svelte:308-311` and `:440-441`
- Modify: `lib/components/map/layer-control/PublicOverlays.svelte` (new row)
- Test: `apps/run.gpx/webapp/src/lib/layer-url.test.ts` (extend if present, else create)

**DEVIATION FROM SPEC, deliberate:** the spec proposed a standalone `LiveRunners.svelte` with its own `Section`. A one-checkbox Section needs a new `SECTION` collapse key and separates this toggle from the two it belongs with. Instead the row goes into `PublicOverlays.svelte` beside "All Runners" and "User Check-ins", with `rabbitLayer` passed in as an optional prop. Fewer files, better grouping. Note it in the PR body.

- [ ] **Step 1: Write the failing test for the URL token**

```ts
import { describe, it, expect } from 'vitest';
import { parseLayerParam } from '../../../gpx-studio/website/src/lib/stores/layer-url';
import { LAYER } from '../../../gpx-studio/website/src/lib/stores/layer-visibility';

describe('?layers= runners token', () => {
  it('parses runners as a literal key', () => {
    expect(parseLayerParam('runners')?.keys.has(LAYER.runners)).toBe(true);
  });
  it('still parses alongside folder aliases', () => {
    const sel = parseLayerParam('routes,runners');
    expect(sel?.folders.has('DEF CON 34 Maps')).toBe(true);
    expect(sel?.keys.has(LAYER.runners)).toBe(true);
  });
  it('leaves runners unnamed when the param names only routes', () => {
    expect(parseLayerParam('routes')?.keys.has(LAYER.runners)).toBe(false);
  });
});
```

Note: `parseLayerParam` must be exported. If it is currently module-private, export it — `requestedLayers()` stays the memoized public entry point.

- [ ] **Step 2: Run it, confirm FAIL**

- [ ] **Step 3: Implement**

`layer-visibility.ts` — add `runners: 'runners'` to the `LAYER` object and document it in the key-shape comment block alongside `checkins`/`aggregate`.

`layer-url.ts` — add `LAYER.runners` to `LITERAL_TOKENS`; amend the "OUT OF SCOPE, DELIBERATELY" comment so it names ghost mode only.

`rabbit-layer.ts` — add, mirroring `heatmapState`:
```ts
export type RabbitState = { available: boolean; visible: boolean; count: number };
export const rabbitState = writable<RabbitState>({ available: false, visible: false, count: 0 });
```
Set `available: true` and `count` after the first successful poll; mirror `visible` inside `setVisible()`.

`LayerControl.svelte:308-311` — replace the unconditional `void rabbitLayer.setVisible(true)` with the standard seeding idiom used by every other family: `requestedLayers()` override if the URL names anything, else `storedVisible(LAYER.runners, true)`. Default stays ON.

`LayerControl.svelte:440-441` — the QuickStart `runners` action must persist through `setLayerVisible(LAYER.runners, true)`, not just flip the layout property.

`PublicOverlays.svelte` — add a `Row` labelled **"Runners on the Map"** (not "Live Runners" — "All Runners" is already a row and the two would be indistinguishable), gated on `$rabbitState.available`, wired to `rabbitLayer?.setVisible(v)`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(gpx): Runners on the Map is a real layer toggle, default on"
```

---

### Task 5: Routes card stops enabling Rabbit Routes

**Files:**
- Modify: `public-overlays.ts:55` (export `DEFAULT_ON_FOLDER`)
- Modify: `layer-control/LayerControl.svelte:427-438`

- [ ] **Step 1: Export the constant**

`public-overlays.ts:55` — `export const DEFAULT_ON_FOLDER = 'DEF CON 34 Maps';`

- [ ] **Step 2: Filter the loop**

`LayerControl.svelte:427-438` currently iterates every group. Skip any group whose `folderName !== DEFAULT_ON_FOLDER` — both the `setGroupVisible` call and the `setSectionCollapsed` unfold. Other folders are left **exactly as they were**; the card does not force Rabbit Routes off (a card click is additive, unlike a `?layers=` deep link which is authoritative both ways).

- [ ] **Step 3: Manual check**

Dev server, tick Rabbit Routes on, click "Check out the routes": DEF CON 34 Routes turns on and unfolds; Rabbit Routes stays exactly as it was. Repeat with Rabbit Routes off: it stays off.

- [ ] **Step 4: Commit**

```bash
git commit -am "fix(gpx): routes card enables DEF CON 34 routes only"
```

---

### Task 6: Copy

**Files:**
- Modify: `lib/components/QuickStartHub.svelte:173`, `:225`
- Modify: `lib/components/Menu.svelte:571`, `:574`, `:592`, `:595`
- Modify: `lib/components/map/coffee-cup.ts:73`

- [ ] **Step 1: Apply**

| File:line | From | To |
|---|---|---|
| `QuickStartHub.svelte:173` | `Log a run` | `Record Activity` |
| `QuickStartHub.svelte:225` | `Log a run` | `Record Activity` |
| `Menu.svelte:571` aria-label, `:574` | `Add run` | `+Activity` |
| `Menu.svelte:592` aria-label, `:595` | `Add run` | `+Activity` |
| `coffee-cup.ts:73` | `PublicUs<br>KPH Coffee` | `PublicUs` |

Leave `CloudStorage.svelte:664`/`:1038` and `StravaStrip.svelte:406` on "Add run" — they read as prose. None of these are i18n keys and no test asserts them.

- [ ] **Step 2: Confirm nothing else references the old strings as UI**

```bash
grep -rn "Log a run\|Add run\|KPH Coffee" apps/run.gpx/gpx-studio/website/src/
```
Expected: only comments plus the three intentionally-unchanged prose sites.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(gpx): Record Activity / +Activity CTAs, shorter PublicUs label"
```

---

### Task 7: Verify, ship, deploy

- [ ] **Step 1: Full test suite + type gate**

```bash
nvm use 22.12.0
cd apps/run.gpx/webapp && npx vitest run
cd ../gpx-studio/website && npx svelte-check 2>&1 | tail -3   # zero delta vs baseline
```

- [ ] **Step 2: Build the frontend to prove it compiles**

```bash
cd apps/run.gpx && ./build-frontend.sh
```

- [ ] **Step 3: PR**

```bash
git push -u origin feat/gpx-map-polish-zorder
gh pr create --title "feat(gpx): map z-order bands, softer routes, Runners toggle" --body "..."
```

- [ ] **Step 4: Check for an in-flight run.gpx release before merging**

```bash
gh run list --workflow=buildpub.yml --limit 10
```
ECR repos are immutable — a concurrent same-app run collides on the tag. Different apps concurrently are fine.

- [ ] **Step 5: Merge**

```bash
gh pr merge --squash --admin
```
`fatal: 'main' is already used by worktree` means the local branch delete failed — **the merge still succeeded**. Confirm with `gh pr view --json state`.

- [ ] **Step 6: Build + publish**

```bash
gh workflow run buildpub.yml -f apps=run.gpx -f regions=use1 -f deploy=false
```
`deploy=false` matters: the inline deploy ships the *previous* image.

- [ ] **Step 7: Deploy**

```bash
gh workflow run deploy.yml -f region=us-east-1 -f pr_number=skip -f invalidate_cache=true
```
`pr_number=skip` because buildpub already merged its own Release PR.

- [ ] **Step 8: Verify on prod**

Confirm the served gpx version advanced, then walk the chunk graph for a marker string from this change (e.g. `Runners on the Map`) **plus a control string** that should also be present — a component chunk loads on demand, so a bare grep can report a false negative. Only `/{region}/studio/app` is a terminal URL; never probe the bare origin, which drops query and hash.

- [ ] **Step 9: Report to Kurt with the live version and what to look at**

## Self-Review

**Spec coverage:** z-bands → Tasks 1-2. Route styling → Task 3. Runners layer → Task 4. Routes card → Task 5. Copy (all five strings) → Task 6. Testing + ship → Task 7. No gaps.

**Placeholders:** none — every code step carries real code; the PR body is the only `"..."` and is written at the time.

**Type consistency:** `addInBand(map, spec, band, beneath?)` and `moveToBand(map, id, band)` are used with those exact signatures in Task 2. `coreWidth`/`glowWidth`/`coreWidthAt`/`ROUTE_BLUR`/`CORE_OPACITY`/`GLOW_OPACITY` defined in Task 3 Step 3 match the names used in Task 3 Step 5 and the tests in Step 1. `LAYER.runners` is defined in Task 4 and used by the Task 4 test.

**Known deviation:** Task 4 folds the runners row into `PublicOverlays.svelte` rather than creating `LiveRunners.svelte` — rationale recorded in Task 4.
