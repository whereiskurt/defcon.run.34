---
created: 2026-07-31T05:30:00Z
title: "gpx-studio — 🔥 fire animation easter egg for the heat-map layers (typed 'fire', rainbow-style)"
area: run.gpx
priority: medium
---

Kurt's idea, 2026-07-31: *"It would be cool to have a fire animation for the layers anytime
'fire' is typed in the search or on screen (like rainbow). There was a cool effect in dc33 that
had an animation etc."*

New feature → needs its own planned phase (AGENTS.md Essential Rule 1). Deliberately **not**
folded into the Phase 71 gap closure, which is scoped to con-week availability/exposure risk.

---

## What DC33 actually had (checked, not assumed)

`~/working/defcon.run.33/apps/nx/apps/webapp/src/components/heatmap/`:

| File | What it does |
|---|---|
| `HeatMapKonamiWrapper.tsx` (349 ln) | Konami sequence `↑↑↓↓←→←→ba` → flips `isMatrixMode`; also tracks visible layers and recomputes stats from them; km/miles/**steps** display toggle |
| `MatrixRainBackground.tsx` (136 ln) | The animation itself |
| `HeatMapStatsOverlay.tsx` (165 ln) | Floating stats panel positioned relative to the zoom buttons |

**DC33's effect was matrix rain, not fire.** So "fire" is a new idea, not a port — and it suits
flame stacks far better than green glyphs do. The matrix effect is *already* ported to
gpx-studio as `lib/components/map/matrix-rain.ts`, so the DC33 well is largely drawn.

## The pattern to copy — all of it already exists in gpx-studio

- **Effect class:** `lib/components/map/matrix-rain.ts` (84 ln) — `MatrixRain` mounts a fixed
  full-viewport canvas + tint div over the map, `pointer-events:none`, own RAF loop, DPR-capped
  at 2. A `FireRain`/`EmberDrift` sibling in the same shape is the obvious build.
- **Typed-keyword trigger:** `lib/components/GhostTrigger.svelte` (90 ln) — keeps a rolling
  buffer `typed = (typed + e.key.toLowerCase()).slice(-7)` and matches `'rainbow'`, `'dd'`.
  Adding `'fire'` is a couple of lines. Also hosts the rapid-key gestures (`2-2-2` Deuce,
  `#-#-#` payphones, `!!!` ghost mode).
- **Mobile path:** phones have no keyboard. The established twin is a **geocoder search word** —
  `coffee`/`publicus` (`stores/coffee.ts`), `deuce`/`monorail`/`222`. Kurt's phrasing *"typed in
  the search or on screen"* maps exactly onto this existing split, so do both.
- **Unlock state:** `stores/rainbow.ts`, `stores/coffee.ts`, `stores/deuce.ts` — a
  `writable(false)` session flag per egg. `stores/layer-visibility.ts` already persists
  `heat:dc33` / `heat:dc34`.

## Design notes worth carrying into the phase

- **Gate it on a heat layer being on.** The payoff is fire *over the flame stacks*; firing it on
  a bare basemap wastes the joke. `heatmapState[year].available` + visibility are already there.
- **Reduced-motion — do NOT hard-gate.** Recorded verbatim in `matrix-rain.ts`: *"User-triggered
  easter egg → if reduced-motion, show the static tint but no animated rain (lesson from
  cash-rain: a hard reduced-motion gate made a user-triggered effect invisible in prod)."*
  Same rule applies here.
- Colour it off the locked heat palette — DC34 `#ff0000`, DC33 `#ff8c00` — so the egg reads as
  *these layers* catching fire, not a generic overlay.
- Consider auto-expiring the effect (matrix mode is a toggle; a fire burst may want to burn out)
  and honouring `Escape`.

## Related deferred ideas (Phase 71 CONTEXT.md `<deferred>`)

- Standalone `/heatmap` page with DC33's Konami wrapper + matrix rain + stats overlay — the
  `HeatMapStatsOverlay` and km/miles/**steps** toggle are the un-ported half, and they'd pair
  naturally with this.
- `heatmap-kernel` glow variant (the artifact format already supports it) — a real glow/kernel
  render might deliver "heat" more literally than a particle overlay, and could be scoped
  together with, or instead of, the animation.

## Watch-outs

- gpx-studio is a **vendored tree** — `apps/run.gpx/gpx-studio/`. Build via
  `apps/run.gpx/build-frontend.sh`; gate with a **svelte-check delta** (0 errors on changed
  files), never an absolute count. Lint is non-functional there (deferred D-71-C).
- Visual verification must follow the hard-won 71-08 method: hide all non-heat layers, camera on
  a measured hotspot. `71-08-probes/capture-heat-visual.cjs` exists for exactly this. A
  default-zoom screenshot with overlays on proves nothing — that mistake cost a full re-shoot.
- Heat-line opacity is moving `0.25 → 0.70` in Phase 71 gap closure (D-13). Build against 0.70.
