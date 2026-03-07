# Feature Research: Meshtk MQTT Integration (v1.3)

**Domain:** Meshtastic MQTT infrastructure -- broker, proxy, live map, fleet simulator
**Researched:** 2026-03-06
**Confidence:** HIGH (porting proven architecture from defcon.run.33 with direct source access)

## Feature Landscape

### Table Stakes (Users Expect These)

Features that must work for the MQTT infrastructure to be useful at DEF CON 34.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Mosquitto broker with password auth + ACL** | Radios connect here; without auth anyone can spam the channel | LOW | Direct port from .33: `mosquitto.conf` with `password_file` + `acl_file`, named users (public, ghosts, meshmap, etc.), per-user topic ACL `readwrite #`. Listens on 1884 internally (meshtk proxies 1883->1884). WebSocket listener on 9001. |
| **Meshtk MQTT proxy (packet inspection + rate limiting)** | Without proxy, malicious packets flood the mesh; meshtk sits in front of mosquitto inspecting every packet | MEDIUM | meshtk `server proxy` mode: listens on 1883, forwards to mosquitto on 1884. Inspects MQTT CONNECT packets (validates usernames against SHA256-seeded passwords), inspects PUBLISH payloads (unmarshals Meshtastic ServiceEnvelope protobuf), applies blocklist from S3 bucket, logs blocks. Supports PROXY protocol from NLB for real client IPs. |
| **S3 blocklist for meshtk** | Bad actors at DEF CON are guaranteed; blocklist must be updateable without redeploy | LOW | S3 bucket `meshtk-blocklist-*` with prefix `meshtk/blocklist/`. meshtk reads on startup + periodic refresh. Already proven at DC33. |
| **Meshmap -- live node visualization** | Organizers and participants need to see the mesh network in real-time | MEDIUM | Two-process nginx container: (1) meshobserv Go binary subscribes to mosquitto, decrypts Meshtastic protobuf packets, maintains in-memory NodeDB, writes `nodes.json` every 60s; (2) nginx serves static HTML+Leaflet map that polls `nodes.json` every 30s. |
| **Node position tracking** | Core purpose of the mesh map -- where are runners? | LOW | meshobserv handles `POSITION_APP` portnum: extracts lat/lon/alt/precision from protobuf, stores per-node. Nodes expire after 86400s (24h). |
| **Node identity display** | Users need to know who is who on the map | LOW | meshobserv handles `NODEINFO_APP` portnum: extracts longName, shortName, hwModel, role, publicKey. Displayed in map popups with formatted details. |
| **Device telemetry display** | Battery level, channel utilization critical for mesh health monitoring | LOW | meshobserv handles `TELEMETRY_APP`: battery%, voltage, chUtil%, airUtilTx%, uptime for device metrics. Also temperature, humidity, pressure, wind, radiation, rainfall for environment metrics. All shown in node popup. |
| **Neighbor info + mesh topology lines** | Understanding mesh topology is essential for debugging coverage | LOW | meshobserv handles `NEIGHBORINFO_APP`: tracks which nodes see each other + SNR. Map draws polylines between neighbors with distance and SNR in tooltip. |
| **MapReport handling** | Nodes publish combined identity+position+config reports | LOW | meshobserv handles `MAP_REPORT_APP`: firmware version, region, modem preset, default channel, online local nodes count. Consolidated node update. |
| **NLB with MQTT port listeners** | ESP32 radios connect via raw TCP/TLS -- cannot go through CloudFront (HTTP-only) | HIGH | 4 listeners: 1883 TCP (plaintext MQTT), 8883 TLS (MQTT over TLS), 443 TLS (meshmap HTTPS), 8443 WSS (WebSocket Secure for browser MQTT clients). NLB in both regions. This is infra work, not app work. |
| **CloudFront for meshmap web traffic** | Meshmap UI needs CDN caching + WAF protection like all other DCR34 apps | MEDIUM | CloudFront distribution for mqtt.defcon.run with `/{region}/meshmap` path routing to nginx container port 443. TLS termination at CloudFront for web, pass-through at NLB for MQTT. |
| **ECR repos + build/deploy pipeline** | 3 container images need CI/CD: mosquitto, meshtk (grpc), nginx/meshobserv | MEDIUM | Follow existing `build.sh`/`deploy.sh` patterns from other apps. 3 ECR repos per region. Deploy scripts already exist in .33 (`deploy.mosquitto.sh`, `deploy.grpc.sh`, `deploy.nginx.sh`). |
| **Both-region deployment** | Multi-region is a platform constraint -- all DCR34 services run in us-east-1 + ca-central-1 | MEDIUM | Same ECS task definition in both regions. Each region gets its own mosquitto+meshtk+meshobserv. Radios connect to nearest region's NLB. No cross-region MQTT bridging (was explored in .33 clustered configs but not deployed). |
| **AES-CTR decryption of Meshtastic packets** | Meshtastic encrypts channel traffic with AES-128/256-CTR; meshobserv must decrypt to read positions | LOW | Already implemented in meshobserv's `mqtt.go`: nonce = packetID(4) + zeros(4) + fromNodeID(4) + zeros(4), then AES-CTR XOR. Channel key configurable via `MQTT_CHANNEL_KEY` env var (base64). |
| **Self-signed TLS between nginx and NLB** | NLB TLS passthrough requires backend TLS even for internal traffic | LOW | Self-signed certs in nginx container (`nginx-selfsigned.crt/key`). NLB terminates nothing -- passes TLS straight through. |

### Differentiators (Competitive Advantage)

Features from .33 that made DCR stand out. Port these for DC34.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Fleet simulator (ghosts)** | Populate the mesh map before/during event with simulated nodes walking GPX routes -- makes the map look alive and tests infrastructure under load | MEDIUM | meshtk `fleet simulate` mode: reads YAML config defining fleets of simulated nodes. Each node has deterministic ID (FNV hash of seed), publishes nodeinfo + position. Supports GPX-based movement (point-to-point zigzag or loop), ramp-up/steady/ramp-down phases, configurable nodes-per-interval, jitter. Runs as 4th container in ECS task (`ghosts` mosquitto user). |
| **Ghost mode easter egg on meshmap** | Konami code or 10x theme toggle reveals ghost nodes in green with ghost icons -- gamification for DEF CON attendees | LOW | Frontend-only: `mobileMode` toggle shows only ghost-named nodes with custom SVG ghost icon markers. Triggers accomplishment API call to `run.defcon.run`. Pure fun, zero infrastructure cost. Update branding from DC33 to DC34. |
| **PKI-encrypted DM replies from fleet bots** | Ghost nodes can receive direct messages and reply with PKI encryption (Curve25519 + AES) -- enables interactive mesh experiences (OTP challenges, chatbot) | HIGH | meshtk fleet handler: on `TEXT_MESSAGE_APP` to a fleet node, validates OTP, unlocks chat mode, replies via `PublishPKIMessage` (ECDH shared secret from node's private key + sender's public key, then AES-CTR encrypt). Fetches sender pubkey from defcon.run API. |
| **OTP challenge-response via mesh** | Attendees send TOTP code to ghost nodes to unlock chat mode -- CTF-style engagement | MEDIUM | meshtk OTP handler: TOTP validation with adjacent-period tolerance, configurable per fleet. Success unlocks `chatmode_unlocked` for 1 hour. Multiple chatbot types: `otp_success`, `otp_failure`, `chatmode_unlocked`, `chatmode_lyrics`. |
| **OpenAI-powered mesh chatbot** | Ghost nodes that respond to DMs with GPT-4o-mini -- "talking to the mesh" | LOW | After OTP unlock, messages forwarded to OpenAI API with configurable system prompt. Responses chunked to 60 chars (Meshtastic message limit) and sent as PKI-encrypted replies. Requires `MESHTK_OPENAI_KEY`. |
| **Lyrics playback via mesh** | Ghost nodes that "sing" back timestamped lyrics in real-time | LOW | Base64-encoded LRC format lyrics in config. On trigger, goroutine schedules PKI replies at lyric timestamps. Self-terminates after song duration. |
| **Mosquitto security inspector plugin** | C plugin that forwards every PUBLISH to meshtk's gRPC inspector for deep packet analysis before delivery | HIGH | Custom mosquitto plugin (`security_inspector.so`): intercepts `MOSQ_EVT_MESSAGE`, serializes to protobuf (`PacketRequest` with topic, payload, username, client_id, ip_address, timestamp), sends to meshtk inspector via TCP socket, receives `PacketResponse` with shouldBlock + blockReason. Currently compiled but **disabled** in .33 config (commented out `plugin` line) -- meshtk proxy mode handles inspection instead. |
| **Color-coded node markers by identity** | DCR infrastructure nodes shown in distinct colors; regular nodes in red | LOW | Frontend `getMarkerColorFromNodeName()`: purple for east, darkblue for bigstar, orange for infrastructure. Update patterns for DC34 naming convention. |
| **Node search on meshmap** | Leaflet search control to find nodes by name or ID | LOW | `leaflet-search` plugin searches marker `searchString` property (`longName (shortName) !hexId`). Flies to node and opens popup. |
| **Marker clustering** | Prevents map from becoming unusable with hundreds of nodes | LOW | `leaflet.markercluster` with `disableClusteringAtZoom: 10`. Already working in .33. |
| **Node opacity based on last-seen age** | Stale nodes fade out visually -- instant visual health indicator | LOW | `opacity = 1.0 - (now - lastSeen) / 129600`. 36-hour fade. |
| **Dark mode on meshmap** | DEF CON happens in dark rooms and at night | LOW | CSS `filter: invert(1) hue-rotate(180deg)` toggle with localStorage persistence. |
| **Per-user MQTT credentials from flash.defcon.run** | Each flashed device gets unique MQTT username/password derived from OIDC identity | LOW | Already built in v1.0: `run.human` internal API resolves OIDC sub to adapter userId, generates deterministic MQTT password via `SHA256(mqttuser + creationSeed).slice(0, 12)`. meshtk proxy validates these on CONNECT. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Cross-region MQTT bridging** | "All nodes everywhere should see each other" | Mosquitto bridge adds latency, message duplication, split-brain risk. DC33 explored it (`clustered/mosquitto.cac1.conf`) but did not deploy. At DEF CON, all participants are in Las Vegas -- one region handles 99% of traffic. | Keep regions independent. Primary region (us-east-1) handles event traffic. Secondary (ca-central-1) is failover. |
| **WebSocket MQTT in the meshmap browser** | "Show real-time node updates without polling" | Adds complexity (WSS auth, connection management, reconnection logic) for marginal improvement over 30s JSON polling. meshobserv already aggregates and deduplicates. More attack surface at DEF CON. | Keep 30s `nodes.json` polling. Simple, cacheable, debuggable. |
| **Persistent message history** | "Show chat history on the map" | Storage growth, privacy concerns, moderation burden at a hacker convention. Meshtastic messages are ephemeral by design. | Meshobserv only tracks node state (position, telemetry, identity), not message content. |
| **Public MQTT access without auth** | "Let anyone connect" | DEF CON audience will absolutely abuse an unauthenticated MQTT broker. Spam, flooding, malicious packets guaranteed. | Per-user credentials from flash.defcon.run. Named service accounts (ghosts, meshmap) with known passwords. `public` user exists but should be ACL-restricted. |
| **Custom Meshtastic firmware** | "Add DCR-specific features to the firmware" | Maintenance burden, update complexity, bricking risk. Stock firmware with config-only customization is the proven approach. | Stock Meshtastic firmware + MQTT config pushed via flash.defcon.run. |
| **Mosquitto dynamic security plugin** | "Use mosquitto's built-in dynamic auth instead of flat files" | Over-engineered for this use case. Flat passwd+ACL files are simple, auditable, and work. Dynamic security adds REST API surface area that's attackable at DEF CON. | Flat `mosquitto.passwd` (SHA512-PBKDF2 hashed) + `mosquitto.acl`. Rebuild container to update. |
| **Running meshobserv as separate ECS service** | "Decouple meshobserv from nginx for independent scaling" | meshobserv MUST write `nodes.json` to the same filesystem nginx serves. Shared EFS adds complexity and latency. supervisord in one container is proven simple. | Single nginx container with supervisord running both nginx and meshobserv. Proven pattern from .33. |

## Feature Dependencies

```
[Mosquitto Broker]
    ^
    |-- requires -->  [NLB with MQTT listeners]
    |                     (radios need network path to broker)
    |
    |<-- proxied by -- [Meshtk Proxy]
    |                     (sits in front, inspects packets)
    |                     |
    |                     |-- requires --> [S3 Blocklist]
    |                     |                  (runtime-updateable block rules)
    |                     |
    |                     |-- uses --> [Per-user MQTT creds from flash.defcon.run]
    |                                    (validates CONNECT credentials)
    |
    |<-- subscribes -- [Meshobserv/Nginx]
    |                     (reads all topics, builds NodeDB, writes nodes.json)
    |                     |
    |                     |-- requires --> [CloudFront distribution]
    |                     |                  (serves meshmap web UI)
    |                     |
    |                     |-- requires --> [AES channel key]
    |                                       (decrypts Meshtastic packets)
    |
    |<-- publishes -- [Fleet Simulator (ghosts)]
                         (publishes fake node positions via MQTT)
                         |
                         |-- enhances --> [Meshobserv/Nginx]
                         |                  (populates map with simulated nodes)
                         |
                         |-- uses --> [GPX routes from CMS/gpx.defcon.run]
                                        (movement paths for simulated nodes)

[ECR repos + build/deploy]
    └── required by all 3 containers
```

### Dependency Notes

- **Meshtk Proxy requires Mosquitto Broker:** Proxy forwards validated traffic to mosquitto on port 1884. Mosquitto must be healthy first (docker-compose uses `service_healthy` with nc check).
- **Meshobserv requires Mosquitto Broker:** Subscribes to `msh/#` topics on the local broker to build the node database. Configurable via `MQTT_BROKER` env var.
- **Fleet Simulator requires Mosquitto Broker:** Publishes simulated node data as the `ghosts` user. Non-essential -- map works without it, just looks empty.
- **Meshobserv requires AES channel key:** Without the correct `MQTT_CHANNEL_KEY`, encrypted packets can't be decrypted and positions won't appear on the map.
- **NLB is infrastructure prerequisite:** All MQTT traffic (from radios, meshobserv, ghosts) flows through NLB. Must be provisioned before any container deployment makes sense.
- **Fleet Simulator enhances Meshmap:** Ghost nodes appear on the map alongside real nodes. The easter egg (ghost mode) filters to show only ghost nodes.

## MVP Definition

### Launch With (v1.3.0)

Minimum to have a working MQTT infrastructure accepting radio connections and displaying a live map.

- [ ] Mosquitto container with auth + ACL (port from .33 `mosquitto/site-tld/`)
- [ ] Meshtk proxy container in `server proxy` mode (port from .33 `grpc/site-tld/`)
- [ ] Nginx/meshobserv container with static meshmap HTML (port from .33 `nginx/`)
- [ ] NLB with 1883/8883/443/8443 listeners in both regions
- [ ] CloudFront distribution for mqtt.defcon.run with meshmap path routing
- [ ] ECR repos for 3 images + build/deploy scripts
- [ ] 4-container ECS task definition (mosquitto, meshtk, nginx, ghosts)
- [ ] S3 blocklist bucket + meshtk configuration
- [ ] SSM parameters for secrets (channel PSK, MQTT passwords, OpenAI key)
- [ ] ACM certs for mqtt.defcon.run

### Add After Validation (v1.3.x)

Features to add once the core infrastructure is verified working.

- [ ] DC34 branding on meshmap (logo, colors, node naming patterns)
- [ ] Ghost mode easter egg updated for DC34
- [ ] Fleet simulator YAML config tuned for DC34 routes (requires GPX routes from cms.defcon.run)
- [ ] OTP challenge-response integration with run.defcon.run accomplishments API
- [ ] OpenAI chatbot with DC34-specific system prompt
- [ ] Lyrics playback content for DC34

### Future Consideration (v2+)

Features to defer until the MQTT platform is stable and event-tested.

- [ ] Mosquitto security inspector plugin (currently disabled in .33 -- meshtk proxy handles inspection adequately)
- [ ] Cross-region MQTT bridging (only if multi-venue events)
- [ ] Historical node data persistence (S3 archival of NodeDB snapshots)
- [ ] Integration with run.defcon.run dashboard (show mesh status on participant profile)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Mosquitto broker + auth | HIGH | LOW | P1 |
| Meshtk proxy (inspection) | HIGH | MEDIUM | P1 |
| NLB with MQTT listeners | HIGH | HIGH | P1 |
| Meshobserv + meshmap | HIGH | MEDIUM | P1 |
| ECR + build/deploy | HIGH | MEDIUM | P1 |
| CloudFront for meshmap | MEDIUM | MEDIUM | P1 |
| Both-region deployment | MEDIUM | MEDIUM | P1 |
| S3 blocklist | MEDIUM | LOW | P1 |
| Fleet simulator (ghosts) | MEDIUM | LOW | P2 |
| DC34 meshmap branding | MEDIUM | LOW | P2 |
| Ghost mode easter egg | LOW | LOW | P2 |
| PKI DM replies | LOW | HIGH | P3 |
| OTP challenge | LOW | MEDIUM | P3 |
| OpenAI chatbot | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for launch -- infrastructure and core visualization
- P2: Should have -- enhances the event experience, low incremental cost
- P3: Nice to have -- engagement features, can be enabled via config without code changes

## Existing Platform Dependencies

These features in the existing DCR34 platform are consumed by v1.3:

| Existing Feature | How v1.3 Uses It | Status |
|-----------------|------------------|--------|
| flash.defcon.run MQTT cred generation | Per-user credentials validated by meshtk proxy on CONNECT | Built (v1.0) |
| run.human internal API (OIDC sub -> userId) | meshtk fetches sender public keys for PKI replies | Built (v1.0) |
| gpx.defcon.run GPX routes | Fleet simulator uses GPX files for simulated node movement paths | Built (v1.0) |
| CMS Events/Routes/POIs | Meshmap could link to event details (future) | Built (v1.1) |
| run.defcon.run accomplishments API | Ghost mode easter egg triggers accomplishment on discovery | Built (v1.2, needs accomplishment endpoint) |
| ECS Fargate multi-region infrastructure | Same cluster, same deployment patterns, same monitoring | Built (v1.0) |
| CloudFront + WAF | Meshmap web traffic protection | Built (v1.0) |

## Competitor Feature Analysis

This is not a competitive product -- it's event infrastructure. The relevant comparison is against the public Meshtastic MQTT ecosystem.

| Feature | meshmap.net (public) | Our Approach (DCR34) |
|---------|---------------------|---------------------|
| Node visualization | Global map of all public nodes, no auth | Private map of DCR34 event nodes only |
| Broker auth | Default `meshdev`/`large4cats` credentials | Per-user credentials from flash.defcon.run |
| Packet inspection | None -- public broker accepts everything | meshtk proxy inspects every packet, S3 blocklist |
| Simulated nodes | None | Fleet simulator with GPX-based movement |
| Interactive bots | None | OTP challenges, PKI chatbot, lyrics playback |
| Node identity | Generic red markers | Color-coded by DCR role (infrastructure vs participant) |
| Branding | meshmap.net generic | DCR34 branded with event logo and easter eggs |

Note: meshobserv code is forked from [meshmap.net](https://github.com/brianshea2/meshmap.net) with DCR-specific modifications (ghost filtering, color coding, branding, event-specific topics).

## Sources

- defcon.run.33 source code: `/Users/khundeck/working/defcon.run.33/apps/mqtt/` (HIGH confidence -- direct source access)
- meshmap.net source: `github.com/brianshea2/meshmap.net` (HIGH confidence -- forked into .33)
- Meshtastic MQTT docs: training data knowledge of `msh/` topic structure and protobuf format (MEDIUM confidence)
- meshtk source: `/Users/khundeck/working/defcon.run.33/apps/mqtt/grpc/site-tld/meshtk/` (HIGH confidence -- direct source access)

---
*Feature research for: Meshtk MQTT Integration (v1.3)*
*Researched: 2026-03-06*
