# Tasks: Add MQTT Mesh Network Service

## Phase 1: meshtk Upstream Hooks

### 1.1 Hook System Core
- [ ] 1.1.1 Add `HooksConfig` struct to `pkg/config/config.go` (NodeDB, SQS, HTTP, Webhook)
- [ ] 1.1.2 Add default hook config to embedded `meshtk.yaml` (all disabled except NodeDB)
- [ ] 1.1.3 Create `Hook` interface and `HookDispatcher` in `internal/app/server/hooks.go`
- [ ] 1.1.4 Create `HookFilter` with PortNum and Decision matching
- [ ] 1.1.5 Wire dispatcher into `proxy.go` after inspection (single-line integration)
- [ ] 1.1.6 Initialize dispatcher in `NewServer()` from config
- [ ] **Verify:** `go build` succeeds, existing proxy behavior unchanged with hooks disabled

### 1.2 NodeDB Hook
- [ ] 1.2.1 Create `internal/app/server/hook_nodedb.go` with in-memory node map
- [ ] 1.2.2 Implement `Send()` to update node positions from POSITION_APP and MAP_REPORT_APP packets
- [ ] 1.2.3 Implement TTL-based pruning goroutine (configurable interval)
- [ ] 1.2.4 Implement optional file persistence (write JSON on interval if PersistPath set)
- [ ] 1.2.5 Add `GetAll()`, `Get(id)`, `ToGeoJSON()` methods for HTTP hook consumption
- [ ] **Verify:** Run proxy with `NodeDB.Enabled: true`, see nodes accumulate in memory

### 1.3 SQS Hook
- [ ] 1.3.1 Create `internal/app/server/hook_sqs.go`
- [ ] 1.3.2 Implement AWS session creation (reuse S3Mover credential chain pattern for ECS compatibility)
- [ ] 1.3.3 Implement buffered Go channel with configurable size
- [ ] 1.3.4 Implement batch publisher goroutine (SendMessageBatch, flush on size or interval)
- [ ] 1.3.5 Implement `toSQSMessage()` converting InspectorPacket to JSON
- [ ] 1.3.6 Implement filter matching (PortNums, Decisions)
- [ ] 1.3.7 Handle buffer-full gracefully (drop + log metric, never block proxy)
- [ ] **Verify:** Run with SQS enabled pointing at a dev queue, confirm messages arrive

### 1.4 HTTP Hook
- [ ] 1.4.1 Create `internal/app/server/hook_http.go`
- [ ] 1.4.2 Implement `/api/nodes` endpoint returning NodeDB as GeoJSON FeatureCollection
- [ ] 1.4.3 Implement `/api/nodes/:id` endpoint for single node detail
- [ ] 1.4.4 Implement `/api/stats` endpoint (connection count, packet rates, node count)
- [ ] 1.4.5 Implement `/api/health` endpoint (200 OK, version info)
- [ ] 1.4.6 Add CORS configuration support
- [ ] 1.4.7 Start HTTP server on `ListenAddress` in background goroutine
- [ ] **Verify:** `curl localhost:8080/api/nodes` returns GeoJSON with live node positions

### 1.5 Webhook Hook
- [ ] 1.5.1 Create `internal/app/server/hook_webhook.go`
- [ ] 1.5.2 Implement batch HTTP POST with configurable headers
- [ ] 1.5.3 Implement filter matching and flush logic (same pattern as SQS)
- [ ] 1.5.4 Handle HTTP errors gracefully (log, retry with backoff, drop after N failures)
- [ ] **Verify:** Point at a local HTTP server, confirm batched POSTs arrive

### 1.6 dc34 Configuration
- [ ] 1.6.1 Create `meshtk.defcon.yaml` enabling SQS + HTTP hooks for dc34
- [ ] 1.6.2 Validate env var override works (`MESHTK_SERVER_HOOKS_SQS_QUEUEURL`)
- [ ] 1.6.3 Test with local mosquitto + meshtk proxy + dev SQS queue

## Phase 2: Infrastructure — run.mqtt Service

### 2.1 Application Files
- [ ] 2.1.1 Create `apps/run.mqtt/` directory structure
- [ ] 2.1.2 Copy meshtk source from `/Users/khundeck/working/meshtk/` into `apps/run.mqtt/meshtk/`
- [ ] 2.1.3 Strip `.git/` and protobuf submodule (keep generated code)
- [ ] 2.1.4 Port mosquitto config from dc33 (`mosquitto.conf`, `mosquitto.acl`, `mosquitto.passwd`)
- [ ] 2.1.5 Create templated bridge configs per region (`mosquitto.{region}.conf`)
- [ ] 2.1.6 Port nginx config from dc33 (`nginx.conf` with `/hello` health check)
- [ ] 2.1.7 Create `meshtk.defcon.yaml` for dc34 deployment (hooks enabled, event channels)

### 2.2 Docker Images
- [ ] 2.2.1 Create `Dockerfile.mosquitto` (build from source with custom plugins, port from dc33)
- [ ] 2.2.2 Create `Dockerfile.proxy` (Go multi-stage build for meshtk binary)
- [ ] 2.2.3 Create `Dockerfile.nginx` (nginx + optional supervisord + meshobserv if needed)
- [ ] 2.2.4 Create `VERSION.mosquitto`, `VERSION.proxy`, `VERSION.nginx` files
- [ ] 2.2.5 Create `docker-compose.yaml` for local development
- [ ] 2.2.6 Test local docker-compose stack (mosquitto + proxy + nginx)
- [ ] **Verify:** Connect MQTT client to localhost:1883, publish message, see proxy inspection logs

### 2.3 Build/Deploy Integration
- [ ] 2.3.1 Update `apps/build.sh` to support `run.mqtt` (mosquitto, proxy, nginx components)
- [ ] 2.3.2 Update `apps/deploy.sh` to support `run.mqtt`
- [ ] 2.3.3 Update `apps/release-all.sh` to include `run.mqtt`
- [ ] **Verify:** `./build.sh mosquitto run.mqtt` builds and pushes to ECR

### 2.4 Terraform Service Config
- [ ] 2.4.1 Create `infra/terraform/live/site/services/run.mqtt/service.hcl`
- [ ] 2.4.2 Define ECR repositories (run-mqtt-mosquitto, run-mqtt-proxy, run-mqtt-nginx)
- [ ] 2.4.3 Define ECS task (4 containers with dependency chain)
- [ ] 2.4.4 Define ECS service with NLB load balancers (4 listeners)
- [ ] 2.4.5 Define service discovery registration (run-mqtt)
- [ ] 2.4.6 Create `VERSION.mosquitto`, `VERSION.proxy`, `VERSION.nginx` in services dir
- [ ] 2.4.7 Add run-mqtt to `site.hcl` ecs_tasks and ecs_services arrays
- [ ] **Verify:** `terragrunt plan` shows expected resources without errors

### 2.5 NLB & Networking
- [ ] 2.5.1 Add mqtt-specific security group rules to network module (ports 1883, 8883, 8443)
- [ ] 2.5.2 Create ACM certificate for `mqtt.defcon.run` + `*.mqtt.defcon.run`
- [ ] 2.5.3 Add Route 53 alias records (`mqtt.defcon.run` → NLB, `{region}.mqtt.defcon.run` → NLB)
- [ ] 2.5.4 Verify NLB listener creation via ecs-service module with `type = "nlb"`
- [ ] **Verify:** `dig mqtt.defcon.run` resolves to NLB, MQTT client connects on :8883

### 2.6 SQS Infrastructure
- [ ] 2.6.1 Create SQS queue resource in service.hcl or dedicated module
- [ ] 2.6.2 Add IAM policy for ECS task role (sqs:SendMessage, sqs:SendMessageBatch)
- [ ] 2.6.3 Export queue URL to meshtk container as environment variable
- [ ] 2.6.4 Create dead-letter queue for failed messages
- [ ] **Verify:** meshtk proxy publishes to SQS, messages visible in AWS console

### 2.7 SSM Parameters
- [ ] 2.7.1 Create SSM parameters for MQTT secrets (channel keys, broker credentials)
- [ ] 2.7.2 Create SSM parameters for SQS queue URL and region
- [ ] 2.7.3 Create SSM parameters for S3 logging bucket
- [ ] 2.7.4 Reference SSM parameters in service.hcl container secrets

## Phase 3: gpx.studio Mesh Overlay

### 3.1 Next.js API Proxy
- [ ] 3.1.1 Create `apps/run.gpx/webapp/src/app/api/mesh/nodes/route.ts`
- [ ] 3.1.2 Implement GET handler proxying to meshtk HTTP hook via service discovery
- [ ] 3.1.3 Add caching headers (5s max-age for polling efficiency)
- [ ] 3.1.4 Handle service discovery failures gracefully (return empty FeatureCollection)
- [ ] **Verify:** `curl /api/mesh/nodes` returns GeoJSON from meshtk

### 3.2 gpx-studio Patch
- [ ] 3.2.1 Create `patches/007-mesh-integration.patch`
- [ ] 3.2.2 Add `src/lib/types/mesh.ts` (MeshNode interface)
- [ ] 3.2.3 Add `src/lib/stores/mesh-nodes.ts` (Svelte store with polling)
- [ ] 3.2.4 Add `src/lib/components/map/mesh-layer/mesh-layer.ts` (Mapbox source + layers)
- [ ] 3.2.5 Add `src/lib/components/map/mesh-layer/MeshLayer.svelte` (lifecycle)
- [ ] 3.2.6 Add `src/lib/components/map/mesh-layer/MeshNodePopup.svelte` (click popup)
- [ ] 3.2.7 Integrate MeshLayer into Map.svelte
- [ ] 3.2.8 Add mesh toggle control in layer panel
- [ ] 3.2.9 Update `build-frontend.sh` to apply patch 007
- [ ] **Verify:** Build gpx-studio, navigate to map, see mesh node markers with popup on click

### 3.3 Node Visualization
- [ ] 3.3.1 Design node marker icons (by hardware model or role)
- [ ] 3.3.2 Implement color coding (battery level: green/yellow/red)
- [ ] 3.3.3 Implement opacity fade for stale nodes (>TTL threshold)
- [ ] 3.3.4 Implement node count badge in UI
- [ ] **Verify:** Nodes render with correct icons, colors fade when stale

## Phase 4: Mesh Provisioning UI

### 4.1 Mesh Identity Backend
- [ ] 4.1.1 Create ElectroDB entity `MeshIdentity` in run.human
- [ ] 4.1.2 Fields: userId, nodePrefix, mqttUsername, mqttPassword, provisionedAt, radioHwModel
- [ ] 4.1.3 Create DynamoDB table `run-mesh-identity` in service.hcl
- [ ] 4.1.4 Create `/api/mesh/credentials` route (generate or return existing identity)
- [ ] 4.1.5 Implement MQTT credential generation (random password, store hashed)
- [ ] **Verify:** Login, hit /api/mesh/credentials, get unique MQTT identity

### 4.2 Channel URL / QR Generation
- [ ] 4.2.1 Install `@meshtastic/protobufs` in run.human webapp
- [ ] 4.2.2 Create `/api/mesh/channel-url` route
- [ ] 4.2.3 Implement ChannelSet protobuf encoding (event channels + LoRa config)
- [ ] 4.2.4 Generate base64url-encoded URL fragment
- [ ] 4.2.5 Add QR code rendering on frontend (e.g., `qrcode` npm package)
- [ ] **Verify:** Generated URL opens in Meshtastic app and imports correct channels

### 4.3 Config YAML Download
- [ ] 4.3.1 Create `/api/mesh/config` route
- [ ] 4.3.2 Generate YAML matching `meshtastic --configure` format
- [ ] 4.3.3 Include per-user MQTT credentials, event channels, LoRa settings
- [ ] 4.3.4 Serve as file download (`Content-Disposition: attachment`)
- [ ] **Verify:** Download YAML, run `meshtastic --configure downloaded.yaml`, radio configured

### 4.4 Web Serial Configurator
- [ ] 4.4.1 Install `@meshtastic/core` and `@meshtastic/transport-web-serial` in run.human
- [ ] 4.4.2 Create `/mesh/configure` page with connect button
- [ ] 4.4.3 Implement Web Serial connection flow (request port, connect, verify device)
- [ ] 4.4.4 Implement configuration writer (channels, LoRa, MQTT, device name)
- [ ] 4.4.5 Show progress UI during configuration write
- [ ] 4.4.6 Show success/failure result with next steps
- [ ] 4.4.7 Handle Chrome/Edge-only gracefully (show alternative methods for other browsers)
- [ ] **Verify:** Connect radio via USB, click configure, radio joins event mesh network

### 4.5 Firmware Downloads
- [ ] 4.5.1 Create `/mesh/firmware` page with hardware model selector
- [ ] 4.5.2 Build pre-configured firmware images using `userPrefs.jsonc` (CI or manual)
- [ ] 4.5.3 Upload firmware images to S3 bucket
- [ ] 4.5.4 Create `/api/mesh/firmware` route serving pre-signed S3 download URLs
- [ ] 4.5.5 Include flashing instructions (link to official web flasher)
- [ ] **Verify:** Download firmware, flash via web flasher, radio auto-joins event network

### 4.6 Dashboard Page
- [ ] 4.6.1 Create `/mesh` page showing user's mesh identity
- [ ] 4.6.2 Show provisioning status (configured/not configured)
- [ ] 4.6.3 Show available provisioning methods with links
- [ ] 4.6.4 Show event network info (channel names, frequency, node count)
- [ ] 4.6.5 Link to mesh map (gpx.studio with mesh overlay)

## Phase 5: ConfigUI Network Panel

### 5.1 Config Structure
- [ ] 5.1.1 Add `MQTTConfig` struct to `config.go`
- [ ] 5.1.2 Add to `SiteConfig` struct
- [ ] 5.1.3 Add form parsing in `handleSave()`

### 5.2 Templates
- [ ] 5.2.1 Create `templates/partials/network.html` panel (Infrastructure Modules section)
- [ ] 5.2.2 Add MQTT enable/disable toggle
- [ ] 5.2.3 Add broker configuration fields (domain, channels, topic prefix)
- [ ] 5.2.4 Add fleet toggle and configuration
- [ ] 5.2.5 Add bridge toggle and region selection
- [ ] 5.2.6 Add to `templates/form.html` in Infrastructure Modules section
- [ ] **Verify:** ConfigUI shows Network panel, toggle generates correct HCL

### 5.3 Status API
- [ ] 5.3.1 Create `mqtt.go` handler file (similar to `waftest.go`)
- [ ] 5.3.2 Add `GET /api/mqtt/status` endpoint (proxies to meshtk /api/stats)
- [ ] 5.3.3 Display live stats in Status tab (connection count, packet rates, node count)
- [ ] 5.3.4 Register routes in `main.go`

## Phase 6: Testing & Documentation

### 6.1 meshtk Upstream Tests
- [ ] 6.1.1 Unit tests for HookDispatcher and HookFilter
- [ ] 6.1.2 Unit tests for NodeDB (add, prune, GeoJSON conversion)
- [ ] 6.1.3 Unit tests for SQS message formatting
- [ ] 6.1.4 Integration test: proxy with all hooks enabled against local mosquitto

### 6.2 Infrastructure Tests
- [ ] 6.2.1 Verify `terragrunt plan` for run-mqtt service in all regions
- [ ] 6.2.2 Test NLB listener creation and target group health
- [ ] 6.2.3 Test cross-region mosquitto bridge connectivity
- [ ] 6.2.4 Test SQS message flow from meshtk to queue

### 6.3 Integration Tests
- [ ] 6.3.1 End-to-end: MQTT client → NLB → meshtk → mosquitto → SQS
- [ ] 6.3.2 End-to-end: meshtk HTTP → run.gpx proxy → gpx.studio map render
- [ ] 6.3.3 Provisioning: login → generate creds → Web Serial configure → radio joins mesh
- [ ] 6.3.4 ConfigUI: toggle MQTT → verify service.hcl generation

## Dependencies

```
Phase 1 (meshtk hooks) ──→ Phase 2 (infrastructure) ──→ Phase 3 (gpx overlay)
                                      │                         │
                                      ├──→ Phase 5 (ConfigUI)   │
                                      │                         │
                                      └──→ Phase 4 (provisioning, can start in parallel)
                                                                │
Phase 6 (testing) depends on Phases 1-5 ◄───────────────────────┘
```

Phases 4 and 5 can proceed in parallel once Phase 2 infrastructure is deployed. Phase 3 requires Phase 1 (HTTP hook) and Phase 2 (service discovery). Phase 1 can be developed entirely upstream before any dc34 infrastructure work begins.
