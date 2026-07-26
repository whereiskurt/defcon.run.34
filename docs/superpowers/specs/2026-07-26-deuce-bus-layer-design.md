# The Deuce — Vegas Strip Bus Easter-Egg Layer (gpx.defcon.run)

**Date:** 2026-07-26
**Status:** Approved (Kurt: full autonomous ship to prod use1)
**Siblings:** rainbow arches, ghost/rabbit layers, coffee cup / the-spot markers

## What

A hidden map layer on gpx.defcon.run showing the RTC **Deuce** double-decker bus
line: the route polyline down Las Vegas Blvd (Fremont Street Experience ↔
Mandalay Bay), named stop dots, and a fleet of animated 🚌 markers that visibly
crawl the Strip in "real-time-ish" fashion. Unlock via typing **`deuce`** in the
map search or pressing **`2` three times quickly**. First unlock fires a covert
CTF flag (`deuce-egg`, 1 pt).

## Decisions (Kurt, 2026-07-26)

1. **Bus data: simulated schedule.** No server lookup. Positions are a pure
   function of wall-clock time, so every viewer sees the same buses and nothing
   can break during con week.
2. **Route extent: full line** — Fremont Street Experience to Mandalay Bay via
   Las Vegas Blvd.
3. **Fleet: realistic** — ~17-min headway over a ~65-min one-way run ⇒ 8 buses
   (4 per direction) looping continuously, 24/7 like the real Deuce.
4. **CTF: yes** — covert-channel award on first unlock, rainbow/coffee pattern.
5. **Ship scope: full** — merge --admin, buildpub, deploy.yml use1, seed Ctf
   row, live Playwright verify.

## Architecture

All client-side in the vendored SvelteKit studio
(`apps/run.gpx/gpx-studio/website/src/lib/...`). One webapp change (eggs route
entry). **No new API routes, no polling, no refresh cue.**

### New files

- **`components/map/deuce-route.ts`** — pure, Mapbox-free, unit-testable:
  - `DEUCE_ROUTE: [number, number][]` — polyline hand-traced along Las Vegas
    Blvd (Fremont St Experience → Strat → Sahara → Fashion Show → Caesars →
    Bellagio → MGM → Luxor → Mandalay Bay), dense enough (~40–80 vertices) to
    hug the road at Strip zoom levels.
  - `DEUCE_STOPS: { name: string; lngLat: [number, number] }[]` — ~10 named
    stops at the landmarks above.
  - Simulation constants: `ONE_WAY_MIN = 65`, `HEADWAY_MIN = 17`,
    `FLEET = ceil(2*ONE_WAY_MIN / HEADWAY_MIN) = 8`.
  - `cumulativeDistances(route)` + `pointAtFraction(route, f)` — linear
    interpolation along the polyline by arc-length fraction.
  - `busStates(nowMs): { id, lngLat, bearingDeg, southbound }[]` — for bus *k*,
    phase = `((nowMs/60000 + k*HEADWAY_MIN) mod (2*ONE_WAY_MIN)) / ONE_WAY_MIN`;
    phase ∈ [0,1) ⇒ southbound at fraction `phase`, ∈ [1,2) ⇒ northbound at
    `2 - phase`. Anchored to absolute epoch ⇒ deterministic across viewers and
    reloads.
- **`components/map/deuce-layer.ts`** — `DeuceLayer` class, Mapbox binding:
  - Route: GeoJSON source + `line` layer (copy `public-overlays.ts` route-line
    pattern), Deuce-livery color (RTC blue `#0067B1` with subtle glow), built
    lazily on first unlock, `visibility` toggled thereafter.
  - Stops: `circle` layer + click popup (stop name), popup `className`
    includes `dc34-route-popup` (transparent-popup landmine).
  - Buses: 8 DOM `mapboxgl.Marker`s per the-spot template — `ensureStyle()`
    injects CSS once; element = 🚌 emoji + tiny "DEUCE" sign, CSS bob on an
    *inner* element only (never the marker root — Mapbox owns its transform),
    horizontal flip by direction of travel. `setInterval` 1000 ms tick →
    `marker.setLngLat(busStates(Date.now())[k].lngLat)`.
  - `setVisible(bool)` starts/stops the tick; `remove()` full teardown.
  - `prefers-reduced-motion`: disables the bob only; buses still move
    (rainbow landmine: never hard-gate visibility on it).
  - Click a bus → `openEggModal(map, 'dc34-deuce', lngLat)`.
- **`stores/deuce.ts`** — `deuceShown` writable + `toggleDeuce()`; monotonic
  `deuceUnlockedOnce` for the CTF fire-once guard.
- **`components/map/deuce-egg.ts`** — covert CTF fire, verbatim
  rainbow-egg/coffee-egg pattern: inject
  `https://run.defcon.run/use1/assets/theme?v=<V>&_=<bust>` where
  `V = encodeFlag('deuce-egg', 'deuce')` (run.human
  `ctf-covert-codec.ts`), fired once per load on first unlock.

### Touched files

- **`components/map/map.ts`** (externalGeocoder, beside coffee test): add
  `if (/\bdeuce\b/i.test(query)) toggleDeuce();`
- **`components/GhostTrigger.svelte`**: `'2'`-keyed `recordHit(buf, now,
  1500 ms, 3)` → `toggleDeuce()`. **Must be placed before the `!` block's
  early-return on non-`!` keys.** Skip when focus is in an input/textarea only
  if the existing blocks do (match existing behavior exactly).
- **`components/map/layer-control/LayerControl.svelte`**: construct
  `new DeuceLayer(map)` inside `map.onLoad(...)` next to coffee/the-spot;
  `deuceShown.subscribe(on => { deuceLayer?.setVisible(on); if (on) fireDeuceEgg(); })`.
- **`webapp/src/app/api/gpx/public/eggs/route.ts`**: `DEFAULT_EGGS` entry
  `dc34-deuce` — title "The Deuce", RTC lore ("$8 gets you 24 hours of
  double-decker Strip traversal…"), accent `#0067B1`, titleUrl rtcsnv.com.
  Update colocated vitest.

## Error handling

Nothing to fail: no network calls in the layer. Guard `busStates` against a
degenerate route (empty polyline → no markers). Egg modal fetch already
fail-softs. Covert fire is a fire-and-forget `<link>` injection.

## Testing / verification

1. **Pure geometry sanity** — standalone `npx tsx` suite (studio has no
   vitest), rainbow-geometry precedent: route length ≈ 10–14 km; monotonic
   cumulative distances; `pointAtFraction` endpoints/midpoint; determinism
   (same `nowMs` ⇒ same states); fleet count 8; direction split; bus spacing ≈
   headway; a bus completes Fremont→Mandalay in 65 simulated min.
2. **Webapp vitest** — eggs route test gains the `dc34-deuce` entry.
3. **Compile gates** — `build-frontend.sh` builds; webapp `tsc` clean.
4. **Live prod verify (post-deploy)** — cache-busted studio HTML → hashed
   chunk grep (route coords, `dc34-deuce`, livery hex); Playwright against
   prod origin with the rainbow landmine recipe (stub session + mapbox-token,
   `setTerrain(null)`): search "deuce" ⇒ layer appears, press 2×3 ⇒ toggles,
   markers present and *change position* over ~2 min, covert `<link>` carries
   correct `V`.
5. **CTF row seeded** in `run-human-electro` (put-item,
   `attribute_not_exists(pk)`), answerHash = `hashAnswer('deuce')` with
   DEFAULT_SALT, points 1, maxSolves 100000 — else covert ping is a decoy.

## Out of scope (YAGNI)

Real RTC/GTFS-RT lookups, dwell-time easing at stops, SDX/other routes,
mobile-specific unlock gesture (search box works on mobile), refresh-cue ring,
layer-control UI entry (eggs stay hidden).
