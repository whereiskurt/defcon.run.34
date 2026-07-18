# Rainbow Bridges — hidden 3D pride-arch easter egg (run.gpx / gpx.studio)

**Date:** 2026-07-17
**Status:** Approved (Kurt: "gogogo all the way") — built
**App:** `apps/run.gpx/gpx-studio/website` (vendored gpx.studio SvelteKit map) + a CTF award hop into run.human

---

## 1. Idea

A hidden pride-rainbow arch that rises over Las Vegas — **doubly secret**: it does
nothing until you (a) perform a secret unlock gesture, and then (b) *tilt* the map.
Flat-and-locked it is completely invisible. Unlocking it also awards a one-time
CTF flag (`rainbow-egg`), mirroring the shipped sao-egg / apex-`!!!` covert eggs.

## 2. Decisions (locked with Kurt)

- **Anchors:** LVCC (con HQ) ↔ ReBar (Arts District). Multi-arch by design — a
  `RAINBOW_ARCHES` array; adding a bridge is one entry.
- **Reveal:** *secret unlock + tilt*. Locked → the layer is hidden at any pitch.
  Unlocked → pitch-driven opacity (invisible <15°, full by ~60°).
- **Unlock gesture:** 3 rapid 3D flips within 2s (`map.toggle3D()`), reusing the
  ghost-mode `recordHit` rolling-window detector. Monotonic (never re-locks).
- **Palette / scale:** 6-stripe pride flag, tall (peak ≈ 0.3×span ≈ 800 m).
- **Geometry:** fill-extrusion bands (pure Mapbox, no new deps).
- **CTF:** unlocking awards the `rainbow-egg` challenge once per signed-in user,
  via the existing covert `text/css` channel (no new server code).

## 3. Components (all mirror existing patterns)

- `lib/stores/rainbow.ts` — `rainbowUnlocked` writable (mirrors `stores/ghost.ts`;
  reuses its `recordHit`).
- `lib/components/map/rainbow-geometry.ts` — **pure** (no Mapbox import):
  `RAINBOW_ARCHES`, `PRIDE_COLORS`, `buildRainbowFeatures(arches, opts)` →
  GeoJSON of coloured wall-quads (`height = sin(π·t)·peak`, lateral band offset),
  and `pitchOpacity(pitch)` = `clamp((pitch−15)/45)·0.85`.
- `lib/components/map/rainbow-arch.ts` — `RainbowArch` layer class (mirrors
  `ghost-layer.ts`): one GeoJSON source + one `fill-extrusion` layer
  (`color`/`height` via `['get',…]`, vertical-gradient), built lazily on first
  unlock, opacity driven live off `map.on('pitch')`, hidden when locked.
- `lib/components/map/rainbow-egg.ts` — `fireRainbowEgg()`: injects a covert
  `<link rel=stylesheet>` to `run.defcon.run/use1/assets/theme?v=<RAINBOW_COVERT_V>`
  (once per load). `RAINBOW_COVERT_V = encodeFlag('rainbow-egg','rainbow')`.
- `lib/components/map/map.ts` — `toggle3D()` records a flip; 3-in-2s →
  `rainbowUnlocked.set(true)`.
- `lib/components/map/layer-control/LayerControl.svelte` — instantiates
  `RainbowArch` in `map.onLoad`; on unlock → `setUnlocked(true)` + `fireRainbowEgg()`.

## 4. CTF award (server side already exists)

The covert channel (`run.human /use1/assets/theme`) decodes `v`, resolves the
run.human session via the `.defcon.run` `sess_run` cookie (SSO — a gpx user who
signed in via run.defcon.run has it), and records a once-ever `CtfSolve` for the
`rainbow-egg` challenge. **Required seeding:** a `rainbow-egg` `Ctf` row in
run.human prod — `enabled:true`, `answerHash = hashAnswer('rainbow')`
(`a408a674…`, default salt `dc34-ctf-answer-salt-v1`), scoring fields cloned from
sao-egg (1 pt). Anon unlock = decoy, no footprint. Idempotent (re-fires no-op).

## 5. Security

Pure decorative geometry, no user input, no DOM popups → no injection surface.
The covert award is identical to the shipped, audited sao/apex mechanism; identity
is bound server-side by the cookie (no client-supplied user id).

## 6. Verification

- Geometry + ramp: standalone sanity (480 features, sine peak 806 m at midpoint,
  ~16 m at ends, 6 colours; ramp 0→0.85 over 15–60°). ✓
- Covert codec: `encodeFlag('sao-egg','sao')` reproduces the known prod value,
  confirming `RAINBOW_COVERT_V`. ✓
- svelte-check (0 new) + Vite build clean. ✓
- Runtime arch render: the URL-restricted Mapbox token 403s on localhost and the
  full 3D map overwhelms the headless browser — so the on-map arch is left to live
  UAT (tilt on gpx.defcon.run). Layer/unlock/covert code mirrors the proven
  GhostLayer + sao-egg patterns; blast radius is a hidden, default-locked egg.

## 7. Scope / non-goals

In: the arch(es), unlock gesture, pitch reveal, covert CTF award + seeding.
Out: any new server endpoints (reuse the covert channel), a visible celebration
(the arch is the reward), admin UI. Three.js tube arch deferred.
