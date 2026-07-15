# Mesh Map Layers — Rabbit Layer + Ghost Mode (gpx.defcon.run)

**Date:** 2026-07-15
**Apps:** `apps/run.gpx` (gpx.defcon.run) + `apps/run.human` (backend + toggle) + consumes `apps/run.mqtt` (meshtk)
**Status:** Design approved (combined spec), pending spec review

## Summary

Two new live map layers on the gpx-studio editor at gpx.defcon.run, both fed from
the live Meshtastic mesh via meshtk, plus the existing check-in pins:

1. **Check-ins** *(exists — no change):* self-reported "I'm here" pins.
2. **Rabbit Layer** *(NEW):* real attendees who have a **verified Meshtastic radio**
   on their rabbit account and flip a **"Show me on the map"** toggle. Their live
   mesh node position is shown as a pin rendered with their rabbit identity
   (displayName + pin icon/color). Opt-in, revocable — the toggle *is* the consent.
3. **Ghost Layer / mode** *(NEW — hidden easter egg):* `!!!` (keyboard) or a rapid
   theme-toggle (mobile) unlocks a theme that reveals the invisible "ghost" nodes —
   simulated lore characters named after hacker legends (condor, mudge, turing,
   hopper, ladyada…) that walk the venue. Each ghost is clickable to reveal *who* it
   is. The joke: ghosts are hidden on the web map but **obvious if you're actually on
   the Meshtastic mesh** (they show up in your radio's node list).

All three are Mapbox GL layers in gpx-studio. Layers 2 and 3 are fed from the same
internal `nodes.json` through **run.gpx server-side "proxies"** (a rabbit proxy and a
ghost proxy), each filtering the full mesh feed down to a safe public subset. The
full node feed never reaches the browser.

## Existing infrastructure (grounded — do not rebuild)

### Mesh side (`~/working/meshtk`, deployed via `apps/run.mqtt/`)
- `meshtk nodeinfo announce` (Go) subscribes to MQTT, decodes `POSITION_APP` /
  `NODEINFO_APP` / `TELEMETRY_APP`, and atomically rewrites `nodes.json`
  (`NodeDB = map[uint32]*Node`, keyed by **numeric** node id `from`; lat/lon are
  int32 scaled ×1e7; `fromStr` = `!%08x` hex).
- The DC34 `docker-compose.yaml` runs mosquitto + meshtk + nginx serving
  `/nodes.json`, plus a `ghosts` service (`meshtk fleet simulate`, seed
  `dc34-2026-defcon-run`) that walks the ghost fleet along GPX routes.
- **Ghost identity convention:** `longName` contains `ghost` / `contest` /
  `operative`; `shortName` starts with `G` (meshmap `isGhostNode`).
- **Evolution (infra, tracked separately):** `nodes.json` will be published to nginx
  on a **private internal address**; run.gpx reaches it server-to-server.

### GPX side (`apps/run.gpx/`)
- gpx-studio (`gpx-studio/website/`, vendored SvelteKit) renders with **Mapbox GL JS**,
  built by `build-frontend.sh` into `webapp/public/studio/`, served under
  `/{region}/studio/app`.
- `gpx-studio/website/src/lib/components/map/public-overlays.ts`
  (`PublicOverlaysLayer`) is the template: `whenStyleReady()` → `addImage` SVG pin →
  `addSource` GeoJSON → symbol layer → `source.setData()` refresh → visibility toggle.
  `addCheckIns()` (626-766), `loadSvgImage()` (535-542), `checkinFeatures()` (573-609).
- Pins/colors: `gpx-studio/website/src/lib/dc34-pins.ts` (`pinSvg(icon, color)`),
  `dc34-palette.ts`. Mirror of run.human `pin-icons.ts`.
- `webapp/src/app/api/gpx/public/checkins/route.ts` is the same-origin, server-to-server,
  CDN-cached proxy template (already calls run.human internally via ECS service
  discovery; `Cache-Control: s-maxage, swr`). **run.gpx already has the internal-call
  plumbing.**
- **No periodic refresh exists** in the studio today — layers fetch once on `add()`.
  The poll loop (`setInterval` + `source.setData`) is net-new.
- The `!!!` gesture lives in run.human `EggTrigger.tsx` (three `!` within 1200ms, or
  triple-tap). Studio is Svelte → needs a small port.
- Theme is `mode-watcher` (`mode.current`, `ModeSwitch.svelte`) → the mobile
  rapid-theme-toggle gesture hooks the `mode` store.

### run.human side (`apps/run.human/webapp/`)
- **Data model:** `RunUser` (ElectroDB) has a nested `meshtasticRadios` **list of maps**
  (`src/entities/run-user.ts` L79-98): each `{ id, nodeId ("!4359d0cc", lowercase hex),
  privateKey, publicKey, impersonate, verified, verifiedAt, ... }`. `sanitizeRadio()`
  (L458) must be applied on every read-modify-write. Mutation via
  `updateMeshtasticRadios(userId, radios)` (full-list rewrite).
- **Toggle pattern (mirror this):** `src/components/profile/MeshtasticRadios.tsx` renders
  a per-radio "Impersonate" `<Switch>` → `handleToggleImpersonate` (L305) →
  `PATCH /api/meshtastic-radios { radioId, impersonate }` → handler
  (`src/app/api/meshtastic-radios/route.ts` L172) applies the field and rewrites the list.
  The PATCH already accepts multiple optional fields in one call.
- **Node id:** stored **lowercase hex `"!4359d0cc"`, not zero-padded**. There is NO
  hex→numeric helper. To intersect against numeric-keyed `nodes.json`, convert with
  `parseInt(nodeId.slice(1), 16) >>> 0`. Do NOT string-compare hex against
  `%08x`-formatted keys (stored values aren't guaranteed 8-digit).
- **Internal endpoint pattern:** routes under `src/app/api/internal/` gate on header
  `x-internal-secret` == `config.auth.internalSecret` (`AUTH_INTERNAL_SECRET`), no session.
  `scanAllRunUsers()` (`run-user.ts` L291) scans all users.
- **Safe public identity fields** (already exposed in `checkins/public`): `displayName`
  (rabbit_XXXX), `mqttUsertype` → `userType` (rabbit/admin/wildhare/og), `preferences.pinIcon`,
  `preferences.pinColor`, `hash` (SHA256 QR value, documented not-secret). **No avatar/emoji
  in a server scan** (avatar comes from OIDC session image) — use pinIcon/pinColor.
  **Never expose:** `seed`, RSA hashes, `mqttUsername`/`mqttPassword`, radio
  `privateKey`/`publicKey`/`verificationCode`.

## Architecture / data flow

```
meshtk (Go)              run.human (server)            run.gpx (server, trust boundary)     gpx-studio (browser)
───────────              ──────────────────            ────────────────────────────────     ────────────────────
nodeinfo announce        /api/internal/mesh-map        RABBIT PROXY                          RabbitLayer (normal)
  writes nodes.json  ─┐  (x-internal-secret)      ┌─►   /api/gpx/public/rabbits        ─►     ├ poll ~30–60s (when on)
  (private nginx)     │  scanAllRunUsers          │     ├ fetch GHOST_FEED_URL (nodes.json)   ├ pin = pinIcon/pinColor
  + ghosts (fleet)    │  verified && showOnMap ───┘     ├ fetch run.human mesh-map            └ click → displayName popup
    walk GPX routes   │  → {numNodeId: identity}        ├ intersect by numeric node id
                      │                                 └ emit rabbit GeoJSON (safe fields)
                      └────────────────────────────►   GHOST PROXY                           GhostLayer (hidden)
                                                         /api/gpx/public/ghosts         ─►     ├ poll ~90s (when unlocked)
                                                         ├ fetch GHOST_FEED_URL               ├ spooky ghost markers
                                                         ├ filter longName ~ ghost            └ click → identity reveal
                                                         ├ strip keys/PII
                                                         └ emit ghost GeoJSON
                                                                                              GhostTrigger: !!! / theme-toggle
                                                                                                → unlocks ghost theme + layer
```

**Trust boundary:** the full `nodes.json` (all nodes, keys, metrics) and the
`{nodeId→identity}` map only live server-side in run.gpx. The two proxies emit only
opt-in, presentation-safe subsets.

## Components

### Part A — run.human (Rabbit Layer backend + toggle)

**A1. `showOnMap` field.** Add `showOnMap: { type: "boolean" }` to the `meshtasticRadios`
map properties in `src/entities/run-user.ts`; add `showOnMap` to the `MeshtasticRadio`
type and to `sanitizeRadio()` (`showOnMap: radio.showOnMap ?? false`).

**A2. Toggle.** Extend `PATCH /api/meshtastic-radios` to accept `showOnMap`
(`if (showOnMap !== undefined) radio.showOnMap = showOnMap;`). In
`MeshtasticRadios.tsx`, add a second `<Switch>` ("Show me on the map") +
`handleToggleShowOnMap`, copied from the Impersonate handler. Default OFF. Gated on
verified radios only (only verified radios can be shown).

**A3. Internal feed.** New `src/app/api/internal/mesh-map/route.ts`, `x-internal-secret`-gated.
`scanAllRunUsers()` → flat-map each user's `meshtasticRadios` where `verified && showOnMap`
→ emit `{ nodeNum: parseInt(nodeId.slice(1),16)>>>0, displayName, userType, pinIcon,
pinColor, hash }`. `Cache-Control: private, no-store` (freshness matters for revocation).

### Part B — run.gpx (proxies)

**B1. Rabbit proxy** `webapp/src/app/api/gpx/public/rabbits/route.ts`:
- Server-side fetch `GHOST_FEED_URL` (internal `nodes.json`) AND run.human
  `/{region}/api/internal/mesh-map` (via ECS discovery host + `x-internal-secret`).
- Build `Map<nodeNum → identity>` from mesh-map; for each `nodes.json` entry whose
  numeric key is in the map AND `IsValid` (non-zero lat/lon), emit a GeoJSON `Point`
  `[lon, lat]` with props `{ displayName, userType, pinIcon, pinColor, hash, lastSeen }`.
- `Cache-Control: s-maxage=30, stale-while-revalidate=30` (fresh, so toggle-off
  propagates in ≤~30s + swr). Fail-soft: any upstream error → `200` empty FC.
- **Only opted-in, verified users can ever appear.** run.gpx needs `AUTH_INTERNAL_SECRET`
  + the run-human internal host in config (checkins proxy already reaches run.human,
  but via the *public* feed — the internal secret env is the one addition).

**B2. Ghost proxy** `webapp/src/app/api/gpx/public/ghosts/route.ts`:
- Fetch `GHOST_FEED_URL`; keep nodes where `longName`/`shortName` matches
  `/ghost|contest|operative/i` AND `IsValid`; convert int-deg→float; emit props
  `{ slug, who, shortName, lastSeen, battery }` only. Strip `pubkey`/`privkey`/PII/non-ghosts.
- `Cache-Control: s-maxage=60, stale-while-revalidate=60`. Fail-soft empty FC.
- `slug` from `longName` (`ghost-condor-00` → `condor`); `who` from `ghost-identities.ts`.

### Part C — gpx-studio (layers, trigger, identities)

**C1. `RabbitLayer`** `gpx-studio/website/src/lib/components/map/rabbit-layer.ts`
(mirror `PublicOverlaysLayer`): geojson source, symbol layer with per-feature pin via
`dc34-pins` `pinSvg(pinIcon, pinColor)` + text label (displayName), poll ~30–60s while
visible, click → popup (displayName, userType). Normal layer, wired in `LayerControl.svelte`,
togglable in the layer control. **Default: ON** (only consenting users appear; that's the point).

**C2. `GhostLayer`** `gpx-studio/website/src/lib/components/map/ghost-layer.ts`
(mirror `PublicOverlaysLayer`): spooky ghost SVG marker (per-ghost color from slug,
DC33 vibe), poll ~90s while unlocked, click → identity-reveal popup (`who`, shortName,
lastSeen, battery). Additive overlay on top. `setVisible()` starts/stops polling.

**C3. `ghostMode` store + `GhostTrigger.svelte`.** `src/lib/stores/ghost.ts`
(`Writable<boolean>`, default false). `GhostTrigger.svelte` (headless, in root layout):
keyboard rolling-window `!!!` detector (port `EggTrigger`) + mobile rapid-theme-toggle
detector (subscribe to `mode`, count N flips in a window). Both **toggle** `ghostMode`
on/off. `GhostLayer` subscribes to `ghostMode` → `setVisible`. Optional: also apply a
subtle map theme when active.

**C4. `ghost-identities.ts`** `gpx-studio/website/src/lib/ghost-identities.ts` — pure
slug→persona map (condor→Kevin Mitnick, hopper→Grace Hopper, turing→Alan Turing,
ladyada→Limor Fried, mudge→Peiter Zatko, gibson, goldstein→Emmanuel Goldstein/2600,
dt→Dark Tangent, sharp, ricky, bigstar) + optional flavor line. Unknown slug →
title-cased fallback. Shared shape with the ghost proxy's `who` field.

## Refresh cadence
- Rabbit poll **~30–60s** (people move; fresher = better UX and faster revocation).
- Ghost poll **~90s** (stated 1–2 min).
- Poll only while the layer is visible/unlocked; first fetch fires immediately on show.

## Privacy / security
- **Rabbit Layer is opt-in only**, default OFF, verified-radios only, revocable instantly
  (toggle off → dropped from `/api/internal/mesh-map` on next scan → off the map within
  ≤~30s + swr window). Document that max exposure lag.
- run.gpx proxies are the sole trust boundary; rabbit proxy emits only
  `{displayName, userType, pinIcon, pinColor, hash, lastSeen}`; ghost proxy strips all
  keys. `nodes.json` (internal) and `/api/internal/mesh-map` (x-internal-secret) are
  reached server-to-server only — never the browser.
- Ghosts are simulated → no privacy surface.
- No writes beyond the user's own `showOnMap` toggle; no auth changes; no new infra
  (reuse meshtk + nginx + existing internal-call plumbing).

## Error handling
- Fail-soft everywhere: any upstream error → empty `FeatureCollection`, `200`; layers
  keep their last frame and retry next tick.
- `IsValid` gate mirrors meshtk (non-zero lat/lon + present position).
- Node-id intersection strictly via numeric `parseInt(nodeId.slice(1),16)>>>0`.

## Testing
- **run.human:** unit test `/api/internal/mesh-map` — filters to `verified && showOnMap`,
  numeric node-id conversion, safe-field projection, secret gate 403. Toggle PATCH test.
- **run.gpx:** unit tests on both proxy transforms with fixtures — rabbit intersection +
  safe projection; ghost filter + int-deg conversion + secret strip; empty-on-error.
  (Node ≥22.12 — `nvm use 23.6.0`.)
- **Manual:** studio `:5173` → webapp `:3002` (overlay recipe). Flip whoami "Show me on
  the map" → appear on Rabbit Layer; toggle off → disappear within a poll. Fire `!!!` →
  ghosts appear, move on poll, click reveals identity.

## Build sequencing (single spec, staged to de-risk)
1. **Ghost pipeline** (B2 + C2 + C3 + C4) — proves internal-feed → proxy → studio-layer →
   trigger end-to-end with zero privacy surface. Builds the shared studio-layer/poll base.
2. **Rabbit backend** (A1 + A2 + A3) — `showOnMap` field, toggle, internal feed.
3. **Rabbit proxy + layer** (B1 + C1) — reuses the proven substrate.

## Open defaults (confirm at review)
- Rabbit poll **~30–60s**, ghost **~90s**.
- Rabbit Layer **default ON** in the layer control (only consenting users appear).
- `showOnMap` lifetime: **persistent until toggled off** ("just a toggle"), with ≤~30s
  off-propagation lag documented. (Auto-expiry deferred as a possible enhancement.)
- One toggle **per verified radio** (mirrors per-node Impersonate); a user with multiple
  opted-in radios shows multiple pins.
- `GHOST_FEED_URL` = meshtk producer's **internal/private** address (exact host TBD at deploy).
- run.gpx gains `AUTH_INTERNAL_SECRET` + run-human internal host config (for the rabbit proxy).
