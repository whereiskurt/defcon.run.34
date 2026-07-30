---
created: 2026-07-30T02:15:00Z
title: "ghost fleet positions — GPX embed landmine + double jitter (fleet itself is healthy)"
area: run.mqtt
priority: medium
---

Kurt 2026-07-30: "why doesn't ricky show up on the meshtastic map with coords... but is
listed in nodes.json? not all of them are mapping". Investigated. **The fleet is healthy** —
this is captured for the two real latent issues found along the way, not for a live outage.

## What was actually happening (no bug)

`ricky` is the **only** one of 25 fleet entries whose position does not depend on GPX:

| | `ghost.gibson` (typical) | `ghost.ricky` |
|---|---|---|
| `BehaviourTag` | `nodeinfo, movement, gitter, chatbot` | **`nodeinfo, position, …`** |
| `Movement.Type` | `gpx` + `GPXFile` | **`start`** (literal lat/long) |
| Position depends on the go:embed? | **yes** | **no** |

Roster is `apps/run.mqtt/meshtk/meshtk.dc34.yaml` (`Fleet:` at :88, 25 entries; ricky at
:473-511). There is **no enable flag, no schedule, no con-day and no event window** anywhere
in `internal/app/fleet/` — every entry is simulated unconditionally (`cmd.go:254`, `:332`).
`MESHTK_GHOST_START_DELAY` is wired in `service.hcl:362` but referenced by **zero** lines of
Go — a dead env var.

Position emission is hard-gated on `if len(m.GPXCoords) > 0` in `publishNextGPXMovement`
(`behaviours.go:131,141`) — **no resolved route means no position, silently**. So if the GPX
embed ever breaks, ricky becomes the only node still broadcasting a position. That is exactly
the #1028 regression ("ghosts stuck at 0,0", vendor-sync clobbered `embedded.go`).

**Verified NOT the case right now:** both meshtk containers in `run-mqtt-use1` (proxy *and*
ghosts — one service, five containers) run **v0.0.73**, well past **v0.0.67** which first
carried the embed fix; zero `Failed to find GPX file` lines in the ghosts stream; and
`https://mqtt.defcon.run/nodes.json` shows **60 of 67 nodes carrying real coordinates** —
ghosts spread across Vegas (`GR00` 36.1565,-115.1541 = ricky's seed, plus GG00/GT00/GS00/
GM00/GL00 all distinct), rabbits `RP00`-`RP04` in Vegas, `RN10`/`RN11` in NYC, one in
Melbourne. The seven `0,0` entries are **human radios** (`SHA`/`SHA1`/`SHA4`/`T34`), not
ghosts — user radios that have not sent a position.

Also confirmed: **meshtk has no `POSITION_APP` handler at all** (`FleetNodeHandler`,
`cmd.go:769-798`, switches only on `NODEINFO_APP` and `TEXT_MESSAGE_APP`; `POSITION_APP`
appears in exactly one non-test line, `publish.go:354`). The fleet is **broadcast-only** for
positions, so a manual position exchange can never make a fleet node answer — Kurt's exchange
got ricky's NODEINFO, and the pin came from ricky's own 30s broadcast. Other nodes populate a
client as their own 30-90s broadcasts arrive.

Consumer-side gate worth knowing: the public meshmap at mqtt.defcon.run **hides ghost nodes in
normal mode** — they render only in mobileMode / "GHOST MODE" (`nginx/index.html:207`,
`:357-370`). Not a bug. Separately, `showOnMap` is NOT a ghost gate: the
`/api/internal/mesh-map` filter (`route.ts:42`, `!r.verified || !r.showOnMap`) reads
`MeshRadio` rows, which only ever hold **human** radios.

## Finding 1 — standing go:embed landmine (no test guards it)

Upstream `/Users/khundeck/working/meshtk/internal/embedded/gpx/embedded.go:8` **still** has
only `//go:embed example/*.gpx`, while the monorepo overlay has the full set
(`dc33/*.gpx ghosts/*.gpx city/*.gpx runs/*.gpx example/*.gpx`). The image copies only
`nodes.*.json` (`Dockerfile.meshtk:24-28`), so **embed is the only route-resolution path**.
Any future `apps/run.mqtt/meshtk` vendor-sync that takes upstream's copy re-breaks all 24
GPX-driven nodes, and the only guard is a warning comment. **Add a test asserting all 24
routes resolve to >0 points** so this cannot regress silently a third time (#1009 → #1028).

## Finding 2 — double jitter on GPX-driven nodes

`behaviours.go:161-166` jitters `node.Latitude/Longitude`, then `publishPosition`
(`:123-127`) jitters again from an identically-seeded RNG. GPX-driven nodes are therefore
published at roughly **2× `LatLongAltGitter`** (≈ ±0.02°, on the order of ±2 km) off their
actual route. ricky, being `position`-tagged, is jittered only once.

## Diagnostic recipe (cheapest first) if positions ever vanish again

1. Ghosts log stream (`/ecs/run-mqtt-ghosts-run-mqtt-use1-dc34`, runs `-v debug`) for
   `Failed to find GPX file either on filesystem or embedded` — one line per route at startup.
2. Running image tag for the ghosts container vs **v0.0.67**; below it ⇒ embed gate.
3. `curl https://mqtt.defcon.run/nodes.json` — coords frozen at the `nodes.ghost.*.json` seed
   ⇒ only the ramp-up publish landed; coords at 0/0 ⇒ nodes regenerated with empty
   `GPXCoords`; coords changing every 30-90s ⇒ publishing is fine, look downstream.
4. `ghost.dt` and all 12 named `rabbit.*` have a NodeDb id that does **not** match
   `fnv64a(Seed+"-0")`, so they are regenerated every boot (`simulate.go:49-58`) and are the
   ones that land on Null Island when GPX is missing. The 8 ghosts `goldstein`…`gibson` plus
   `ricky` keep their seed coordinates.

⚠️ Note `nodes.json` is **not a roster** — it is written by `meshobserv nodeinfo announce`
every 5s from *observed* MQTT traffic (`apps/run.mqtt/nginx/supervisord.conf:17-31`, served by
`nginx.conf:41`). Presence there only proves a node's NODEINFO was seen on-channel.
