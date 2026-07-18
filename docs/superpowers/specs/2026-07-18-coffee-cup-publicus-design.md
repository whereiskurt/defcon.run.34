# Giant coffee cup over PublicUs (`coffee-egg`)

**Date:** 2026-07-18
**Status:** approved → implementing
**Sibling of:** `2026-07-17-rainbow-bridges-easteregg-design.md` + `2026-07-18-rainbow-multi-arch-schedule-design.md` (same map-egg tech: translucent fill-extrusion, pitch-reveal, covert CTF)

## Goal

A giant translucent 3D coffee cup rendered over **PublicUs coffee (1126 Fremont St, Las Vegas, ~[-115.1378, 36.1591])** in gpx.studio. Cartoonish, see-through, tilt-revealed like the rainbows. Clicking it opens a PublicUs "fuel stop" popup **and** awards a covert `coffee-egg` CTF flag. Always visible (faint overhead, blooms when tilted); **searching `publicus` or `coffee`** in the map's geocoder upgrades it (more opaque + steam) — a mobile+desktop-friendly unlock.

## Behavior

- **Always-on:** the cup renders for everyone, opacity ramped by pitch (floor ~0.10 overhead → ~0.40 tilted).
- **Unlock (search):** the map geocoder's `externalGeocoder(query)` matches `/publicus|coffee/i` → `coffeeUnlocked.set(true)`. Unlocked = opacity max ~0.60 **and** steam wisps appear. (Searching `publicus` also flies you to PublicUs — you land on the cup.)
- **Click:** popup (PublicUs card) + `fireCoffeeEgg()`.
- **CTF:** covert, no new server code — same `<link rel=stylesheet href=.../assets/theme?v=V>` trick as `rainbow-egg`/`sao-egg`. `V = encodeFlag('coffee-egg','coffee') = 2230428019419328496265843840902740576556784501` (verified against the codec; rainbow known-value cross-checks). Fires on unlock AND on click; `fired`-guard once/load; server idempotent. **Decoy no-op until the `coffee-egg` Ctf row is seeded in run.human prod** (separate step, same AWS CLI recipe as rainbow-egg).

## Files (all `apps/run.gpx/gpx-studio/website/src/`)

| file | role | mirrors |
|------|------|---------|
| `lib/stores/coffee.ts` | `coffeeUnlocked` writable | `stores/rainbow.ts` |
| `lib/components/map/coffee-cup-geometry.ts` | PURE: `COFFEE_LOCATION`, `CUP_COLORS`, `buildCupFeatures({unlocked})`, `cupOpacity(pitch,unlocked)` | `rainbow-geometry.ts` |
| `lib/components/map/coffee-cup.ts` | layer class: one source + one fill-extrusion layer, always-on, click→popup, pitch opacity, rebuild-on-unlock (steam) | `rainbow-arch.ts` |
| `lib/components/map/coffee-egg.ts` | `fireCoffeeEgg()` covert CTF | `rainbow-egg.ts` |
| `lib/components/map/map.ts` | geocoder `externalGeocoder` query hook → `coffeeUnlocked` | (edit) |
| `lib/components/map/layer-control/LayerControl.svelte` | `new CoffeeCup(map)` + `coffeeUnlocked.subscribe` → setUnlocked + fire | (edit, like rainbow) |

## Geometry (fill-extrusion, cartoonish)

- **Body:** ~40-gon disc (radius ~35m) extruded 0→~80m — a bold translucent cylinder mug.
- **Coffee surface:** smaller brown disc (radius ~0.86R) extruded near the rim (~H-4→H).
- **Handle:** a curved thin wall (±60° arc on +x, radius R+14) extruded mid-height (~0.25H→0.75H) — a handle silhouette.
- **Steam (unlocked only):** 3 swaying thin columns above the rim (~H→H+70m, sinusoidal x sway) — added by rebuilding the source with `{unlocked:true}`.
- **Colors:** body `#F5F0E6` (cream ceramic), coffee `#5C3A21` (brown), steam `#FFFFFF`.
- **Opacity:** `cupOpacity(pitch, unlocked)` = floor `0.10` + pitch ramp → max `0.40` (locked) / `0.60` (unlocked). Always ≥ floor (always faintly visible).

## Popup

`map.on('click', LAYER)` → `mapboxgl.Popup().setHTML(card)` at click point. Static card (no user input): ☕ **PublicUs** — "Rabbit fuel stop — grab a coffee on Fremont East", `1126 Fremont St, Las Vegas`, link `publicuslv.com`. Cursor → pointer on hover.

## Verification

- `tsx` pure sanity: body/coffee/handle feature parts present; steam features ONLY when `unlocked:true`; colors correct; `cupOpacity` floor/ramp/unlock-bump.
- Local `build-frontend.sh` + `svelte-check` (rainbow files clean baseline; only new coffee files added).
- Prod Playwright: fly to PublicUs, tilt → cup renders; click → popup + covert fires; search `publicus` → steam + opacity bump + covert fires with correct `V`.
- **Prod seed** the `coffee-egg` Ctf row, then confirm a real signed-in click writes a `CtfSolve`.

## Scope note

All client-side reuses rainbow patterns. The one prod-touching step (NOT in this PR) is the `coffee-egg` DynamoDB seed — done separately with the documented recipe before it counts for anyone.
