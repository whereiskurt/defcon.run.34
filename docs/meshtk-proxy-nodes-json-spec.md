# Spec: meshtk proxy emits `nodes.json` (retire meshobserv + mqtt.defcon.run webapp)

Status: DRAFT / proposal (2026-07-18). Author: KPH + Claude.
Context: written after fixing the ghost-chatbot PKI reply chain, whose last bug
was the sender pubkey flapping out of the meshobserv-produced `nodes.json`.

## Goal

Have the **meshtk proxy** (`meshtk server proxy`, the `run-mqtt-meshtk`
container) build and emit the `nodes.json` node database directly, so we can:

1. **Delete the `meshobserv` process** (currently a second `meshtk` binary
   baked into the `run-mqtt-nginx` container that independently subscribes to
   MQTT and writes `nodes.json`).
2. **Retire the `mqtt.defcon.run` map webapp** (the meshmap HTML served by
   nginx). `gpx.defcon.run` already renders the realtime map from the same
   `nodes.json` feed and is the intended long-term home.

## Current architecture (what exists today)

```
radios ──TLS──▶ NLB :8883/:4433 ──▶ meshtk proxy :1883 ──▶ mosquitto :1884
                                         │ (inspects every packet: ACL,
                                         │  rate-limit, blocklist)
                                         ▼
                              (does NOT persist node state)

nginx container:
  ├─ meshobserv  (== meshtk binary, `nodeinfo` cmd) ── subscribes to mosquitto,
  │                unmarshals NODEINFO/POSITION/TELEMETRY/MAP_REPORT, maintains
  │                an in-memory NodeDB, writes /var/www/html/nodes.json every 5s
  └─ nginx       ── serves nodes.json + meshmap HTML (mqtt.defcon.run)

consumers:
  ├─ run.gpx  ── internal fetch http://run-mqtt.app-<region>-<site>.local/nodes.json
  └─ meshtk fleet (ghosts) ── https://mqtt.defcon.run/nodes.json for sender pubkeys
```

Key code:
- Proxy packet path: `internal/app/server/proxy.go` (`handleProxy` /
  `handleBackend`), `inspect.go`, `protobuf.go` — already unmarshals each
  `ServiceEnvelope` into an `InspectorPacket` with `Meshtastic.{From,To,PortNum,…}`.
- Node DB + `nodes.json` writer: `internal/app/nodeinfo/{cmd.go,handlers.go}`
  (`NodeInfoCmd.NodeHandler`, `Nodes internal.NodeDB`, 5s `WriteFile` ticker,
  `restorePubKeys` + `PubKeys` retain store added 2026-07-18).
- Node model + prune: `internal/mqtt/node.go` (`Node`, `NodeDB.Prune`,
  `UpdateUser`/`UpdatePosition`).

## Proposed change

The proxy **already parses every packet** it forwards. Give it a `NodeDB` and
reuse the existing `nodeinfo` ingest logic so it maintains node state as a side
effect of proxying, then writes `nodes.json` on the same 5s cadence.

### Work items

1. **Factor the ingest out of `nodeinfo` into a reusable component.**
   Extract `NodeHandler`'s per-portnum update logic (NODEINFO → `UpdateUser` +
   `PubKeys` retain; POSITION → `UpdatePosition`; TELEMETRY; MAP_REPORT) into a
   `NodeObserver` type in `internal/mqtt` (or `internal/observe`) holding
   `Nodes NodeDB`, `PubKeys map[uint32]string`, mutex, and `WriteFile`/`Prune`.
   `nodeinfo` becomes a thin wrapper (keeps working) so nothing breaks during
   migration.

2. **Call the observer from the proxy path.** In `handleProxy`, after
   `ip.inspectRawPacket` unmarshals the packet and the decision is `Allow`,
   feed the decoded packet to `NodeObserver.Ingest(from, to, topic, portNum,
   payload)`. This is decode-only for channel-encrypted NODEINFO/POSITION —
   the proxy has the primary channel key (`meshtk.dc34.yaml`
   `Meshtastic.Channels[0]`) already for its own publishes, so it can decrypt
   the default-channel packets exactly like meshobserv does today.
   - Gotcha: PKI (`e/PKI`) packets stay opaque — only channel packets carry the
     NODEINFO `User` with `public_key`. That's unchanged from meshobserv.

3. **Write `nodes.json` where nginx can serve it.** Proxy and nginx are separate
   containers, so either:
   - (a) mount a shared scratch volume between `run-mqtt-meshtk` and
     `run-mqtt-nginx`, proxy writes `nodes.json` there, nginx serves it; or
   - (b) proxy serves `nodes.json` over its existing admin/HTTP listener and
     nginx reverse-proxies `/nodes.json` to it.
   (a) is closest to today (nginx keeps serving a file); (b) removes a volume
   but adds an nginx upstream. Recommend (a) for a smaller diff.

4. **Delete meshobserv.** Remove the meshobserv process from the nginx image /
   supervisord, drop `MESHTK`/`NODES_JSON_PATH` env wiring that fed it. Keep the
   field schema **byte-identical** (`from`, `fromStr`, `longName`, `shortName`,
   `hwModel`, `role`, `pubkey`, `latitude`, `longitude`, `precision`, `seenBy`,
   `Extended`, …) so `run.gpx` and the ghost pubkey fetch keep working with no
   change. (The `pubkey` field name bit us once — do not rename it.)

5. **Retire the mqtt.defcon.run map webapp.** Once gpx.defcon.run is the sole
   map, drop the meshmap HTML from nginx (or 301 `mqtt.defcon.run` → the gpx
   map). Keep `nodes.json` served (internal + public) until every consumer is
   confirmed on gpx.

### Consumers to keep working (regression surface)

- **run.gpx** internal fetch `http://run-mqtt.app-<region>-<site>.local/nodes.json`
  (service discovery) — unchanged if nginx still serves the file.
- **meshtk fleet (ghosts)** `https://mqtt.defcon.run/nodes.json` sender-pubkey
  fetch (`FetchPublicKeyFromDefcon`, now with in-process cache) — unchanged.
- **Trust boundary:** run.gpx proxies must still never emit `pubkey`/`privkey`/
  mqtt creds (field allowlist). Same as today.

## Why this is attractive

- The proxy sees **100% of traffic already** (it's the ingress), so it's the
  natural place to build node state — no second MQTT subscriber, no duplicate
  decode, no separate container.
- Removes an entire moving part (meshobserv) and eventually a webapp.
- Fixes the class of "two things maintain node state and drift" bugs (the
  pubkey field-name + prune-flap issues were exactly this).

## Risks / open questions

- **Decode cost on the ingress path.** Ingest must be cheap / off the hot path
  (goroutine + channel, or only on `Allow`) so it never slows proxying.
- **Channel keys.** Proxy must have every channel key it needs to decode
  NODEINFO/POSITION (today only the primary `dc.run` channel is configured).
- **Restart persistence.** meshobserv `LoadFile`s the last `nodes.json` on
  boot; the proxy should do the same so node state survives deploys.
- **Two writers during migration.** Run proxy-emit and meshobserv in parallel
  writing to different paths, diff them, then cut over — don't hard-swap.

## Effort estimate

- Extract `NodeObserver` + wire into proxy + shared volume + write/serve: ~1–2 days.
- Delete meshobserv + retire webapp + cutover verification: ~1 day.
- Parallel-run diff + gpx.defcon.run map hardening as sole map: separate slice.

## Interim (shipped 2026-07-18)

Patched meshobserv to **retain learned pubkeys** across prune/recreate
(`NodeInfoCmd.PubKeys` + `restorePubKeys`, meshtk `cbce8c8`) so the sender
pubkey stops flapping out of `nodes.json`. This unblocks the ghost chatbot
replies now; the proxy-emit work above is the durable follow-up.
