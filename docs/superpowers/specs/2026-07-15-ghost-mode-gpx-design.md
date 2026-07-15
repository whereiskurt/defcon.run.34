# Ghost Mode — gpx.defcon.run Easter Egg

**Date:** 2026-07-15
**App:** `apps/run.gpx` (gpx.defcon.run) + consumes `apps/run.mqtt` (meshtk)
**Status:** Design approved, pending spec review

## Summary

A hidden "ghost mode" map layer for the gpx-studio editor at gpx.defcon.run.
Triggered by a covert gesture (`!!!` on keyboard, rapid theme-toggle on mobile),
it reveals a spooky, live-updating layer of "ghost" mesh nodes — lore characters
named after hacker legends (condor, mudge, turing, hopper, ladyada…) that walk
around the venue. Each ghost is clickable to reveal *who* it is.

This is the DC34 evolution of the DC33 meshmap ghost easter egg: same ghost node
model and `ghost-*` naming convention, but rendered as a native gpx-studio
(Mapbox GL) layer instead of the standalone meshmap page, and fed through a
server-side "ghost proxy" that is the trust boundary.

## Existing infrastructure (already built — do not rebuild)

**Mesh side (`~/working/meshtk`, deployed via `apps/run.mqtt/`):**
- `meshtk nodeinfo announce` (Go) subscribes to MQTT, decodes `POSITION_APP` /
  `NODEINFO_APP` / `TELEMETRY_APP` packets, and atomically rewrites a `nodes.json`
  (`NodeDB = map[uint32]*Node`, keyed by node ID; lat/lon are int32 scaled ×1e7).
- The DC34 `docker-compose.yaml` runs mosquitto + meshtk + an nginx that serves
  `/nodes.json`, plus a `ghosts` service running `meshtk fleet simulate` that
  generates a deterministic ghost fleet (seed `dc34-2026-defcon-run`) moving along
  GPX routes.
- **Ghost identity convention:** `longName` contains `ghost` / `contest` /
  `operative`; `shortName` starts with `G`. (See meshmap `index.html` `isGhostNode`.)

**GPX side (`apps/run.gpx/`):**
- gpx-studio (`gpx-studio/website/`, vendored SvelteKit) renders with **Mapbox GL JS**.
  Built by `build-frontend.sh` into `webapp/public/studio/`, served under
  `/{region}/studio/app`. Region prefix derived at runtime.
- `public-overlays.ts` (`PublicOverlaysLayer`) is the working template: `addSource`
  GeoJSON → `addImage` SVG pins → `source.setData()` refresh → visibility toggle,
  gated on `whenStyleReady()` (`map.once('idle')`).
- `webapp/src/app/api/gpx/public/checkins/route.ts` is the template for a
  same-origin, server-to-server, CDN-cached JSON feed (it proxies run.human
  internally via ECS service discovery, with `Cache-Control: s-maxage, swr`).
- The `!!!` gesture exists in **run.human** `EggTrigger.tsx` (three `!` within
  1200ms, or triple-tap). The studio is Svelte, so it needs a small port.
- Theme is `mode-watcher` (`mode.current`, `ModeSwitch.svelte`) — the mobile
  rapid-theme-toggle gesture hooks the `mode` store.

## Architecture / data flow

```
meshtk (Go, existing)                 run.gpx (Next.js, server)      gpx-studio (Svelte/Mapbox, browser)
─────────────────────                 ─────────────────────────      ──────────────────────────────────
nodeinfo announce                     GHOST PROXY (trust boundary)   GhostLayer
  ├ subs MQTT (POSITION_APP)            /api/gpx/public/ghosts          ├ poll every ~90s (only while on)
  ├ writes nodes.json (periodic)  ──►   ├ fetch GHOST_FEED_URL   ──►    ├ source.setData()
  └ nginx serves /nodes.json            │   (INTERNAL/private addr)     ├ spooky ghost markers
     on a PRIVATE internal addr         ├ filter longName ~ ghost       └ click → identity-reveal popup
  + ghosts svc (fleet simulate)         ├ strip pubkey/privkey/PII
    walks ghosts along GPX routes       ├ int-deg → GeoJSON [lon,lat]
                                        └ CDN s-maxage=60, swr=60
```

**Trust boundary:** the full node feed (all nodes, all fields incl. keys/metrics)
only ever lives server-side. run.gpx fetches the private internal `nodes.json`,
and the ghost proxy emits **only** ghost nodes with **only** presentation fields.
Nothing sensitive reaches the browser.

`GHOST_FEED_URL` is an env var. Default: the meshtk producer's **internal/private**
address (server-to-server), following the check-ins proxy pattern. The meshtk
implementation will evolve to publish `nodes.json` to nginx on a private internal
address; this proxy is its only consumer.

## Components (net-new, ≈4–5 files, <300 lines)

### 1. Ghost proxy — `webapp/src/app/api/gpx/public/ghosts/route.ts`
Modeled on `checkins/route.ts`.
- Server-side `fetch(GHOST_FEED_URL)` (internal address, `credentials: 'omit'`).
- Parse `NodeDB` object → iterate values.
- **Filter:** keep only nodes where `longName`/`shortName` matches
  `/ghost|contest|operative/i` (case-insensitive), AND `IsValid` (non-zero
  lat/lon, non-empty `longName`).
- **Transform:** `latitude/1e7`, `longitude/1e7` → GeoJSON `Point` `[lon, lat]`.
  Emit props `{ slug, who, shortName, lastSeen, battery }` only.
  `slug` derived from `longName` (e.g. `ghost-condor-00` → `condor`).
  `who` from the identity map (component 5).
- **Strip:** never emit `pubkey`, `privkey`, `neighbors`, precise telemetry, or
  any node not matching the ghost filter.
- **Cache:** `Cache-Control: s-maxage=60, stale-while-revalidate=60`.
- **Fail-soft:** upstream error / parse error → `200` with empty
  `FeatureCollection`.

### 2. `GhostLayer` — `gpx-studio/website/src/lib/components/map/ghost-layer.ts`
Modeled on `PublicOverlaysLayer`.
- `constructor(map)`, `add()`, `remove()`.
- `whenStyleReady()` before touching sources/layers.
- `loadSvgImage()` registers a spooky ghost SVG marker (per-ghost color derived
  from name/slug, DC33 `ghostColor` vibe) via `map.addImage`.
- `addSource(GHOST_SOURCE, { type: 'geojson', data: emptyFC })` + a `symbol`
  layer using the ghost icon + a small text label (shortName).
- **Poll loop:** `setInterval(~90s)` → `fetch('/{region}/api/gpx/public/ghosts')`
  → `source.setData(fc)`. First fetch fires immediately on activation. Interval
  cleared in `remove()` / when hidden.
- **Click handler:** on ghost feature click → `mapboxgl.Popup` revealing identity
  (`who`) + `shortName` + `lastSeen` (relative) + battery. This is the
  "who are the ghosts" payoff.
- `setVisible(bool)` toggles layout visibility AND starts/stops the poll loop
  (no polling while hidden).
- Overlay sits **on top** of existing route/check-in layers (additive; does not
  hide them).

### 3. `ghostMode` store + wiring
- `gpx-studio/website/src/lib/stores/ghost.ts` — `Writable<boolean>` (default false).
- `LayerControl.svelte` instantiates `GhostLayer` inside its existing
  `map.onLoad((_map) => {...})` block and subscribes it to `ghostMode`
  (`$ghostMode` → `ghostLayer.setVisible(...)`).

### 4. `GhostTrigger.svelte`
Mounted in the studio root layout (headless).
- **Keyboard:** port `EggTrigger`'s rolling-window detector — three `!` keydowns
  within 1200ms → toggle `ghostMode`.
- **Mobile:** subscribe to the `mode` store; count N theme flips within a rolling
  window (e.g. 4 flips / 2s) → toggle `ghostMode`.
- Both gestures **toggle** on/off (symmetric). No visible affordance.

### 5. `ghost-identities.ts` — `gpx-studio/website/src/lib/ghost-identities.ts`
Pure slug→persona map for the reveal popup + proxy `who` field. Seed set:
condor→Kevin Mitnick, hopper→Grace Hopper, turing→Alan Turing, ladyada→Limor
Fried (Adafruit), mudge→Peiter Zatko, gibson→(Hackers), goldstein→Emmanuel
Goldstein (2600), dt→Dark Tangent, sharp, ricky, bigstar. Optional one-line flavor
per ghost. Unknown slug → title-cased slug fallback.

## Error handling
- Proxy fail-soft (empty FC, 200); never 500s the map.
- Layer: fetch error → keep last frame, retry next tick.
- `IsValid` gate mirrors meshtk (non-zero lat/lon + non-empty longName).
- Ghosts move (fleet simulate), so a stale frame is acceptable between polls.

## Security
- Ghost proxy is the sole trust boundary. It strips all keys and non-presentation
  fields and emits only ghost-matched nodes.
- `GHOST_FEED_URL` is an internal/private address, reached server-to-server only.
- Anonymous, read-only, no writes, no auth, no new infra.

## Testing
- **Vitest (pure transform):** feed a `nodes.json` fixture (mix of ghost + real +
  invalid nodes) → assert: only ghosts kept, int-deg→float correct, keys stripped,
  `slug`/`who` mapping, empty-on-error. (Node ≥22.12 per repo convention —
  `nvm use 23.6.0`.)
- **Manual verify:** studio dev `:5173` → webapp `:3002` per the local overlay
  recipe; point `GHOST_FEED_URL` at a local/sample `nodes.json`; trigger `!!!`,
  confirm ghosts appear, move on poll, and click reveals identity.

## Scope / YAGNI
- No new infra; reuse the existing meshtk + nginx stack.
- No changes to meshtk in this phase (it already produces `nodes.json`; making the
  address private is an infra/deploy concern tracked separately).
- Only run.gpx changes: 1 API route + ~4 studio files.
- Not building: auth, writes, real-attendee tracking, or a standalone map page.

## Open defaults (confirm at review)
- Poll interval **~90s** (stated range 1–2 min).
- Lifecycle: **toggle on/off** with the same gesture (vs auto-timeout).
- `GHOST_FEED_URL` default = meshtk producer's **internal/private** address (TBD
  exact host at deploy).
