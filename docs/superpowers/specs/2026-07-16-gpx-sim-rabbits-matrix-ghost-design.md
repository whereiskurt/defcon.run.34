# Sim-rabbit camouflage crowd + matrix ghost overlay — design

**Date:** 2026-07-16
**Area:** `gpx.defcon.run` map (run.gpx webapp proxy + gpx-studio frontend) and the meshtk fleet (run.mqtt)
**Status:** design approved, pending spec review
**Related:** [[project_mesh_map_layers_gpx]], [[project_mesh_ghost_feed_wiring]], [[project_gpx_ghost_realtime_rabbit_popups]], [[cashrain-prod-debug]]

## Summary

Two independent map features that share the gpx-studio build/deploy:

- **Feature A — Sim-rabbit camouflage crowd.** A permanent ambient population of ~10–12 simulated "runners" (real meshtk telemetry, moving along GPX) that render on the **rabbit layer** as branded rabbit pins with a detailed radio-config popup. They are indistinguishable from real opted-in attendees. Purpose: a lone real rabbit is trivially trackable; a plausible crowd gives real attendees **k-anonymity to hide in** (cover traffic).
- **Feature B — Matrix ghost overlay.** When the hidden ghost layer activates, a matrix-green digital-rain canvas + green tint wash fades in over the whole map — a distinct "you've entered the matrix" view shift. Ported from the existing DC33 rain in `apps/static/landing`.

Both ship dark/safe: Feature A is only visible on the rabbit layer (default-on but currently empty), Feature B only when ghost mode is unlocked (`!!!` / 4× theme-flip). The ghost easter-egg data/personas are **untouched**.

**Non-goal (this spec):** the "blur/camouflage" transform on *real* rabbit positions (jitter / snap-to-grid for k-anonymity of the real signal). Recorded as a follow-up phase — the sim crowd is the first half of the same goal.

## Decisions (locked during brainstorm)

| Question | Decision |
|---|---|
| Core goal | Populate the rabbit layer as ambient **cover traffic** (camouflage), distinct from the ghost egg |
| Data fidelity | **Live meshtk telemetry** — a dedicated sim-rabbit fleet publishing over MQTT (not synthetic/faked) |
| Rabbit icon | **One rabbit silhouette tinted per-color** for the whole rabbit layer (real + sim); color = individuality |
| Fleet size / movement | **~10–12** sim rabbits reusing the **embedded Vegas GPX** basenames (no new tracks) |
| Sim names | **Mimic real: `rabbit_####`** so sims are indistinguishable from real attendees |
| Popup fields | **Identity + Radio + battery** (trimmed): name+color, hwModel, role, region·modemPreset, fwVersion, channel, battery% |
| Matrix intensity | **Rain + green tint wash** (no full CRT scanlines) |

## Current state (verified in worktree `gpxghost`)

- **nodes.json feed** is live: meshtk ghost fleet publishes → meshobserv writes `nodes.json` → run-gpx proxies poll it. (Fixed across #652/#657/#659.)
- **Ghost layer** `ghost-layer.ts`: violet Pac-wisp symbol layer, name-filtered `/ghost|contest|operative/i`, minimal popup. Unlocked by `!!!` / 4× theme-flip. **Populated in prod.**
- **Rabbit layer** `rabbit-layer.ts`: branded per-runner pins (`dc34-pins` `pinSvg(icon,color)`), popup = displayName+userType. Fed by `rabbits/route.ts` which intersects `nodes.json` × run.human `/api/internal/mesh-map`. **Currently empty** (no real attendees opted-in pre-con).
- **`dc34-pins.ts`** already defines a `bunny` glyph and `DEFAULT_PIN_ICON = 'bunny'`; `pinSvg(icon, color)` tints by color. `fixedColor` icons ignore the runner's color.
- **`mesh-nodes.ts`** trust boundary: `ghostFeatureCollection` (name-filter + field allowlist, keys stripped) and `rabbitFeatureCollection` (nodeNum intersect, emits displayName/userType/pinIcon/pinColor/lastSeen only — **radio fields stripped today**).
- **meshtk fleet** `apps/run.mqtt/meshtk/meshtk.dc34.yaml`: per-persona `Fleet` members with `LongNameTmpl`, `Movement.GPXFile` (embedded, basename-resolved), `NodeDbPath: ./nodes.ghost.<slug>.json`, `RampSteadySecs: 2419200`. Seeds carry hwModel/role/region/modemPreset/fwVersion + keys.
- **Matrix rain** source: `apps/static/landing/index.html` — self-contained canvas (`drops[]`, glyph set `01</>{}[]#$ラ ンドセキュ▚▞◆·`, ~55ms RAF throttle, fade-trail `fillRect`, `--primary` accent, `prefers-reduced-motion` early-return).

## Trust-boundary invariant (must hold for both real + sim)

The run.gpx proxies are the trust boundary. **Never** emit `pubkey`/`privkey`/mqtt creds/`hash`. Everything is a field-by-field allowlist. Radio-config fields we DO surface are the runner's own low-sensitivity device telemetry (hwModel, role, region, modemPreset, fwVersion, batteryLevel, channel default flag). Because real and sim rabbits must look identical (camouflage), the **same** allowlist applies to both — this means extending the real `rabbitFeatureCollection` to emit these fields too, from the runner's own node. All user/text values remain `escapeHtml`'d in popups (stored-XSS guard from #639).

---

## Feature A — Sim-rabbit camouflage crowd

### A1. meshtk sim-rabbit fleet (`apps/run.mqtt/meshtk/`)

Add ~10–12 **sim-rabbit `Fleet` members** to `meshtk.dc34.yaml`, alongside (not replacing) the ghost members. Each member is lighter than a ghost (no OTP/chatbot/OpenAI):

```yaml
  - Id: "rabbit.swift"
    Description: "rabbit.swift"
    BehaviourTag: ["nodeinfo", "movement", "gitter"]   # no chatbot
    BehaviourSecs: 30
    RampSteadySecs: 2419200          # ~28d, persists through con
    Seed: "<unique-uuid>"
    ShortNameTmpl: "R{{.nodeId}}"
    LongNameTmpl: "rabbit-sim-swift-{{.nodeId}}"        # NOT ghost-* ; matched by /rabbit-sim/i
    NodesPerRampInterval: [1]
    NodesPerSteadyInterval: [1]
    RampUpSecs: 2
    RampDownSecs: 2
    Distribution: "uniform"
    BroadcastGitterSec: 600
    LatLongAltGitter: 1000
    TextMessageGitterSec: 300
    NodeDbPath: "./nodes.rabbit.swift.json"
    Movement:
      - Type: "gpx"
        GPXFile: "./goldstein.gpx"    # reuse an EMBEDDED Vegas track (basename match)
        Travel: "loop"
```

- **Movement:** reuse the embedded ghost GPX basenames (`goldstein.gpx`, `turing.gpx`, `hopper.gpx`, `ladyada.gpx`, `sharp.gpx`, `mudge.gpx`, `gibson.gpx`, `condor.gpx`, plus `city/*.gpx` if more variety is wanted). Distribute the ~10–12 rabbits across the available tracks so they don't all overlap. No new GPX authoring.
- **Seeds:** ship `nodes.rabbit.<slug>.json` (mirror the ghost seed shape: hwModel/role/region/modemPreset/fwVersion + per-node keys + a valid Vegas start position). Keys are last-year-style test data and are stripped at the proxy anyway. Follow the exact build-mechanism the ghost seeds use so they land in `/app` at runtime (repo-tracked over the `~/working/meshtk` clone; Dockerfile `COPY nodes.rabbit.*.json /app/`).
- The sim nodes publish NodeInfo/Position/telemetry over MQTT exactly like ghosts → meshobserv folds them into the **same** `nodes.json`.
- **meshtk source lives upstream** (`~/working/meshtk`) per [[feedback_meshtk_upstream]] — GPX/embedded changes go there; the fleet YAML + seeds are repo-tracked in `apps/run.mqtt/meshtk/`.

### A2. Sim identities (`apps/run.gpx/webapp/src/lib/sim-rabbit-identities.ts`, new)

A static local map (mirror of `ghost-identities.ts`) so no fake run.human accounts are needed:

```ts
// slug (from rabbit-sim-<slug>-NN) → camouflage identity
export const SIM_RABBITS: Record<string, { displayName: string; pinColor: string }> = {
  swift:  { displayName: "rabbit_4821", pinColor: "#e6007a" },
  dash:   { displayName: "rabbit_1337", pinColor: "#00d4aa" },
  // …10–12 total, rabbit_#### names, varied plausible pinColors
};
export function simRabbit(slug: string) { return SIM_RABBITS[slug]; }
export function simRabbitSlug(longName: string): string { /* rabbit-sim-<slug>-NN → slug */ }
```

`displayName` uses the `rabbit_####` convention so sims blend with real attendee names. `pinColor` gives each a distinct tint (never `fixedColor`).

### A3. Trust-boundary proxy (`apps/run.gpx/webapp/src/lib/mesh-nodes.ts`)

- **New `simRabbitFeatureCollection(db)`:** filter nodes by `/rabbit-sim/i` (distinct from the ghost regex, so sims never leak onto the ghost layer and ghosts never leak onto the rabbit layer), require `hasValidPosition`, resolve identity via `simRabbitSlug` → `SIM_RABBITS`, and emit the **rabbit + radio** property set (below). Skip unknown slugs.
- **Extend `rabbitFeatureCollection`** to emit the **same radio field set** from each real runner's own node, so real and sim popups are identical (camouflage). Keys stay stripped.
- **Shared property allowlist** emitted for every rabbit feature (real or sim):
  - Identity: `displayName`, `pinColor` (pinIcon dropped — layer forces the rabbit silhouette; see A4)
  - Radio: `hwModel`, `role`, `region`, `modemPreset`, `fwVersion`, `channel` (from `hasDefaultCh` → `"dc.run"`/`"default"`)
  - Telemetry: `battery` (batteryLevel, -1 if absent), `lastSeen`
  - (`userType` retained as `"rabbit"` for both.)

### A4. `rabbits/route.ts` — union real + sim

```ts
const db = await nodes.json();                 // existing GHOST_FEED_URL fetch
const real = rabbitFeatureCollection(db, entries ?? []);
const sim  = simRabbitFeatureCollection(db);   // no run.human dependency
return json({ type: "FeatureCollection", features: [...real.features, ...sim.features] });
```

- Sim rabbits appear even when the run.human `/api/internal/mesh-map` fetch fails — wrap so a mesh-map failure still returns the sim crowd (real half degrades to empty, sim half persists). Keep the 3s `AbortSignal.timeout` + fail-soft `{features: []}` on total failure.
- No new route/proxy — sims ride the existing rabbit trust boundary.

### A5. Rabbit icon + rich popup (`apps/run.gpx/gpx-studio/website/`)

- **`rabbit-layer.ts`:** replace the per-runner `pinSvg(icon,color)` branded pin with a single **`rabbitSvg(color)`** silhouette (ears + body, `viewBox 0 0 24 24`), registered once per color as image id `rabbit-<color>`, tinted by the feature's `pinColor` (`|| DEFAULT_PIN_COLOR`, using `||` not `??` per the empty-string coercion landmine). `icon-image: ['get','iconId']` stays; only the SVG source changes. Ghost layer icon untouched.
- **Rich popup** (`clickFn`): a dark card (`.dc34-rabbit-reveal`) with the trimmed field set — name + color swatch, then a small key/value grid: hwModel · role · region/modemPreset · fw · channel · battery%. **All values `escapeHtml`'d.** Missing fields render `—`.
- **`app.css`:** add `.dc34-rabbit-popup`/`.dc34-rabbit-reveal` dark-card styles (bespoke-dark, matching the ghost-reveal aesthetic). These rules don't exist yet.

### A6. Camouflage consistency checks

- Sim and real popups must render byte-for-byte structurally identical (same fields, same "—" for missing) so a viewer can't distinguish sim from real by popup shape.
- Sim `displayName` follows `rabbit_####`; positions are real Vegas coordinates from the embedded tracks; telemetry drifts because it's real meshtk output.

---

## Feature B — Matrix ghost overlay

### B1. `matrix-rain.ts` (`apps/run.gpx/gpx-studio/website/src/lib/components/map/`, new)

A framework-agnostic class (constructor takes the map container / a parent element), porting the `apps/static/landing` rain:

- Mounts a **fixed full-viewport `<canvas>`** over the map, **under** the map controls, `pointer-events: none`, above the map canvas.
- Recolored to **matrix-green `#00ff41`** (occasional white lead glyph retained). Same glyph set, ~55ms RAF throttle, fade-trail `fillRect`, DPR-aware resize.
- Plus a **green tint wash**: a sibling fixed element (or a translucent green `fillRect` base pass) giving the whole view a green cast — the "distinct change in view."
- `start()` fades in (canvas opacity 0→1 + tint), `stop()` fades out then cancels the RAF and removes the canvas (no leaked animation frame — mirror the ghost layer's `remove()` discipline).
- **Reduced-motion:** unlike the landing (which early-returns), this is a **user-triggered** easter egg. If `prefers-reduced-motion`, show the **static green tint only** (no animated rain) rather than nothing — lesson from [[cashrain-prod-debug]] (a reduced-motion gate made a user-triggered effect invisible in prod).

### B2. Bind to ghost activation (`ghost-layer.ts`)

- Instantiate `MatrixRain` in the ghost layer; in `setVisible(true)` call `matrix.start()`, in `setVisible(false)` and `remove()` call `matrix.stop()`.
- The matrix is purely decorative and independent of the ghost data poll — it starts/stops with visibility, not with feed success.

---

## Testing & verification

- **Pure logic (vitest, run.gpx webapp):** `simRabbitFeatureCollection` (name filter, unknown-slug skip, key-stripping, field allowlist), `simRabbitSlug` parsing, extended `rabbitFeatureCollection` radio fields, and `rabbits/route.ts` union + degrade-when-mesh-map-fails. Node ≥22.12 (`nvm use 23.6.0`) per [[reference_node_version_for_bib_tests]].
- **gpx-studio** has no test runner → `svelte-check` only for `rabbit-layer.ts` / `matrix-rain.ts` / `ghost-layer.ts`.
- **Local end-to-end:** `apps/run.mqtt/docker-compose.yaml` (meshobserv/ECS-Exec-free reproduction) to confirm sim nodes publish and `nodes.json` carries `rabbit-sim-*`; studio `:5173` → webapp `:3003` overlay verify per [[reference_gpx_overlay_local_verify]] — rabbit pins render as tinted rabbits, popup shows radio card, ghost mode shows matrix rain + green tint.
- **Browser UAT (human gate):** rabbit-layer camouflage look, sim/real popup parity, ghost-mode matrix transition, XSS-shaped displayName renders inert.

## Deploy

- **run.mqtt** (fleet YAML + seeds are baked into the image): `buildpub(run.mqtt, use1)` → `deploy.yml(us-east-1, pr_number=skip)`. Config in the image needs the rebuild; task-def-only changes wouldn't.
- **run.gpx** (webapp proxy + gpx-studio built inside the image): `build-frontend.sh` locally to verify, then `buildpub(run.gpx, use1)` → `deploy.yml(us-east-1, pr_number=skip)`.
- Branch protection → `gh pr merge --squash --admin`. ECS single-task rollout: wait `deployments=1` + `rolloutState COMPLETED`.

## Risks / landmines

- **meshtk deploy chain** is the historically fragile part (the ghost feed took 4 bugs: dead collector cmd, cwd/`-c`, stdin block, `MESHTK_NODEDBPATH` viper env name). The pipeline is now fixed; adding fleet members reuses it, but verify sim nodes actually publish (ghosts container logs "Loaded N nodes", `nodes.json` gains `rabbit-sim-*`) before assuming the proxy is the problem.
- **Ghost vs rabbit regex isolation:** `rabbit-sim-*` must not match `/ghost|contest|operative/i` and must match `/rabbit-sim/i`. Confirm no cross-leak in tests.
- **pinColor empty-string coercion:** use `p.pinColor || DEFAULT_PIN_COLOR` (`||`, not `??`) or rabbits render black.
- **Trust boundary:** never spread raw node/user objects; keys/creds/hash never emitted; every popup value `escapeHtml`'d.
- **RAF leak:** `matrix.stop()` must cancel `requestAnimationFrame` and remove the canvas.

## Scope boundary (YAGNI)

- No chatbot/OTP on sim rabbits (they're movement + telemetry only).
- No new GPX tracks (reuse embedded).
- No real-rabbit position blur/jitter (separate follow-up phase).
- No full CRT scanline/vignette (rain + tint only).
- No new proxy route (union into existing `rabbits/route.ts`).
