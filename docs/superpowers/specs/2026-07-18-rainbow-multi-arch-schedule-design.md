# Multi-Rainbow: per-arch color & scheduled public arch

**Date:** 2026-07-18
**Status:** approved → implementing
**Builds on:** `2026-07-17-rainbow-bridges-easteregg-design.md` (the hidden Rainbow Bridges egg, LIVE prod)

## Goal

Extend the existing hidden "Rainbow Bridges" map easter egg (run.gpx / gpx.studio)
from one pride arch to **multiple arches**, each with its own color palette and
optional visibility schedule. Ship three arches:

1. **Pride arch** — LVCC ↔ ReBar (existing, unchanged behavior). Unlock-gated.
2. **Green "weed" arch** — LVCC → NuWu Cannabis drive-thru. 6-band green
   gradient. Unlock-gated (revealed together with the pride arch).
3. **Timed pride arch** — LVCC → "Welcome to Fabulous Las Vegas" sign. Pride
   colors. **Publicly** visible only **Thu–Sun 06:00–08:00 America/Los_Angeles**,
   *and* revealed off-schedule whenever the egg is unlocked.

## Gating model

Unlock (typing `rainbow`, or the 3D-flip gesture) is a **master reveal**: it
shows every arch regardless of clock. When locked, each arch falls back to its
public rule: unlock-gated arches stay hidden; scheduled arches show only inside
their window.

```
isArchActiveNow(arch, { unlocked, now }):
  if unlocked: return true                       # master reveal
  if (arch.requiresUnlock ?? true): return false # pride + weed stay hidden
  if arch.schedule: return isWithinSchedule(arch.schedule, now)  # Vegas sign
  return true                                     # fully-public, no schedule
```

| arch | route | palette | requiresUnlock | schedule |
|------|-------|---------|----------------|----------|
| `lvcc-rebar` | LVCC → ReBar | `PRIDE_COLORS` | true | — |
| `lvcc-nuwu` | LVCC → NuWu drive-thru | `WEED_COLORS` (green) | true | — |
| `lvcc-lvsign` | LVCC → LV sign | `PRIDE_COLORS` | false | Thu–Sun 6–8AM PT |

Locked: pride+weed hidden, LV-sign shows only in window.
Unlocked: all three show immediately, any time.

## Design

### 1. Pure geometry (`rainbow-geometry.ts`)

Extend `RainbowArch`:

```ts
interface ArchSchedule { days: number[]; startHour: number; endHour: number; tz: string; }
interface RainbowArch {
  id: string; from: LngLat; to: LngLat;
  colors?: string[];        // per-arch palette; defaults to PRIDE_COLORS
  requiresUnlock?: boolean; // default true
  schedule?: ArchSchedule;  // optional public window
}
```

- Add `WEED_COLORS` — 6 greens, dark→light.
- `buildRainbowFeatures`: each arch uses `arch.colors ?? opts.colors ?? PRIDE_COLORS`
  (per-arch instead of one global palette).
- New pure `isWithinSchedule(schedule, now: Date)`: reads weekday + hour **in
  `schedule.tz`** via `Intl.DateTimeFormat` (correct regardless of viewer tz).
  `days` are `getDay()` numbers (0=Sun … 6=Sat); Thu–Sun = `[4,5,6,0]`.
  Window is `[startHour, endHour)` on the hour.
- New pure `isArchActiveNow(arch, { unlocked, now })` per the model above.

### 2. Render layer (`rainbow-arch.ts`)

Keep **one source + one fill-extrusion layer** (all quads carry their own
`color`). Show/hide individual arches with a Mapbox **filter on `archId`** —
cheaper than per-arch layers; opacity stays uniformly pitch-driven.

- `applyState()` (replaces the unlock-only path): compute active arch-id set via
  `isArchActiveNow`; `setFilter(LAYER, ['in', ['get','archId'], ['literal', ids]])`;
  visibility `visible` if any active else `none`; opacity from `pitchOpacity`.
- **Lazy build + 60s timer:** because the LV-sign arch is public, the layer can
  no longer be built only on unlock. Start a 60s interval on construction that
  re-runs `applyState()` (catching schedule boundaries) and **lazily builds** the
  source the first time anything is active (unlock OR window opening). Outside
  both, the source is never added — pride/weed geometry stays out of the page as
  hidden as today.
- `setUnlocked(on)` and the `pitch` handler both just call `applyState()`.
- `remove()` clears the interval + pitch handler + layer + source.

### 3. Wiring & CTF — unchanged

`LayerControl.svelte` still `new RainbowArch(map)` + `rainbowUnlocked.subscribe`.
The class self-manages its timer; the subscribe still calls `setUnlocked` +
`fireRainbowEgg` (once). **No new CTF** — unlock fires the single existing
`rainbow-egg`, which now reveals both pride and weed arches. The LV-sign arch
awards nothing; it is a timed decorative appearance.

### Rejected alternatives

- **Per-arch layers/sources** — 3× Mapbox objects + duplicated pitch handlers for
  no benefit; `archId` filter is simpler.
- **Eager build on load** — leaks pride/weed geometry into the page pre-unlock;
  the lazy timer keeps the egg hidden ~22h/day the window is closed.

## Verification

- Pure sanity via `npx tsx` (studio has no vitest): per-arch colors present,
  `isWithinSchedule` true inside / false outside the Vegas window at injected
  dates, `isArchActiveNow` covers locked/unlocked × in/out-of-window.
- Live prod Playwright (mapbox token is `*.defcon.run`-locked → won't load
  locally): `setTerrain(null)` to survive headless, drive filter/colors per arch.

## Coordinates (approximate, decorative, safe to nudge)

- LVCC `-115.1512, 36.1316` · ReBar `-115.1553, 36.1555` (existing)
- NuWu Cannabis Marketplace `-115.1466, 36.1789`
- "Welcome to Fabulous Las Vegas" sign `-115.1728, 36.0821`
