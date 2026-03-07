# Phase 15: Container Images + Task Definition - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Build 4 container images (mosquitto, meshtk, nginx/meshobserv, ghosts) and define the ECS task with correct networking, health checks, and dependency ordering. All images must build successfully and run as a single ECS task. WebSocket MQTT is unscoped — all external traffic goes through meshtk TCP proxy.

</domain>

<decisions>
## Implementation Decisions

### Mosquitto Container
- Alpine base with mosquitto installed (not official eclipse-mosquitto image)
- Single listener on port 1884 (internal MQTT only, 0.0.0.0 binding)
- No WebSocket listener (dropped — all traffic through meshtk proxy)
- No persistence (ephemeral messages per REQUIREMENTS.md)
- `allow_anonymous false` globally
- 3 service accounts from SSM: meshtk-proxy, meshobserv, ghosts — all get `readwrite #` ACL
- Entrypoint script generates both passwd file and mosquitto.conf from SSM params at startup
- TCP health check on port 1884
- Stdout logging (CloudWatch via ECS awslogs driver)
- 1KB message_size_limit (Meshtastic packets are <256 bytes)
- Default max_keepalive (65535s)
- max_connections configurable via SSM parameter
- ECS handles dependency ordering (mosquitto starts first), no entrypoint waits

### Meshtk Proxy Container
- Multi-stage Go build: builder stage uses Go version from meshtk's go.mod, runtime is Alpine
- Source: symlink at apps/mqtt/meshtk/ → ~/working/meshtk, build.sh copies source replacing symlink for Docker build context, restores after
- Proxy mode: TCP pass-through after MQTT CONNECT interception
- Auth flow: intercept CONNECT → validate credentials against DynamoDB (run.human users table, existing GSI on plaintext MQTT username/password fields) → rewrite CONNECT to meshtk-proxy service credentials → pipe TCP to mosquitto:1884
- 5-minute in-memory (Go map) cache for DynamoDB credential lookups
- SSM bypass: service accounts (meshobserv, ghosts) checked against SSM passwords first, skip DynamoDB
- Individual SSM passwords per service account (meshtk-proxy, meshobserv, ghosts)
- Packet inspection logs: JSON lines format to S3 (mqtt-logs bucket), rotation interval configurable via SSM
- Rate limiting: hardcoded defaults + S3 blocklist bucket for dynamic bans
- Preflight checks on startup (verify DynamoDB read, S3 write, mosquitto connectivity)
- Hard stop on SIGTERM (no graceful drain — MQTT clients reconnect)
- TCP health check on port 1883
- ECS task role with DynamoDB read access to run.human users table
- Listens on port 1883 only (TCP MQTT) — no WebSocket

### Nginx/Meshobserv Container
- Alpine base with nginx + supervisord installed
- Multi-stage Go build for meshobserv binary (separate binary from meshtk, source in meshtk repo)
- supervisord runs both nginx and meshobserv; meshobserv auto-restarts on crash
- Meshmap HTML: copied from DC33 (in meshtk repo), baked into Docker image
- nginx listens on port 80 (plain HTTP — NLB terminates TLS at 443)
- meshobserv connects to MQTT through meshtk proxy (service account via ECS secrets from SSM)
- meshobserv writes /var/www/html/nodes.json every 10 seconds
- meshobserv S3 snapshots: nodes.json to mqtt-logs bucket (snapshots/ prefix) every 15 minutes
- Channel PSK (AES-CTR encryption key) from SSM parameter — same value in both regions
- HTTP GET / on port 80 for ECS health check
- Configs (supervisord.conf, nginx.conf) live in apps/mqtt/nginx/ directory

### Ghosts Container
- Reuses mqtt-meshtk ECR image with ECS command override: `['meshtk', 'fleet', 'simulate', ...]`
- Ghost node JSONs AND GPX route files stored in S3 (new dedicated bucket, created by Phase 15)
- Container fetches ghost data from S3 at startup
- Connects through meshtk proxy with own 'ghosts' service account (SSM bypass)
- Configurable start delay via SSM parameter
- Restart policy with backoff (not essential: false — restarts on crash but task continues if it stays down)
- No port mapping, no health check
- ECS dependsOn meshtk with START condition (not HEALTHY)

### ECS Task Definition
- 4 named containers: mqtt-mosquitto, mqtt-meshtk, mqtt-nginx, mqtt-ghosts
- Resource split weighted by role (meshtk gets more as traffic handler)
- Total: 1024 CPU / 2048 MB memory
- Dependency chain: mosquitto → meshtk (HEALTHY) → nginx (HEALTHY) + ghosts (START)
- Shared CloudWatch log group: /ecs/run-mqtt with container name in stream prefix
- ECS secrets (valueFrom SSM ARN) for env var injection — no entrypoint SSM calls
- ECS task role: DynamoDB read + S3 read/write + SSM read + CloudWatch logs

### service.hcl Updates (Phase 15 Changes to Phase 14 Output)
- Fill containers[] array with 4 container definitions
- Update NLB 443 listener: container_port 443 → 80 (nginx port change)
- Comment out 8443 listener (WebSocket unscoped, keep defined for future)
- NLB listeners active: 1883 (TCP→meshtk), 8883 (TLS→meshtk), 443 (TLS→nginx)

### SSM Parameters (Phase 15 Creates)
- `/dc34/secrets/{region}/mqtt/meshtk-proxy-password` (SecureString)
- `/dc34/secrets/{region}/mqtt/meshobserv-password` (SecureString)
- `/dc34/secrets/{region}/mqtt/ghosts-password` (SecureString)
- `/dc34/secrets/{region}/mqtt/channel-psk` (SecureString, same both regions)
- `/dc34/secrets/{region}/mqtt/max-connections` (String)
- `/dc34/secrets/{region}/mqtt/s3-log-interval` (String)
- `/dc34/secrets/{region}/mqtt/ghost-start-delay` (String)
- Pre-populated with defaults via Terraform random_password for passwords

### Directory Structure
- apps/mqtt/mosquitto/ — Dockerfile, entrypoint.sh, acl.conf template
- apps/mqtt/meshtk/ — symlink → ~/working/meshtk (.gitignored), Dockerfile in parent
- apps/mqtt/nginx/ — Dockerfile, supervisord.conf, nginx.conf
- apps/mqtt/.gitignore — ignores meshtk/ symlink/copy
- apps/mqtt/README.md — brief architecture overview
- apps/mqtt/build.sh — minimal build script (./build.sh mosquitto|meshtk|nginx|all)
- Shared configs live in the container directory that uses them (no shared config dir)

### Build Pipeline
- Minimal apps/mqtt/build.sh for Phase 15 (Phase 16 integrates into main build.sh/deploy.sh)
- build.sh copies ~/working/meshtk/ to apps/mqtt/meshtk/ before Docker build, restores symlink after
- Single meshtk source copy shared by both meshtk and nginx container builds
- Multi-stage Go builds with named stages (FROM golang:X AS builder) in each Dockerfile
- Semantic versioning for image tags
- Individual + all build support (./build.sh mosquitto OR ./build.sh all)

### Claude's Discretion
- Exact CPU/memory weight distribution across 4 containers
- supervisord.conf process priority and restart delay settings
- Dockerfile layer optimization and caching strategy
- Ghost S3 bucket naming and lifecycle policies
- nginx.conf specifics (worker_processes, keepalive, etc.)
- Entrypoint script error message formatting
- Exact meshtk proxy CLI flags and config file structure

</decisions>

<specifics>
## Specific Ideas

- meshtk's existing `server proxy` mode already handles CONNECT packet interception — Phase 15 adds DynamoDB auth backend
- All external MQTT traffic (ports 1883, 8883) goes through meshtk proxy — mosquitto is purely internal
- Plaintext MQTT username/password already exist in run.human DynamoDB table with GSI for efficient lookup
- Ghost data (node JSONs + GPX routes) all in S3 for changeability without rebuild
- DC33 meshmap HTML ported as-is from meshtk repo with minor label updates

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/build.sh`: Existing build script pattern for Docker builds + ECR push (component + app args)
- `apps/run.auth/nginx/Dockerfile.nginx`: Nginx container pattern with health check
- `infra/terraform/live/site/services/run.mqtt/service.hcl`: Task/service definition (containers[] to be filled)
- `~/working/meshtk/`: Go binary with cmd/meshtk.go, internal/{mqtt,app,embedded} packages
- `~/working/meshtk/meshtk.defcon.yaml`: DC33 config example with MQTT broker, channels, encryption keys
- `~/working/meshtk/nodes.ghost.*.json`: Ghost node identity files (10+ ghost profiles)

### Established Patterns
- ECS containers use awslogs driver with `/ecs/{task-name}` log group
- SSM secrets injected via ECS `valueFrom` in container definition secrets block
- Docker builds use `apps/build.sh <component> <app>` convention
- ECR repos named `dc34-{service}-{component}` (e.g., dc34-run-auth-nginx)
- Terraform random_password for auto-generated credentials stored in SSM

### Integration Points
- `service.hcl` containers[] array → populated with 4 container definitions
- `service.hcl` load_balancers → port 443 container_port update, 8443 commented out
- ECS task role → add DynamoDB read, S3 read/write, SSM read policies
- run.human DynamoDB table → meshtk reads MQTT credentials via GSI
- Phase 14 S3 buckets (mqtt-logs, mqtt-blocklist) → used by meshtk and meshobserv
- New S3 bucket for ghost fleet data (Phase 15 creates)

</code_context>

<deferred>
## Deferred Ideas

- WebSocket MQTT support (8443 listener) — unscoped, infrastructure defined but commented out for future enablement
- Cross-region MQTT bridging — ADV-02, v2 requirement
- Historical node data persistence to S3 archival — ADV-03, v2 (but meshobserv S3 snapshots prep the path)
- Build/deploy script integration into main pipeline — Phase 16 (CONT-08, CONT-09)

</deferred>

---

*Phase: 15-container-images-task-definition*
*Context gathered: 2026-03-07*
