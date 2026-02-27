# Change: Add MQTT Mesh Network Service

## Why

DEF CON events depend on Meshtastic mesh radio networks for participant communication, live tracking, and interactive game mechanics. defcon.run.33 ran a full mqtt.defcon.run deployment with meshtk (a Go-based MQTT proxy with deep packet inspection), mosquitto broker, and a mesh map. That infrastructure needs to be translated into defcon.run.34's standardized multi-region service architecture (ECS Fargate, Terragrunt, service.hcl pattern) while extending meshtk with configurable output hooks (SQS, HTTP API) for observability, and adding a provisioning UI so attendees can configure their radios for the event network.

## What Changes

### Infrastructure (run.mqtt service)
- **NEW** `apps/run.mqtt/` service with 3-4 ECS containers: mosquitto broker, meshtk proxy, nginx, optional ghost fleet
- **NEW** NLB listeners for MQTT traffic (TCP :1883, TLS :8883, WebSocket :8443, HTTPS :443)
- **NEW** ACM certificate for `mqtt.defcon.run` + `*.mqtt.defcon.run`
- **NEW** Route 53 alias records pointing `mqtt.defcon.run` to regional NLBs
- **NEW** Security group for MQTT ports (1883, 8883, 8443, 443)
- **NEW** SQS queue per region for packet event stream
- **NEW** `infra/terraform/live/site/services/run.mqtt/service.hcl` following dc34 service pattern
- **NEW** Cross-region mosquitto bridge configuration (templated per region)

### meshtk Upstream Hooks
- **NEW** Hook dispatcher system in meshtk with pluggable output sinks
- **NEW** SQS hook: async batch publishing of inspected packets to SQS
- **NEW** HTTP hook: REST API serving node positions (GeoJSON), stats, and health
- **NEW** Webhook hook: generic HTTP POST for external integrations
- **NEW** NodeDB hook: in-memory node tracking with optional file persistence
- **NEW** Hook filter system: filter by PortNum, decision type, include/exclude payload

### gpx.studio Mesh Map Overlay
- **NEW** Patch `007-mesh-integration.patch` adding mesh node layer to gpx.studio
- **NEW** `MeshLayer` component rendering live node positions as GeoJSON markers
- **NEW** `/api/mesh/nodes` proxy endpoint in run.gpx fetching from meshtk HTTP hook
- **NEW** Node popup showing battery, signal, temperature, neighbors, last seen
- **MODIFIED** `add-realtime-overlays` design: mesh nodes become a data source for the generic realtime entity system

### Mesh Provisioning UI (MeshForge)
- **NEW** `/mesh` section in run.human for radio provisioning
- **NEW** Web Serial configurator using `@meshtastic/core` for one-click radio setup
- **NEW** Channel URL / QR code generation (ChannelSet protobuf encoding)
- **NEW** Downloadable config YAML for CLI users (`meshtastic --configure`)
- **NEW** Pre-built firmware image downloads (per hardware model, with event config)
- **NEW** Per-user MQTT credential generation tied to auth identity
- **NEW** DynamoDB entity for mesh identity tracking

### ConfigUI Network Panel
- **NEW** Network panel in Infrastructure Modules section with MQTT toggle
- **NEW** Tabs: MQTT / Fleet / Bridge / Status
- **NEW** API endpoints for MQTT service status and configuration

## Impact

- Affected specs: none existing (all new capabilities)
- New specs: `mqtt-mesh` (new capability)
- Related changes: `add-realtime-overlays` (mesh nodes as data source)
- Affected code:
  - `apps/run.mqtt/` (new service)
  - `apps/run.gpx/patches/` (new mesh overlay patch)
  - `apps/run.gpx/webapp/src/app/api/mesh/` (new API routes)
  - `apps/run.human/webapp/src/app/mesh/` (new provisioning pages)
  - `apps/configui/` (new Network panel)
  - `infra/terraform/live/site/services/run.mqtt/` (new service config)
  - `infra/terraform/modules/` (possible SQS module, NLB security group additions)
  - `/Users/khundeck/working/meshtk/` (upstream hook system)

## Design Decisions

### meshtk as upstream project with dc34 as consumer
meshtk hooks (SQS, HTTP, Webhook) are developed upstream in the standalone meshtk repo. dc34 copies the meshtk source into `apps/run.mqtt/meshtk/` and configures hooks via `meshtk.defcon.yaml`. This keeps meshtk reusable for other events/deployments while dc34 enables the specific hooks it needs. Updates flow upstream-first, then copy into dc34.

### SQS as the primary observability channel
Rather than meshtk maintaining complex downstream integrations, it publishes enriched packet data to SQS. Lambda consumers process the stream for DynamoDB (node positions), S3/Athena (analytics), and SNS (alerts). This decouples the proxy from its consumers and enables replay/audit.

### NLB for MQTT, ALB for web
MQTT requires raw TCP (port 1883) and TLS (port 8883) which ALB cannot handle. The dc34 ecs-service module already supports `type = "nlb"` in load_balancer configs. The mesh map web UI routes through gpx.studio (ALB path) rather than a separate meshmap service.

### Web Serial for provisioning (not custom firmware)
The primary provisioning path uses `@meshtastic/core` + Web Serial API to configure already-flashed devices. This avoids firmware compilation, preserves user firmware versions, and can set MQTT credentials that channel URLs cannot carry. Pre-built firmware images are offered as a secondary option for fresh devices.

### Per-user MQTT credentials
Each authenticated user gets unique MQTT credentials generated at provisioning time. meshtk's proxy validates these against DynamoDB, enabling per-user tracking, abuse prevention, and identity-linked node positions on the mesh map.
