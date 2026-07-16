# gpx map v2 — dcjack icons, 25-runner pack, matrix fix — design

**Date:** 2026-07-16
**Area:** gpx.defcon.run (gpx-studio frontend + run.gpx webapp proxy + meshtk fleet)
**Status:** design approved (autonomous build authorized), pending build
**Related:** [[project_gpx_sim_rabbits_matrix]] (v1, shipped), [[project_mesh_map_layers_gpx]], [[project_mesh_ghost_feed_wiring]]

## Summary

Iteration on the shipped sim-rabbit crowd + matrix overlay. Four changes:

- **1. dcjack icon.** Replace the rabbit silhouette with the circular DEF CON "jack" logo (`dcjack.svg`), tinted per-color, rendered at **50% opacity** so overlapping runners blend into a denser blob. Applies to all sim runners.
- **2. 25-runner pack.** Add a clustered group of 25 runners doing one route together (spread ~1 block but moving as a pack), **alongside** the 12 ambient sim rabbits. Each pack runner gets a distinct `rabbit_####` identity.
- **3. Matrix fix.** The shipped ghost-mode matrix rain + green tint don't render. Root cause (to confirm live): overlay is trapped in the map's stacking context, and the tint's `mix-blend-mode: screen` is invisible over the light basemap. Fix: mount on `document.body` at a high z-index and use a green `multiply` tint.
- **4. Runners on REAL routes, independent from ghosts (user feedback).** v1 rabbits reuse ghost GPX basenames, so each rabbit sits on a ghost's exact path → the two layers look identical. Fix: embed the **real DC34 route GPX** (pulled from the live maps manifest) into meshtk and move the runners onto them — the 25-pack on **LVCC Indoor**, the 12 individuals on **12 distinct real routes** — off the ghost tracks. Also give the missing **`dt` ghost** a real LVCC position so all 10 personas load.

Trust boundary, camouflage parity, `escapeHtml`, and the rabbit popup are unchanged from v1.

## Decisions (locked)

| Question | Decision |
|---|---|
| Icon | `dcjack.svg`, tinted per-color (pinColor), **50% opacity**, replaces the rabbit silhouette for all sim runners |
| Pack | **Add** 25-runner pack alongside the 12; each pack runner a **distinct** `rabbit_####` name |
| Pack route/spread | **LVCC Indoor** (real DC34 route, `lvccindoor.gpx`), looping, **moderate spread** (`LatLongAltGitter ≈ 5000`) |
| Runners on real routes | Embed real DC34 route GPX in meshtk; 12 individuals → 12 distinct real routes (off ghost tracks); fixes ghost/runner independence + puts runners at LVCC |
| Missing ghost | Give `ghost.dt` (The Dark Tangent) a real LVCC start position so all 10 ghosts load |
| Matrix | Fix visibility: mount on `document.body` + high z-index; tint → green `multiply`. Keep rain+tint intensity. No basemap flip. |
| Execution | Full autonomous: spec→plan→SDD→PR→merge→buildpub→deploy use1→smoke |

## Current state (verified)

- v1 shipped LIVE: 12 sim rabbits render on the rabbit layer via `rabbitSvg(color)` (map-pin silhouette), popup = Identity+Radio+battery. Trust boundary + fail-soft verified. `battery`/`region`/`modem`/`fw` come through empty (meshtk publishes NodeInfo+Position only — known gap, not in scope here).
- `dcjack.svg` = one tintable `<path>` (viewBox `0 0 200 200`, fill `#000`), the circular DC jack face. Lives in `apps/run.human/webapp/public/header/dcjack.svg` (must be re-homed into gpx-studio as a TS module — studio can't import run.human).
- Default basemap = `mapboxOutdoors` (light). `mapboxDark` exists but is used programmatically.
- meshtk `LatLongAltGitter` is in 1e-7° units (≈1.1 cm); a single fleet member with `NodesPerSteadyInterval:[N]` generates N nodes (old ghost fleet used `[4]`). Node position, hwModel, role, battery are generated procedurally per node (`internal/app/fleet/nodes.go`).

---

## 1. dcjack icon (`gpx-studio`)

- **New `dcjack-svg.ts`** (map component dir): `export function dcjackSvg(color: string): string` — the full dcjack path with `fill="${color}"`, `viewBox="0 0 200 200"`, no `<style>` block. (Mirrors `rabbit-svg.ts`; color is our own pinColor, encodeURIComponent'd into a data URI — not an HTML sink.)
- **`rabbit-layer.ts`:** import `dcjackSvg` instead of `rabbitSvg`; register image id `jack-${color}` from `dcjackSvg(color)`. Layer changes:
  - `layout['icon-anchor'] = 'center'` (circular badge, not a bottom-pin).
  - `paint['icon-opacity'] = 0.5` (overlapping jacks blend → density reads as a crowd).
  - keep `icon-allow-overlap: true`; tune `icon-size` (~0.35–0.5 with a ~64px decoded image) so a jack is a legible ~30 px badge. Text label + popup unchanged.
- `rabbit-svg.ts` may be left in place (unused) or removed; removing keeps the tree clean.

## 2. 25-runner pack

### 2a. Identity resolver (`run.gpx/webapp/src/lib/sim-rabbit-identities.ts`)

Pack nodes are `rabbit-sim-pack-NN`. `simRabbitSlug` would collapse them all to slug `pack`, so add a unified resolver:

```ts
/** Resolve a sim node's display identity from its full longName.
 *  - rabbit-sim-pack-<id> → deterministic distinct rabbit_#### + cycled color (the pack)
 *  - rabbit-sim-<slug>     → SIM_RABBITS[slug] (the 12 individuals)
 *  - anything else         → null (skip) */
export function simRabbitIdentity(longName: string): SimRabbit | null { ... }
```

- **Pack branch:** match `/rabbit-sim-pack-([a-z0-9]+)/i`; derive a stable 16-bit hash from the captured id (FNV-1a over the full longName), then `displayName = "rabbit_" + hash.toString(16).padStart(4,"0")` and `pinColor = PACK_PALETTE[hash % PACK_PALETTE.length]`. Deterministic, distinct per node, `rabbit_####` convention (camouflage-consistent), no nodeId-format assumption.
- **Individual branch:** existing `simRabbitSlug` + `SIM_RABBITS`.
- Keep `SIM_RABBITS`, `simRabbitSlug`, `isSimRabbit`, `simRabbit` (still used/tested). `PACK_PALETTE` = ~6–8 plausible hex colors (no fixedColor).

### 2b. Feature collection (`mesh-nodes.ts`)

`simRabbitFeatureCollection` resolves identity via `simRabbitIdentity(n.longName)` (replacing the slug→`simRabbit` lookup); everything else (position gate, radioFields allowlist, keys stripped) unchanged. Pack + individuals flow through the same union in `rabbits/route.ts` (no route change).

### 2c. meshtk pack fleet member (`apps/run.mqtt/meshtk/meshtk.dc34.yaml`)

One new member, additive (ghosts + the 12 rabbits untouched):

```yaml
  - Id: "rabbit.pack"
    Description: "rabbit.pack (25-runner group run)"
    BehaviourTag: ["nodeinfo", "movement", "gitter"]
    BehaviourSecs: 30
    RampSteadySecs: 2419200
    Seed: "<unique-uuid>"
    ShortNameTmpl: "RP{{.nodeId}}"
    LongNameTmpl: "rabbit-sim-pack-{{.nodeId}}"
    NodesPerRampInterval: [25]
    NodesPerSteadyInterval: [25]
    RampUpSecs: 2
    RampDownSecs: 2
    Distribution: "uniform"
    BroadcastGitterSec: 600
    LatLongAltGitter: 5000          # ~±55 m spread along the LVCC Indoor route; tune live
    TextMessageGitterSec: 300
    Movement:
      - Type: "gpx"
        GPXFile: "./lvccindoor.gpx"  # real LVCC Indoor route; the whole pack runs it together
        Travel: "loop"
```

No seed file (meshtk generates the 25 nodes procedurally from `Seed`). `LongNameTmpl` doesn't match the ghost regex; `simRabbitIdentity` maps each to a distinct pack identity.

## 2d. Real DC34 routes: embed + re-home individuals + fix dt (fixes ghost/runner independence)

**Root cause of "ghosts == runners":** v1's 12 rabbit members reuse ghost GPX basenames (`swift→goldstein.gpx`, …), so each rabbit rides a ghost's exact path. Fix by moving runners onto the real DC34 routes, which are elsewhere (LVCC/Strip) than the ghost persona tracks.

**meshtk upstream (`~/working/meshtk`, per [[feedback_meshtk_upstream]]):**
- Add the real route GPX to `internal/embedded/gpx/runs/*.gpx` — pulled from the live maps manifest (`/api/gpx/public/maps` → signed S3 `downloadUrl`s), clean basenames: `lvccindoor, bigstar, east, frankie, history, littlestar, north, south, west, sign, original, othercons, tribute, lvccdds, lvccrebar` (all `<trkpt>`, Vegas/LVCC extent — meshtk `GPXCoords` parses `trk>trkseg>trkpt`). Basenames don't collide with existing `ghosts/`, `city/`, `dc33/`.
- Update the embed directive in `internal/embedded/gpx/embedded.go`: `//go:embed dc33/*.gpx ghosts/*.gpx city/*.gpx runs/*.gpx`.

**meshtk config (`apps/run.mqtt/meshtk/meshtk.dc34.yaml`, repo-tracked):**
- Re-home each of the 12 individual rabbit members' `GPXFile` from its ghost track to a **distinct real route** (1:1): swift→bigstar, dash→east, comet→frankie, nova→history, echo→littlestar, vega→north, orbit→south, pixel→west, raven→sign, scout→original, ember→othercons, frost→tribute. (LVCC Indoor reserved for the pack; DDS/Rebar spare.) Only the `GPXFile` line changes per member — identities/seeds untouched.
- The pack (2c) uses `lvccindoor.gpx`.

**dt ghost (`ghost.dt` member):** currently references a non-existent `./dt.gpx` → no valid position → filtered out of the feed (only 9/10 ghosts load). Give it a real position so The Dark Tangent appears at LVCC — either `Movement: gpx` on `./lvccdds.gpx` (a real LVCC route, keeps DT "at the con", distinct from the other ghost tracks) or a static LVCC start coord. Ghost stays a violet wisp (ghost layer), separate from the runners.

**Result:** ghosts on persona tracks (Strip + scattered); 12 individual runners on 12 distinct real DC34 routes; 25-pack on LVCC Indoor. The ghost and runner layers no longer overlap, and runners are on the actual runs. Build ships the embedded GPX because `apps/build.sh`/`build.sh` cp `~/working/meshtk` into the image build context.

## 3. Matrix fix (`gpx-studio`)

- **`matrix-rain.ts` / `ghost-layer.ts`:** mount the overlay on **`document.body`** instead of `map.getContainer()` — pass `document.body` to `new MatrixRain(...)`. `start()` appends canvas + tint to body; `stop()` removes them (teardown already complete). `innerWidth/innerHeight` sizing already matches a viewport mount.
- **`app.css`:** raise z-index far above studio chrome (canvas `2147483001`, tint `2147483000`), keep `position:fixed; inset:0; pointer-events:none`. Change the tint from `mix-blend-mode: screen` (invisible over light) to **`multiply`** with a green fill (e.g. `rgba(0,80,25,x)` gradient) so it green-darkens the light basemap. Rain stays on top at opacity ~0.55.
- **Live verification (required — this is a bug):** run gpx-studio dev (`:5173`), drive with Playwright, trigger ghost mode (`!!!`), screenshot, and confirm the rain + green tint actually render (and tear down when ghost mode is toggled off). Tune z-index/tint values against what the screenshot shows.

---

## Testing & verification

- **vitest (run.gpx webapp):** `simRabbitIdentity` — pack branch (distinct deterministic `rabbit_####` per `rabbit-sim-pack-NN`, cycled color, two different NN → two different names), individual branch (the 12 unchanged), unknown → null; `simRabbitFeatureCollection` still emits allowlisted fields with keys stripped for both pack and individuals. Node ≥22.12 (`nvm use 23.6.0`).
- **gpx-studio:** svelte-check clean for changed files (pre-existing 30-error baseline unchanged); vite production build succeeds.
- **Live browser (matrix):** Playwright screenshot of ghost mode showing rain + tint, and clean teardown. This is the acceptance gate for the matrix fix.
- **Post-deploy smoke:** `rabbits` feed shows the 12 + ~25 `rabbit_####` (≈37 features) once meshtk ramps; trust boundary clean (no keys); ghosts still 9.

## Deploy

- run.mqtt (fleet YAML baked in image) → `buildpub(run.mqtt, use1)` → `deploy.yml(us-east-1, pr_number=skip)`.
- run.gpx (studio+proxy in image) → `buildpub(run.gpx, use1)` → deploy.
- Merge `--squash --admin`; wait ECS `deployments=1` + `COMPLETED`.

## Constraints / invariants (unchanged from v1)

- Trust boundary: field-by-field allowlist via `radioFields`; never emit keys/creds/`hash`; no raw-object spread.
- `escapeHtml` every popup value; pinColor resolves `|| DEFAULT_PIN_COLOR` (not `??`).
- Regex isolation: sim `/rabbit-sim/i` (incl. `rabbit-sim-pack-*`) vs ghost `/ghost|contest|operative/i`.
- meshtk change additive; pack member Seed unique vs ghosts + the 12; no seed-file collision.

## Scope boundary (YAGNI)

- Not solving the telemetry gap (battery/region/modem/fw empty — meshtk publishes NodeInfo+Position only). Separate follow-up.
- No basemap flip on ghost mode (matrix fix is visibility only).
- No real-rabbit position blur (still a later phase).
- Pack uses procedural nodes (no 25 seed files).
