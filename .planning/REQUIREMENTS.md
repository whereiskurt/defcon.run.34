# Requirements: DEF CON Run 34

**Defined:** 2026-03-06
**Core Value:** Participants and organizers have a seamless digital experience for DCR34 — from device setup to event discovery to route navigation — all through the browser.

## v1.3 Requirements

Requirements for Meshtk Integration milestone. Each maps to roadmap phases.

### Infrastructure

- [x] **INFRA-01**: NLB enabled in both regions (us-east-1 + ca-central-1) with access logging to S3
- [x] **INFRA-02**: NLB listeners configured for 4 ports — 1883 (TCP/MQTT), 8883 (TLS/MQTT), 443 (TLS/meshmap HTTPS), 8443 (TLS/WebSocket MQTT)
- [x] **INFRA-03**: ACM certificates for mqtt.defcon.run verified in both regions for NLB TLS termination
- [x] **INFRA-04**: Route53 latency-based alias records for mqtt.defcon.run pointing to regional NLBs
- [x] **INFRA-05**: ECR repositories created for 3 container images (mqtt-mosquitto, mqtt-nginx, mqtt-meshtk) in both regions
- [ ] **INFRA-06**: S3 blocklist bucket for meshtk runtime-updateable block rules
- [x] **INFRA-07**: SSM parameters replicated from DC33 pattern — channel PSK, user creation seed, MQTT passwords, S3 bucket names, meshobserv MQTT credentials
- [x] **INFRA-08**: Security group for MQTT service allowing NLB traffic on ports 1883/8883/443/8443/9001
- [x] **INFRA-09**: ecs-service module patched to make Proxy Protocol v2 configurable (not auto-enabled for all NLB TCP targets)
- [ ] **INFRA-10**: S3 logging bucket for meshtk packet inspection log rotation

### Containers

- [ ] **CONT-01**: Mosquitto container with password auth, ACL, persistence, health check on port 1884
- [ ] **CONT-02**: Meshtk proxy container in `server proxy` mode — inspects packets, rate limits, logs to S3, validates per-user credentials
- [ ] **CONT-03**: Nginx/meshobserv container — meshobserv subscribes to MQTT and writes nodes.json, nginx serves meshmap static HTML on port 443
- [ ] **CONT-04**: Ghosts container running meshtk `fleet simulate` mode (non-essential, can fail without stopping service)
- [ ] **CONT-05**: 4-container ECS task definition with correct port allocation, health checks, and dependency ordering (mosquitto first)
- [ ] **CONT-06**: meshtk checked out as gitignored directory at apps/mqtt/grpc/site-tld/meshtk/ from ~/working/meshtk
- [ ] **CONT-07**: mqtt service.hcl with 4-container task, 4 NLB load_balancer entries, both-region deployment
- [ ] **CONT-08**: Build scripts adapted for mqtt — build.sh support for mosquitto, nginx, grpc components
- [ ] **CONT-09**: Deploy scripts adapted for mqtt — deploy.sh with VERSION files, release-all.sh integration

### Meshmap

- [ ] **MESH-01**: Live node position display on Leaflet map from meshobserv nodes.json polling
- [ ] **MESH-02**: Node identity display (longName, shortName, hwModel, role) in map popups
- [ ] **MESH-03**: Device telemetry display (battery, voltage, channel utilization, air time) in map popups
- [ ] **MESH-04**: Neighbor topology lines with SNR and distance in tooltips
- [ ] **MESH-05**: AES-CTR decryption of Meshtastic channel traffic in meshobserv
- [ ] **MESH-06**: Node search via leaflet-search plugin (by name or hex ID)
- [ ] **MESH-07**: Marker clustering with leaflet.markercluster (disable at zoom 10)
- [ ] **MESH-08**: Meshmap ported as-is from DC33 with minor label updates (event name, year)
- [ ] **MESH-09**: Color-coded node markers by identity/role retained from DC33
- [ ] **MESH-10**: Dark mode toggle with localStorage persistence retained from DC33
- [ ] **MESH-11**: Node opacity based on last-seen age (36-hour fade) retained from DC33

### Fleet & Engagement

- [ ] **FLEET-01**: Fleet simulator publishes simulated node positions via MQTT using GPX-based movement paths
- [ ] **FLEET-02**: Fleet simulation lifecycle — ramp-up, steady-state, ramp-down phases with configurable timing
- [ ] **FLEET-03**: Ghost mode easter egg on meshmap — Konami code or theme toggle reveals ghost nodes with custom icons
- [ ] **FLEET-04**: Ghost mode triggers accomplishment API call to run.defcon.run on discovery

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Engagement

- **ENG-01**: PKI-encrypted DM replies from fleet bots (Curve25519 + AES)
- **ENG-02**: OTP challenge-response via mesh for unlocking chat mode
- **ENG-03**: OpenAI-powered mesh chatbot with DC34 system prompt
- **ENG-04**: Lyrics playback via mesh (timestamped LRC responses)

### Advanced Infrastructure

- **ADV-01**: Mosquitto security inspector C plugin for deep packet analysis
- **ADV-02**: Cross-region MQTT bridging between us-east-1 and ca-central-1
- **ADV-03**: Historical node data persistence (S3 archival of NodeDB snapshots)
- **ADV-04**: Integration with run.defcon.run dashboard (mesh status on participant profile)

## Out of Scope

| Feature | Reason |
|---------|--------|
| CloudFront for mqtt.defcon.run | MQTT is raw TCP — CloudFront only handles HTTP/HTTPS. NLB serves everything. |
| WebSocket MQTT in meshmap browser | Adds complexity for marginal gain over 30s JSON polling. More attack surface. |
| Persistent message history | Storage growth, privacy concerns, moderation burden at DEF CON. Messages are ephemeral. |
| Public MQTT without auth | DEF CON audience will abuse unauthenticated broker. Per-user creds required. |
| Custom Meshtastic firmware | Stock firmware + config-only customization is proven approach. |
| Mosquitto dynamic security plugin | Over-engineered for flat passwd+ACL. Adds REST API attack surface. |
| meshobserv as separate ECS service | Must write nodes.json to same filesystem as nginx. supervisord in one container is simpler. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 14 | Complete |
| INFRA-02 | Phase 14 | Complete |
| INFRA-03 | Phase 14 | Complete |
| INFRA-04 | Phase 14 | Complete |
| INFRA-05 | Phase 14 | Complete |
| INFRA-06 | Phase 14 | Pending |
| INFRA-07 | Phase 14 | Complete |
| INFRA-08 | Phase 14 | Complete |
| INFRA-09 | Phase 14 | Complete |
| INFRA-10 | Phase 14 | Pending |
| CONT-01 | Phase 15 | Pending |
| CONT-02 | Phase 15 | Pending |
| CONT-03 | Phase 15 | Pending |
| CONT-04 | Phase 15 | Pending |
| CONT-05 | Phase 15 | Pending |
| CONT-06 | Phase 15 | Pending |
| CONT-07 | Phase 15 | Pending |
| CONT-08 | Phase 16 | Pending |
| CONT-09 | Phase 16 | Pending |
| MESH-01 | Phase 17 | Pending |
| MESH-02 | Phase 17 | Pending |
| MESH-03 | Phase 17 | Pending |
| MESH-04 | Phase 17 | Pending |
| MESH-05 | Phase 17 | Pending |
| MESH-06 | Phase 17 | Pending |
| MESH-07 | Phase 17 | Pending |
| MESH-08 | Phase 17 | Pending |
| MESH-09 | Phase 17 | Pending |
| MESH-10 | Phase 17 | Pending |
| MESH-11 | Phase 17 | Pending |
| FLEET-01 | Phase 18 | Pending |
| FLEET-02 | Phase 18 | Pending |
| FLEET-03 | Phase 18 | Pending |
| FLEET-04 | Phase 18 | Pending |

**Coverage:**
- v1.3 requirements: 34 total
- Mapped to phases: 34
- Unmapped: 0

---
*Requirements defined: 2026-03-06*
*Last updated: 2026-03-06 after roadmap creation*
