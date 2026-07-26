# The Deuce Bus Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hidden gpx.defcon.run map layer showing the RTC Deuce bus line (route polyline, stops, 8 simulated moving 🚌 markers), unlocked by searching `deuce` or pressing `2`×3, with a covert `deuce-egg` CTF award.

**Architecture:** Pure client-side. A Mapbox-free geometry/simulator module (`deuce-route.ts`) computes deterministic bus positions from wall-clock time; a `DeuceLayer` class binds it to Mapbox (line + circle layers + DOM markers on a 1 s tick); triggers reuse the geocoder hook and `recordHit`. One webapp change: a `DEFAULT_EGGS` modal entry.

**Tech Stack:** SvelteKit (vendored gpx-studio), Mapbox GL JS, Next.js App Router (webapp), vitest (webapp only), `npx tsx` sanity for studio-pure modules.

## Global Constraints

- All studio code under `apps/run.gpx/gpx-studio/website/src/lib/` (tracked source, not generated).
- Simulation constants: `ONE_WAY_MIN = 65`, `HEADWAY_MIN = 17`, `FLEET = ceil(130/17) = 8`; positions anchored to absolute epoch ms.
- Livery: RTC blue `#0067B1`, accent yellow `#FFD200`.
- New popups must include `dc34-route-popup` in className (global transparent-popup landmine).
- `prefers-reduced-motion` may kill the bob animation but NEVER position updates or visibility.
- Studio has no test runner: pure module verified via standalone `npx tsx` sanity script (scratchpad, not committed).
- Covert V must be `encodeFlag('deuce-egg','deuce')` computed with the real codec at `apps/run.human/webapp/src/lib/ctf-covert-codec.ts` — never hand-derived.

---

### Task 1: Route geometry — fetch, downsample, embed

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/map/deuce-route.ts`

**Interfaces:**
- Produces: `DEUCE_ROUTE: [number, number][]` (lng,lat, Fremont→Mandalay order), `DEUCE_STOPS: { name: string; lngLat: [number, number] }[]`, `ONE_WAY_MIN`, `HEADWAY_MIN`, `CYCLE_MIN`, `FLEET`, `routeCumulativeM(route): number[]`, `pointAtFraction(route, cum, f): [number, number]`, `busStates(nowMs): { id: number; lngLat: [number, number]; southbound: boolean }[]`

- [ ] **Step 1: Fetch road-following geometry from OSRM** with via-points that pin the path to Las Vegas Blvd (else it routes via I-15). Waypoints (lng,lat): Fremont `-115.1408,36.1706` → Strat `-115.1554,36.1475` → Convention Ctr Dr `-115.1633,36.1345` → Flamingo `-115.1717,36.1162` → Tropicana `-115.1721,36.1023` → Mandalay Bay `-115.1740,36.0921`:

```bash
curl -s "https://router.project-osrm.org/route/v1/driving/-115.1408,36.1706;-115.1554,36.1475;-115.1633,36.1345;-115.1717,36.1162;-115.1721,36.1023;-115.1740,36.0921?overview=full&geometries=geojson&continue_straight=true" > $SCRATCH/deuce-osrm.json
```

- [ ] **Step 2: Downsample** to ≤120 vertices with a simple tolerance pass (keep every point that deviates > ~10 m, plus endpoints); round coords to 5 decimals. Write a throwaway node script in scratchpad; verify total haversine length lands in 10–14 km and the polyline visually hugs LVB (spot-check a few known lat/lngs).

- [ ] **Step 3: Write `deuce-route.ts`** — pure module, no Mapbox import:

```ts
/** The Deuce — deterministic Strip-bus simulator (pure; no Mapbox). */
export const ONE_WAY_MIN = 65;
export const HEADWAY_MIN = 17;
export const CYCLE_MIN = 2 * ONE_WAY_MIN;
export const FLEET = Math.ceil(CYCLE_MIN / HEADWAY_MIN); // 8

export const DEUCE_ROUTE: [number, number][] = [/* embedded from Step 2 */];

export const DEUCE_STOPS: { name: string; lngLat: [number, number] }[] = [
    { name: 'Fremont Street Experience', lngLat: [-115.1408, 36.1706] },
    { name: 'The STRAT', lngLat: [-115.1554, 36.1475] },
    { name: 'SAHARA Las Vegas', lngLat: [-115.1565, 36.1421] },
    { name: 'Convention Center Dr', lngLat: [-115.1633, 36.1345] },
    { name: 'Fashion Show / Wynn', lngLat: [-115.1682, 36.1263] },
    { name: 'Caesars Palace', lngLat: [-115.1717, 36.1170] },
    { name: 'Bellagio', lngLat: [-115.1722, 36.1126] },
    { name: 'MGM Grand / Tropicana', lngLat: [-115.1721, 36.1023] },
    { name: 'Luxor', lngLat: [-115.1735, 36.0955] },
    { name: 'Mandalay Bay', lngLat: [-115.1740, 36.0921] },
];
// stops snapped to nearest route vertex at module init (see snapToRoute below)

const R = 6371000;
function haversineM(a: [number, number], b: [number, number]): number { /* standard */ }

export function routeCumulativeM(route: [number, number][]): number[] { /* [0, d1, d1+d2, ...] */ }
export function pointAtFraction(route, cum, f): [number, number] { /* clamp f to [0,1]; walk segments, lerp lng/lat */ }
export type BusState = { id: number; lngLat: [number, number]; southbound: boolean };
export function busStates(nowMs: number, route = DEUCE_ROUTE): BusState[] {
    // bus k: mins = nowMs/60000 + k*HEADWAY_MIN; cyclePos = ((mins % CYCLE_MIN) + CYCLE_MIN) % CYCLE_MIN
    // phase = cyclePos / ONE_WAY_MIN; southbound = phase < 1; f = southbound ? phase : 2 - phase
}
```

- [ ] **Step 4: Sanity suite** (scratchpad `deuce-sanity.ts`, run `npx tsx`): route length 10–14 km; `routeCumulativeM` strictly non-decreasing; `pointAtFraction` f=0/1 = endpoints, f=0.5 between; `busStates` returns 8, deterministic for equal `nowMs`, both directions present, positions all on-route bbox, one bus traverses end→end in 65 sim-minutes, spacing ≈ headway. All assertions pass.

- [ ] **Step 5: Commit** `feat(gpx): Deuce route geometry + deterministic bus simulator`

### Task 2: DeuceLayer (route line, stops, animated buses)

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/map/deuce-layer.ts`
- Create: `apps/run.gpx/gpx-studio/website/src/lib/stores/deuce.ts`

**Interfaces:**
- Consumes: everything from Task 1; `openEggModal(map, id, lngLat)` from `egg-modal.ts`.
- Produces: `class DeuceLayer { constructor(map); setVisible(on: boolean): void; remove(): void }`; store `deuceShown: Writable<boolean>`; `toggleDeuce(): void`.

- [ ] **Step 1: `stores/deuce.ts`** (mirror `stores/coffee.ts`):

```ts
import { writable } from 'svelte/store';
/** Whether the hidden Deuce bus layer is shown. Toggled by searching "deuce"
 * (map.ts externalGeocoder) or pressing 2-2-2 (GhostTrigger). */
export const deuceShown = writable(false);
export function toggleDeuce() {
    deuceShown.update((v) => !v);
}
```

- [ ] **Step 2: `deuce-layer.ts`** — the-spot marker template + public-overlays line template. Key shape (full code in file):

```ts
const SRC_ROUTE = 'dc34-deuce-route';
const LAYER_GLOW = 'dc34-deuce-route-glow';
const LAYER_CORE = 'dc34-deuce-route-core';
const SRC_STOPS = 'dc34-deuce-stops';
const LAYER_STOPS = 'dc34-deuce-stops';
const EGG_ID = 'dc34-deuce';

export class DeuceLayer {
    constructor(map) { this.map = map; }
    setVisible(on) {
        if (on && !this.built) this.whenStyleReady(() => this.build());
        // toggle line/circle visibility; add/remove markers; start/stop 1 s tick
    }
    private build() { /* addSource+glow+core line (visibility none), stops circle layer + click popup (className 'dc34-route-popup dc34-deuce-popup'), create FLEET markers via the-spot DOM template, tick() once */ }
    private tick() { /* busStates(Date.now()) -> marker.setLngLat, flip inner emoji scaleX by southbound */ }
    remove() { /* clearInterval, remove markers/layers/sources */ }
}
```

Bus marker element: outer `.dc34-deuce-bus` (click → `openEggModal(map, EGG_ID, current lngLat)`), inner `.dc34-deuce-bus-emoji` 🚌 with CSS bob (reduced-motion kills bob only) + `.dc34-deuce-label` "DEUCE" sign in livery colors. `ensureStyle()` injects `<style id="dc34-deuce-style">` once.

- [ ] **Step 3: tsx compile sanity** — `npx tsx --eval 'import("./deuce-layer.ts")'` is not possible (mapbox import); rely on svelte-check/build in Task 5. Visually re-read the file against ghost-layer.ts teardown checklist (interval cleared, layers+sources removed, markers removed).
- [ ] **Step 4: Commit** `feat(gpx): DeuceLayer — route line, stops, animated bus fleet`

### Task 3: Triggers (search + 2-2-2) and wiring

**Files:**
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/map/map.ts` (~line 102, beside coffee test)
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/GhostTrigger.svelte` (onKey, BEFORE the `!` early-return block)
- Modify: `apps/run.gpx/gpx-studio/website/src/lib/components/map/layer-control/LayerControl.svelte` (map.onLoad, beside coffee/spot)

**Interfaces:**
- Consumes: `toggleDeuce`, `deuceShown` (Task 2), `recordHit` (`stores/ghost.ts`), `fireDeuceEgg` (Task 4).

- [ ] **Step 1: map.ts geocoder** — add beside the coffee regex:

```ts
if (/\bdeuce\b/i.test(query)) toggleDeuce();
```

- [ ] **Step 2: GhostTrigger.svelte** — add `let deuceBuf: number[] = [];`, then inside `onKey` immediately before the `if (e.key !== '!')` block:

```ts
// The Deuce: press 2-2-2 quickly to toggle the Strip bus layer. Must sit
// before the '!' block below — that branch early-returns on every non-'!' key.
if (e.key === '2') {
    const r2 = recordHit(deuceBuf, Date.now(), 1500, 3);
    deuceBuf = r2.buf;
    if (r2.hit) toggleDeuce();
} else {
    deuceBuf = [];
}
```

- [ ] **Step 3: LayerControl.svelte** — declare `let deuceLayer: DeuceLayer | undefined = undefined;` beside coffeeCup/theSpot; inside `map.onLoad` next to the coffee block:

```ts
// The Deuce: hidden Strip bus layer (search "deuce" / press 2-2-2). First
// reveal fires the covert deuce-egg. Same single-subscription safety as above.
if (deuceLayer) deuceLayer.remove();
deuceLayer = new DeuceLayer(_map);
deuceShown.subscribe((on) => {
    void deuceLayer?.setVisible(on);
    if (on) fireDeuceEgg();
});
```

- [ ] **Step 4: Commit** `feat(gpx): Deuce triggers — search keyword + 2-2-2 gesture + layer wiring`

### Task 4: Egg modal entry + covert CTF

**Files:**
- Create: `apps/run.gpx/gpx-studio/website/src/lib/components/map/deuce-egg.ts`
- Modify: `apps/run.gpx/webapp/src/app/api/gpx/public/eggs/route.ts` (append `DEFAULT_EGGS` entry)
- Test: `apps/run.gpx/webapp/src/app/api/gpx/public/eggs/route.test.ts` (extend)

- [ ] **Step 1: Compute V** with the real codec:

```bash
cd apps/run.human/webapp && npx tsx -e "import('./src/lib/ctf-covert-codec.ts').then(m => { console.log(m.encodeFlag('deuce-egg','deuce')); console.log(JSON.stringify(m.decodeFlag(m.encodeFlag('deuce-egg','deuce')))); })"
```

Expected: round-trip decode `{"challenge":"deuce-egg","guess":"deuce"}`. Cross-check the codec is live-compatible by also encoding `('coffee-egg','coffee')` and matching `COFFEE_COVERT_V` in coffee-egg.ts.

- [ ] **Step 2: `deuce-egg.ts`** — copy coffee-egg.ts verbatim, rename to `fireDeuceEgg`, swap in the computed `DEUCE_COVERT_V`, update the doc comment.
- [ ] **Step 3: eggs route entry** (append to `DEFAULT_EGGS`):

```ts
{
  id: "dc34-deuce",
  eyebrow: "Strip Transit",
  title: "🚌 The Deuce",
  titleUrl: "https://www.rtcsnv.com/ways-to-travel/transit-services/the-deuce/",
  descriptionHtml:
    "<p><strong>The Deuce</strong> — RTC's double-decker running the Strip 24/7, " +
    "Fremont Street to Mandalay Bay. $8 buys you 24 hours of air-conditioned " +
    "recovery when your legs give out. Ride the top deck at night.</p>",
  address: "Las Vegas Blvd, end to end",
  accent: "#0067B1",
  links: [mapLink(36.1475, -115.1554)],
},
```

- [ ] **Step 4: Extend eggs route vitest** — follow the existing test file's pattern; assert the response includes `dc34-deuce` with accent `#0067B1` and a titleUrl. Run `npx vitest run src/app/api/gpx/public/eggs` → PASS.
- [ ] **Step 5: Commit** `feat(gpx): Deuce egg modal + covert deuce-egg CTF award`

### Task 5: Local verification gates

- [ ] **Step 1:** Re-run tsx sanity suite (Task 1) → all pass.
- [ ] **Step 2:** Webapp: `cd apps/run.gpx/webapp && npx vitest run` (Node ≥22.12, `nvm use 22.12.0` if needed) → all pass; `npx tsc --noEmit` → clean.
- [ ] **Step 3:** Studio build: `cd apps/run.gpx && ./build-frontend.sh` → completes; grep built output for `dc34-deuce` to confirm inclusion.
- [ ] **Step 4:** Commit any fixes; final commit.

### Task 6: Ship + seed + live verify

- [ ] **Step 1:** Push branch; `gh pr create`; `gh pr merge --squash --admin` (pre-authorized by Kurt).
- [ ] **Step 2:** `gh workflow run buildpub.yml -f apps=run.gpx -f regions=use1`; watch NEWEST run (concurrency-cancel gotcha); confirm Release PR auto-merged with new version.
- [ ] **Step 3:** `gh workflow run deploy.yml -f region=us-east-1 -f pr_number=skip -f invalidate_cache=true`; watch green; allow 3–4 min ECS/CF flip lag.
- [ ] **Step 4: Seed Ctf row** — compute `hashAnswer('deuce')` with run.human's hasher + DEFAULT_SALT `dc34-ctf-answer-salt-v1`, then AWS CLI (`AWS_PROFILE=dc34-application`) `put-item` into `run-human-electro`: pk `$run#challenge_deuce-egg`, sk `$ctf_1`, `__edb_e__` Ctf, enabled true, points/pointMax/pointFloor 1, maxSolves 100000, solveCount 0, condition `attribute_not_exists(pk)`. Clone field shape from the existing rainbow-egg item (`get-item` first).
- [ ] **Step 5: Live verify** — cache-busted fetch of `/use1/studio/app` (reject `<!DOCTYPE` fallback poisoning), grep hashed chunks for `dc34-deuce` + `0067B1` + a route coord; Playwright on prod origin with rainbow recipe (stub session + mapbox-token from SSM, `setTerrain(null)`, small viewport): search `deuce` → route+stops+8 buses appear; wait ~90 s → bus positions changed; press `222` → layer toggles off/on; covert `<link>` href carries correct V; click a bus → Deuce modal.
- [ ] **Step 6:** Update memory + land the plane (push, clean up).
