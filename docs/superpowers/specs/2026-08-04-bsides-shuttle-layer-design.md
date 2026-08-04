# B-Sides Las Vegas Shuttle Layer — Design

**Date:** 2026-08-04
**Status:** Approved
**App:** run.gpx (gpx.defcon.run)

## Summary

Put the B-Sides Las Vegas shuttle buses on the gpx.studio map as live position markers,
sourced from the B-Sides fleet's GPS vendor feed. The layer is a hidden easter egg —
invisible until unlocked by a search keyword or key gesture — and clicking a bus awards a
covert 1-point CTF flag.

Today the fleet is two parked buses at the Tuscany. The design assumes they will move
later, and assumes the feed URL will change.

## The upstream feed

`GET https://portal.gps-tracking.com/geojson.aspx?action=shareinit&sid=175300`

Returns a GeoJSON `FeatureCollection` of `Point` features, `content-type: text/plain`,
~1.2 KB for the current two-bus fleet. Observed 2026-08-04:

| Field | Shuttle1 | Shuttle2 | Notes |
|---|---|---|---|
| `id` | `gps_985645` | `gps_985646` | stable per device |
| coords | -115.160809, 36.112728 | -115.160840, 36.112809 | ~9 m apart, same lot |
| `icon` | `pink-bus/pink-bus-345.png` | `orange-bus/orange-bus-60.png` | **color clue** |
| `hdg` | 340 | 59 | degrees |
| `kmh` / `spd` | 0 | 0 | both parked |
| `addy` | 255 East Flamingo Road Las Vegas | same | Tuscany |
| `date` | 8/04/2026 12:45:00 PM | 8/04/2026 4:15:00 AM | no timezone |
| `batt`/`cellsignal`/`gpssignal` | 100 / 15 / 7 | 100 / 15 / 0 | device health |
| `sn` | 8882424371 | 8882439337 | device serial |

Two derived facts:

- **`icon` encodes the livery color.** Format is `<color>-bus/<color>-bus-<NNN>.png`, where
  `NNN` is `hdg` snapped to 15°. We take the color prefix and ignore the rotation suffix —
  it is redundant with `hdg`, and we rotate our own glyph rather than hotlinking vendor PNGs.
- **The buses self-report their anchor.** Both carry the Tuscany address, so no hardcoded
  anchor is needed for normal operation. A fallback anchor exists only for a feature that
  arrives without usable coordinates.

### Constraint: no CORS

Verified 2026-08-04 with an explicit `Origin: https://gpx.defcon.run` request header and a
separate `OPTIONS` preflight. The response carries **no `Access-Control-Allow-Origin`** and
the preflight returns only `Allow: OPTIONS, TRACE, GET, HEAD, POST`. A browser `fetch()`
therefore cannot read this feed. Only the GPS vendor can change that.

A direct client-side call is not an option. A CloudFront origin fronting the vendor would
make the browser call same-origin, but CloudFront cannot reshape a JSON body, so it would
republish device serials and tamper flags verbatim — see *Trust boundary* below. The
server-side proxy is required on privacy grounds independent of CORS.

### Constraint: egress (resolved, no work needed)

The run.gpx Fargate task can reach arbitrary internet hosts today:

- `infra/terraform/live/site/region/us-east-1/network/network.hcl:32` — `nat_gateway { enabled = true }`
- `infra/terraform/modules/network/v1.0.0/natgw.tf` — private route table routes `0.0.0.0/0` to the NAT gateway
- `infra/terraform/modules/network/v1.0.0/securitygroups.tf` — service SGs egress `protocol = "-1"`, `cidr_blocks = ["0.0.0.0/0"]`

No infrastructure change is part of this work.

## Architecture

```
gpx-studio (browser)  ──45 s poll──▶  /{region}/api/gpx/public/shuttles
                                              │  (run.gpx webapp, 30 s cache)
                                              ▼
                                     portal.gps-tracking.com
```

The 30 s server cache means one upstream request per task per interval regardless of viewer
count. CloudFront has caching disabled on `/{region}/*`, so the `s-maxage` header is
decorative here and the in-module cache is the real one.

This mirrors `/api/gpx/public/rabbits` exactly. No new patterns are introduced.

## Component 1 — the proxy

**File:** `apps/run.gpx/webapp/src/app/api/gpx/public/shuttles/route.ts`

A ~70-line clone of the rabbits route. Responsibilities:

- **Configurable upstream.** URL comes from `BSIDES_SHUTTLE_FEED_URL`, defaulting to the
  current `shareinit` URL. The vendor URL is expected to change (the `action=shareinit`
  call sets an ASP.NET session cookie, implying a paired update endpoint). Swapping it is a
  task-definition change, not a code change or release.
- **Trust boundary — field whitelist.** Emits only `id`, `name`, coordinates, `hdg`, `kmh`,
  `color`, `lastFixMs`. Drops `sn`, `vin`, `batt`, `volts`, `fuel`, `tamper`, `cellsignal`,
  `gpssignal`, `addy`, `notes`, `grp`, `model`, `elev`, `wired`, `icow`, `idx`. These never
  reach a browser. This is the reason the proxy exists even setting CORS aside: we should
  not republish another organization's device health, serial numbers, or exact street
  addresses.
- **Color derivation.** Parse the prefix of `icon` before `-bus/`. Recognized values render
  in their livery color; anything unrecognized falls back to a neutral color rather than
  failing the feature.
- **Timestamp.** Parse `date` as `America/Los_Angeles` (the feed carries no timezone) into
  `lastFixMs` epoch milliseconds.
- **Fail-soft.** 3 s `AbortSignal.timeout`, `cache: "no-store"` outbound. On timeout,
  upstream error, or malformed JSON: serve the last-good response if it is still recent,
  otherwise an empty `FeatureCollection`. The route never returns 5xx — a quiet layer, not
  a broken map.
- **Fallback anchor.** A feature with missing or zero coordinates is placed at the Tuscany
  lot position the feed itself reports today.

**Tests** (`route.test.ts`, vitest, fixture-driven from the captured 1.2 KB response):
color parsing for both buses; whitelist enforcement asserting `sn` and `batt` are absent
from output; timestamp parsing; malformed upstream yields an empty collection; timeout
yields an empty collection.

## Component 2 — the map layer

**Files:** `apps/run.gpx/gpx-studio/website/src/lib/components/map/shuttle-layer.ts`,
`map/shuttle-svg.ts`, `lib/stores/shuttle.ts`

Structurally a sibling of `rabbit-layer.ts` (248 lines): a `shuttleState` writable store
(`{ available, visible, count }`), a 45 s poll against the proxy, a GeoJSON source and
symbol layer inserted via `z-bands`, region-prefix URL resolution identical to
`rabbitUrl()`.

Layer-specific behavior:

- **Glyph.** A bus SVG registered as two tinted map images (pink, orange) via `map.addImage`,
  selected per feature by the `color` property, with `icon-rotate: ['get', 'hdg']` so a
  moving bus points where it is going.
- **Staleness.** `icon-opacity` drops to ~0.45 for features whose `lastFixMs` is older than
  30 minutes. The popup states it plainly ("parked · last seen 10h ago"). Stale buses are
  never hidden: the feed is quiet most of the year, and hiding them would make the egg
  unfindable and the flag unobtainable outside the event.
- **Hidden by default.** No layer and no Map Layers panel row exist until the layer is
  unlocked, mirroring the `deuceShown` store pattern.

## Component 3 — unlock

- **Search keywords.** `bsides`, `b-sides`, `shuttle` in the map's `externalGeocoder`
  (`map.ts`), alongside the existing `deuce|monorail` and `publicus|coffee` entries.
- **Typed gesture.** Typing `bsides` anywhere on the map, via `recordHit` in
  `GhostTrigger.svelte`. The gesture block must sit **before** the `!` early-return — that
  ordering has caused bugs in this file before.

## Component 4 — egg and flag

- **Egg entry** `dc34-bsides-shuttle` added to `DEFAULT_EGGS` in
  `apps/run.gpx/webapp/src/app/api/gpx/public/eggs/route.ts` (CMS-overridable). The
  order-sensitive `EXPECTED_IDS` list in `route.test.ts` must be updated in the same change.
- **Modal** `map/shuttle-egg.ts`, cloned from `deuce-egg.ts`.
- **Flag.** Covert, 1 point, id `bsides-shuttle`, reveal word `bsides`. The layer carries
  `encodeFlag('bsides-shuttle', 'bsides')`. A `Ctf` row is seeded into the production
  `run-human-electro` table at `pk=$run#challenge_bsides-shuttle` with
  `hashAnswer('bsides')` under `DEFAULT_SALT`, cloned from the deuce-egg row shape via the
  existing CLI.

## Out of scope

Deliberately not built, to keep this to one reviewable change:

- **Route polylines and stop pins.** No shuttle routes exist yet. The layer accepts them
  later without restructuring.
- **Motion interpolation and animation.** These are real vehicles reporting real positions;
  markers jump to the reported point. The Deuce layer simulates motion because it has no
  feed — this one does, so there is nothing to simulate.
- **Historical trails.**
- **Any infrastructure change.**

## Verification

- Vitest on the proxy, fixture-driven.
- `npx svelte-check`, counting only files added by this change — that tree carries ~26–30
  pre-existing upstream errors.
- Ship: PR → squash merge → `buildpub.yml -f apps=run.gpx -f regions=use1` →
  `deploy.yml -f region=us-east-1 -f invalidate_cache=true`. Check for in-flight same-app
  buildpub runs first, because ECR tags are immutable. Confirm the ECS task-definition
  revision incremented — `deploy.yml` can go green while a terragrunt apply failed.
- Prod probe: chunk-graph BFS to confirm the layer code is in the deployed bundle, then the
  Playwright map probe (stub `**/use1/api/gpx/**` and `**/use1/api/user/**` first, Mapbox
  token from SSM with `--with-decryption`).

## Open items

- The future feed URL. Handled by `BSIDES_SHUTTLE_FEED_URL`; no code change when it lands.
- Shuttle routes, when B-Sides provides them.
