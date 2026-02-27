# Design: MQTT Mesh Network Service

## Architecture Overview

```
                    ┌──────────────────────────────────────────────────────┐
                    │                    Internet                           │
                    └──────────┬──────────────────────────┬────────────────┘
                               │                          │
                    ┌──────────▼──────────┐    ┌──────────▼──────────┐
                    │   NLB (mqtt.defcon.run)│    │  ALB (*.defcon.run)  │
                    │  :1883 TCP            │    │  :443 HTTPS          │
                    │  :8883 TLS            │    │                      │
                    │  :8443 TLS (WebSocket)│    │                      │
                    │  :443  TLS (HTTPS)    │    │                      │
                    └──────────┬──────────┘    └──────────┬──────────┘
                               │                          │
               ┌───────────────▼───────────────┐          │
               │        ECS Task: run-mqtt      │          │
               │                                │          │
               │  ┌─────────────────────────┐   │          │
               │  │  meshtk proxy (:1883)   │   │          │
               │  │  • MQTT packet inspection│   │          │
               │  │  • Rate limiting         │   │          │
               │  │  • SQS hook (async)      │   │          │
               │  │  • HTTP hook (:8080)     │   │          │
               │  └────────────┬────────────┘   │          │
               │               │                │          │
               │  ┌────────────▼────────────┐   │          │
               │  │  mosquitto (:1884)       │   │          │
               │  │  • MQTT broker           │   │          │
               │  │  • Cross-region bridge   │   │          │
               │  │  • WebSocket (:9001)     │   │          │
               │  └─────────────────────────┘   │          │
               │                                │          │
               │  ┌─────────────────────────┐   │          │
               │  │  nginx (:443)            │   │          │
               │  │  • TLS termination       │   │          │
               │  │  • Health check /hello   │   │          │
               │  └─────────────────────────┘   │          │
               │                                │          │
               │  ┌─────────────────────────┐   │          │
               │  │  ghosts (optional)       │   │     ┌────▼──────────────┐
               │  │  • Fleet simulation      │   │     │  run.gpx           │
               │  │  • Non-essential         │   │     │  (gpx.studio)      │
               │  └─────────────────────────┘   │     │  polls meshtk      │
               └────────────────────────────────┘     │  :8080/api/nodes   │
                               │                       └───────────────────┘
                               │ (async)                        │
                    ┌──────────▼──────────┐             ┌───────▼──────────┐
                    │       SQS Queue      │             │  run.human       │
                    │  mqtt-packets-{region}│             │  /mesh section   │
                    └──────────┬──────────┘             │  • Provisioning  │
                               │                        │  • Web Serial    │
                    ┌──────────▼──────────┐             │  • QR codes      │
                    │   Lambda Consumers   │             └──────────────────┘
                    │  • DynamoDB (nodes)  │
                    │  • S3 (analytics)    │
                    │  • SNS (alerts)      │
                    └─────────────────────┘
```

## Component 1: meshtk Upstream Hook System

### Hook Interface

```go
// internal/app/server/hooks.go
type Hook interface {
    Name() string
    Start(log *log.Logger) error
    Send(packet *InspectorPacket, decision DecisionResult)
    Stop()
}

type HookDispatcher struct {
    hooks []Hook
    log   *log.Logger
}
```

All hooks are initialized at proxy startup from config. The dispatcher calls `Send()` on each enabled hook after packet inspection. Each hook manages its own async buffering — the proxy hot path never blocks on hook I/O.

### Hook Configuration (YAML)

```yaml
Server:
  Hooks:
    NodeDB:
      Enabled: true
      PersistPath: ""           # Empty = in-memory only
      TTLMinutes: 60

    SQS:
      Enabled: false            # dc34 enables via meshtk.defcon.yaml
      QueueURL: ""              # Injected via MESHTK_SERVER_HOOKS_SQS_QUEUEURL
      Region: ""                # Injected via MESHTK_SERVER_HOOKS_SQS_REGION
      BatchSize: 10
      FlushIntervalMs: 100
      BufferSize: 1000
      Filter:
        PortNums: []            # Empty = all
        Decisions: []           # Empty = all
        IncludePayload: true

    HTTP:
      Enabled: false
      ListenAddress: ":8080"
      Endpoints:
        Nodes: true             # GET /api/nodes (GeoJSON)
        Stats: true             # GET /api/stats
        Health: true            # GET /api/health

    Webhook:
      Enabled: false
      URL: ""
      Headers: {}
      BatchSize: 10
      FlushIntervalMs: 500
      Filter:
        PortNums: []
        Decisions: []
```

### SQS Message Format

```json
{
  "ts": "2026-08-08T14:23:45.123Z",
  "region": "use1",
  "connection": {
    "ip": "203.0.113.42",
    "client_id": "!deadbeef",
    "username": "dcr-kph-7b3a"
  },
  "mqtt": {
    "type": "PUBLISH",
    "topic": "dcr34/US/2/e/LongFast/!deadbeef"
  },
  "mesh": {
    "id": 839201,
    "from": "!44014c7b",
    "to": "!ffffffff",
    "port_num": "POSITION_APP",
    "hop_limit": 3,
    "via_mqtt": true,
    "rx_snr": -4.5
  },
  "payload": {
    "type": "position",
    "latitude": 36.1597895,
    "longitude": -115.1525822,
    "altitude": 619,
    "precision": 32
  },
  "decision": "ALLOW"
}
```

### HTTP API Endpoints (NodeDB Hook)

| Endpoint | Response | Description |
|----------|----------|-------------|
| `GET /api/nodes` | GeoJSON FeatureCollection | All known nodes with properties |
| `GET /api/nodes/:id` | GeoJSON Feature | Single node details |
| `GET /api/stats` | JSON | Connection count, packet rates, node count |
| `GET /api/health` | 200 OK | Liveness probe for ECS health check |

### Integration Point in proxy.go

```go
// After inspection and decision, before forwarding to backend:
n.Dispatcher.Dispatch(ip, result)
```

Single line addition to existing proxy flow. Non-blocking — each hook handles its own async.

## Component 2: ECS Service Definition

### service.hcl Structure

The run-mqtt service uses the existing dc34 ecs-task and ecs-service modules. Key differences from other services:
- 3-4 containers instead of the typical 2
- NLB load balancers instead of ALB
- Container dependency chain: mosquitto → meshtk proxy → nginx → ghosts
- Additional port mappings for MQTT protocols

### Container Architecture

```
┌─────────────────────────────────────────────────────┐
│  ECS Task: run-mqtt (1024 CPU, 2048 MB)             │
│                                                      │
│  mosquitto (256 CPU, 512 MB)     [essential]         │
│  • :1884 MQTT internal                               │
│  • :9001 WebSocket internal                          │
│  • Health: nc -z localhost 1884                       │
│                                                      │
│  meshtk-proxy (256 CPU, 512 MB)  [essential]         │
│  • :1883 MQTT external (proxy to mosquitto:1884)     │
│  • :8080 HTTP API (hooks)                            │
│  • depends_on: mosquitto HEALTHY                     │
│  • Health: nc -z localhost 1883                       │
│                                                      │
│  nginx (256 CPU, 512 MB)         [essential]         │
│  • :443 HTTPS (health check, future meshmap)         │
│  • depends_on: meshtk-proxy HEALTHY                  │
│  • Health: curl -k https://localhost/hello            │
│                                                      │
│  ghosts (128 CPU, 256 MB)        [non-essential]     │
│  • No ports (fleet simulator)                        │
│  • depends_on: nginx HEALTHY                         │
│  • Command: meshtk fleet simulate                    │
│  • Shares meshtk-proxy image                         │
└─────────────────────────────────────────────────────┘
```

### NLB Listener Mapping

| NLB Port | Protocol | Target Container | Target Port | Purpose |
|----------|----------|-----------------|-------------|---------|
| 1883 | TCP | meshtk-proxy | 1883 | Raw MQTT (Proxy Protocol v2) |
| 8883 | TLS | meshtk-proxy | 1883 | MQTT over TLS |
| 443 | TLS | nginx | 443 | HTTPS health / web UI |
| 8443 | TLS | mosquitto | 9001 | MQTT over WebSocket |

### Cross-Region Bridging

Each region's mosquitto config includes a bridge to peer regions. The bridge address uses the regional NLB DNS:

```
# mosquitto.use1.conf (generated or environment-driven)
connection bridge-to-cac1
address cac1.mqtt.defcon.run:1883
topic # both 0
```

The config could be templated using `REGION_SHORT` and `SITE_DOMAIN` environment variables, with an entrypoint script selecting the right bridge config at container startup.

## Component 3: SQS Pipeline

```
meshtk proxy
    ↓ (buffered Go channel, non-blocking)
SQS BatchPublisher goroutine
    ↓ (SendMessageBatch, up to 10 msgs, flush every 100ms)
SQS Queue: mqtt-packets-{region}-{site}
    ↓
Lambda Consumers (future phase):
    ├── Position Processor → DynamoDB (node positions for map)
    ├── Analytics Processor → S3 Parquet → Athena queries
    └── Alert Processor → SNS (blocked IPs, abuse patterns)
```

SQS provides durable, decoupled observability. The proxy stays fast — if SQS is slow or the buffer fills, packets are dropped (not blocked). CloudWatch SQS metrics give free dashboards for message rates.

## Component 4: gpx.studio Mesh Overlay

### Relationship to `add-realtime-overlays`

The existing `add-realtime-overlays` proposal designs a generic real-time entity system for gpx.studio with `RealtimeEntity` types (participant, vehicle, checkpoint, objective, poi), SSE broadcast, DynamoDB persistence, and a `RealtimeLayer` Mapbox component. Its architecture diagram explicitly includes "External Tracker (webhook/poll)" as a source type.

**Mesh nodes are a source feeding into that system, not a parallel layer.** The mqtt-mesh service extends the realtime overlay system with:

1. A new entity source: `meshtk` (mesh radio positions via MQTT)
2. A new entity type: `'radio'` added to the RealtimeEntity type enum
3. A bridge service that polls meshtk's HTTP hook and pushes updates into the RealtimeHub
4. Mesh-specific rendering (radio icons, signal/battery indicators, neighbor links)

```
┌──────────────────────────────────────────────────────────────────┐
│                    gpx.studio Map (Mapbox GL)                     │
│                                                                   │
│  ┌──────────────┐  ┌───────────────────────┐  ┌──────────────┐  │
│  │ GPX Layers   │  │    RealtimeLayer       │  │ OverpassLayer│  │
│  │ (tracks,     │  │  ┌────────┐ ┌───────┐  │  │ (POIs)       │  │
│  │  waypoints)  │  │  │ Radios │ │ Users │  │  │              │  │
│  │              │  │  │ (mesh) │ │ (GPS) │  │  │              │  │
│  └──────────────┘  │  └────────┘ └───────┘  │  └──────────────┘  │
│                    │  ┌────────┐ ┌───────┐  │                    │
│                    │  │ CTF    │ │ Veh.  │  │                    │
│                    │  │ points │ │       │  │                    │
│                    │  └────────┘ └───────┘  │                    │
│                    └───────────────────────┘                    │
└──────────────────────────────────────────────────────────────────┘
                              ↑
                    realtimeStore (Svelte)
                    { entities: Map<id, RealtimeEntity> }
                              ↑
                    ┌─────────┴──────────┐
                    │                    │
            SSE stream              Mesh poller
      /api/realtime/events/:id    /api/mesh/nodes
      (participants, CTF, etc.)   (radio positions)
                    │                    │
            RealtimeHub            meshtk HTTP hook
            (Next.js)              (:8080/api/nodes)
                    │                    │
                    │              ECS service discovery
                    │           run-mqtt.app-{region}.local
                    │                    │
                    └────────┬───────────┘
                             │
                    ┌────────▼─────────┐
                    │   DynamoDB        │
                    │ realtime-entities │
                    └──────────────────┘
```

### Integration Architecture: Two Ingest Paths

The realtime overlay system gets data from two paths:

**Path A: Direct (SSE)** — For browser-originated position sharing (participants sharing GPS, admin-placed game objects). This is the `add-realtime-overlays` design as-is.

**Path B: Mesh Bridge (Polling)** — For mesh radio positions. A bridge service (either a Next.js API route or a Lambda triggered by SQS) polls meshtk's HTTP API and upserts mesh nodes as RealtimeEntity records:

```typescript
// apps/run.gpx/webapp/src/app/api/mesh/bridge/route.ts
// Called periodically (cron or self-polling) to sync mesh nodes into realtime system

export async function GET() {
  // 1. Fetch current mesh nodes from meshtk via service discovery
  const meshtk = await fetch('http://run-mqtt.app-use1-dc34.local:8080/api/nodes');
  const geojson: GeoJSON.FeatureCollection = await meshtk.json();

  // 2. Convert mesh nodes to RealtimeEntity format
  const entities: RealtimeEntity[] = geojson.features.map(f => ({
    id: f.properties.id,                    // "!44014c7b"
    type: 'radio' as const,                 // New entity type for mesh radios
    eventId: 'dc34-mesh',                   // Fixed event for mesh overlay
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    altitude: f.properties.altitude,
    label: f.properties.longName,           // "ghost-sharp-00"
    icon: f.properties.hwModel,             // "HELTEC_V3" → mapped to icon
    status: f.properties.battery > 20 ? 'active' : 'low-battery',
    lastUpdate: f.properties.lastSeen * 1000,
    source: 'tracker',
    // Mesh-specific metadata stored in extended properties
    metadata: {
      shortName: f.properties.shortName,
      hwModel: f.properties.hwModel,
      battery: f.properties.battery,
      voltage: f.properties.voltage,
      temperature: f.properties.temperature,
      humidity: f.properties.humidity,
      snr: f.properties.snr,
      neighborCount: f.properties.neighborCount,
    }
  }));

  // 3. Upsert into DynamoDB (same table as other realtime entities)
  await Promise.all(entities.map(e => upsertEntity(e)));

  // 4. Broadcast updates via RealtimeHub SSE
  entities.forEach(e => realtimeHub.broadcast('dc34-mesh', 'update', e));

  return NextResponse.json({ synced: entities.length });
}
```

**Alternative Path B: SQS → Lambda** — Instead of polling from run.gpx, a Lambda consumer on the SQS queue writes POSITION_APP packets directly to DynamoDB as RealtimeEntity records. This is lower latency (no polling interval) and fully decoupled:

```
meshtk proxy → SQS (POSITION_APP packets) → Lambda → DynamoDB (realtime-entities)
                                                         ↓
                                              RealtimeLayer reads via SSE
```

Both paths result in the same outcome: mesh nodes appear in the `realtimeStore` alongside participants, CTF points, and other entities.

### Extended RealtimeEntity Type

The `add-realtime-overlays` entity types are extended with `'radio'`:

```typescript
interface RealtimeEntity {
  id: string;
  type: 'participant' | 'vehicle' | 'checkpoint' | 'objective' | 'poi' | 'radio';
  eventId: string;
  lat: number;
  lng: number;
  altitude?: number;
  heading?: number;
  speed?: number;
  label?: string;
  icon?: string;
  color?: string;
  status?: string;
  team?: string;
  score?: number;
  capturedBy?: string;
  lastUpdate: number;
  source: 'gps' | 'tracker' | 'manual' | 'mesh';   // 'mesh' added
  metadata?: Record<string, unknown>;                 // Extension point for type-specific data
}
```

The `metadata` field carries type-specific properties without polluting the core interface. For `type: 'radio'`, metadata includes battery, voltage, temperature, humidity, SNR, neighbor count, hardware model — all the Meshtastic telemetry.

### Mesh-Specific Rendering in RealtimeLayer

The RealtimeLayer from `add-realtime-overlays` renders entities by type. Mesh radios get specific treatment:

```typescript
// In realtime-layer.ts — icon and style selection by entity type

function getEntityIcon(entity: RealtimeEntity): string {
  switch (entity.type) {
    case 'radio':
      // Map hardware model to icon, or use generic radio icon
      const hwModel = entity.metadata?.hwModel as string;
      return radioIcons[hwModel] ?? 'radio-default';
    case 'participant': return 'runner';
    case 'vehicle': return 'car';
    case 'checkpoint': return 'flag';
    case 'objective': return 'target';
    case 'poi': return 'pin';
  }
}

function getEntityColor(entity: RealtimeEntity): string {
  if (entity.type === 'radio') {
    // Color by battery level
    const battery = entity.metadata?.battery as number ?? 100;
    if (battery > 50) return '#22c55e';     // green
    if (battery > 20) return '#eab308';     // yellow
    return '#ef4444';                        // red
  }
  // ... other type colors from add-realtime-overlays
}

function getEntityOpacity(entity: RealtimeEntity): number {
  // Fade stale entities
  const age = Date.now() - entity.lastUpdate;
  if (age > 600_000) return 0.3;    // >10 min: very faded
  if (age > 120_000) return 0.6;    // >2 min: somewhat faded
  return 1.0;                        // fresh
}
```

### Mesh Node Popup

When a user clicks a radio entity, the popup shows mesh-specific telemetry:

```
┌──────────────────────────────┐
│ 📻 ghost-sharp-00 (GS00)    │
│ Hardware: Heltec V3          │
│ ─────────────────────────    │
│ 🔋 Battery: 34% (3.89V)     │
│ 🌡️ Temp: 21.2°C             │
│ 💧 Humidity: 59.7%           │
│ 📡 SNR: -4.8 dB             │
│ 👥 Neighbors: 3              │
│ ⛰️ Altitude: 619m            │
│ 🕐 Last seen: 2m ago        │
└──────────────────────────────┘
```

This is rendered by extending the existing `RealtimeLayer` popup component to handle `type === 'radio'` with a mesh-specific template, rather than creating a separate `MeshNodePopup`.

### Neighbor Link Lines (Optional Enhancement)

Meshtk's NodeDB includes neighbor data with SNR values. This enables rendering **link lines** between neighboring radios:

```typescript
// Optional: neighbor links as a separate GeoJSON LineString layer
function neighborLinksGeoJSON(entities: RealtimeEntity[]): GeoJSON.FeatureCollection {
  const radioMap = new Map(
    entities.filter(e => e.type === 'radio').map(e => [e.id, e])
  );

  const features: GeoJSON.Feature[] = [];
  for (const entity of radioMap.values()) {
    const neighbors = entity.metadata?.neighbors as Record<string, { snr: number }>;
    if (!neighbors) continue;

    for (const [neighborId, { snr }] of Object.entries(neighbors)) {
      const neighbor = radioMap.get(neighborId);
      if (!neighbor) continue;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [entity.lng, entity.lat],
            [neighbor.lng, neighbor.lat]
          ]
        },
        properties: { snr, from: entity.id, to: neighborId }
      });
    }
  }

  return { type: 'FeatureCollection', features };
}
```

Rendered as a `line` layer with opacity mapped to SNR (stronger signal = more opaque). This gives a visual mesh topology overlay on top of the GPX routes.

### Patch Strategy

The mesh-specific additions are delivered as **patch 007-mesh-integration.patch**, applied during `build-frontend.sh`. The patch modifies:

1. **`src/lib/types/realtime.ts`** — Adds `'radio'` to entity type union, adds `'mesh'` to source union, adds `metadata` field
2. **`src/lib/components/map/realtime-layer/realtime-layer.ts`** — Adds radio icon mapping, battery-based coloring, opacity fade, neighbor link layer
3. **`src/lib/components/map/realtime-layer/RealtimeLayer.svelte`** — Adds radio popup template
4. **`src/lib/components/map/realtime-layer/icons/`** — Adds radio SVG icons (generic + per hardware model)

If `add-realtime-overlays` is implemented first, patch 007 extends it. If this proposal is implemented first, the base `RealtimeLayer` + `realtimeStore` infrastructure is built as a prerequisite (a shared dependency).

### Coordinate Conversion

Meshtastic uses int32 coordinates scaled by 1e-7. meshtk's HTTP hook converts to float64 before serving GeoJSON:

```go
// In meshtk HTTP hook — toGeoJSON()
lat := float64(node.Latitude) / 1e7    // 361597895 → 36.1597895
lon := float64(node.Longitude) / 1e7   // -1151525822 → -115.1525822
```

The GeoJSON served by meshtk is standard WGS84 float64 coordinates — no conversion needed on the frontend.

### Node GeoJSON Feature (from meshtk HTTP hook)

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [-115.1525822, 36.1597895] },
  "properties": {
    "id": "!44014c7b",
    "longName": "ghost-sharp-00",
    "shortName": "GS00",
    "hwModel": "HELTEC_V3",
    "role": "CLIENT",
    "battery": 34,
    "voltage": 3.89,
    "temperature": 21.2,
    "humidity": 59.7,
    "altitude": 619,
    "snr": -4.8,
    "lastSeen": 1754357652,
    "neighborCount": 3,
    "neighbors": {
      "!deadbeef": { "snr": -4.7 },
      "!c0ffee42": { "snr": -8.2 },
      "!babe1234": { "snr": -12.1 }
    }
  }
}
```

## Component 5: Mesh Provisioning UI

### Architecture

```
run.human/webapp/src/app/mesh/
├── page.tsx                    # Dashboard: your mesh identity, radio status
├── configure/page.tsx          # Web Serial configurator (one-click setup)
├── firmware/page.tsx           # Firmware image downloads
└── api/mesh/
    ├── credentials/route.ts    # Generate per-user MQTT creds
    ├── config/route.ts         # Generate config YAML download
    ├── channel-url/route.ts    # Generate channel URL + QR code
    └── firmware/route.ts       # Serve pre-built firmware images from S3
```

### Provisioning Methods

| Method | What it configures | Technology | Audience |
|--------|-------------------|------------|----------|
| Web Serial | Everything (MQTT, channels, LoRa, device) | `@meshtastic/core` + Web Serial API | Primary (Chrome/Edge) |
| QR / Channel URL | Channels + LoRa only (not MQTT) | ChannelSet protobuf encoding | Mobile app users |
| Config YAML | Everything | `meshtastic --configure` CLI | Power users |
| Firmware download | Everything (baked in) | Pre-built .bin per hardware model | Fresh devices |

### Per-User Identity

```
User logs in → /mesh page
    ↓
Generate mesh identity (if not exists):
    - nodePrefix: "dcr-{username_short}-{random_hex}"
    - mqttUsername: "dcr-{user_id_short}"
    - mqttPassword: generated, stored in DynamoDB
    - channelKeys: event-wide (shared)
    ↓
Store in DynamoDB: run-mesh-identity table
    ↓
Available for provisioning (Web Serial writes to device,
YAML includes credentials, firmware bakes them in)
```

## Component 6: ConfigUI Network Panel

### Panel Location

Infrastructure Modules section, alongside WAF, CloudFront, etc.

### Tabs

| Tab | Contents |
|-----|----------|
| MQTT | Service enable/disable, broker settings, channel config |
| Fleet | Ghost simulator toggle, node count, behaviors |
| Bridge | Cross-region bridge enable/disable, peer region list |
| Status | Live stats from meshtk HTTP hook (connection count, packet rates, node count) |

### Config Fields

```go
type MQTTConfig struct {
    Enabled        bool   `json:"enabled"`
    BrokerDomain   string `json:"broker_domain"`    // mqtt.defcon.run
    ChannelName    string `json:"channel_name"`      // dc.run
    ChannelKey     string `json:"channel_key"`       // base64 AES key
    TopicPrefix    string `json:"topic_prefix"`      // dcr34
    FleetEnabled   bool   `json:"fleet_enabled"`
    FleetNodeCount int    `json:"fleet_node_count"`
    BridgeEnabled  bool   `json:"bridge_enabled"`
    BridgeRegions  string `json:"bridge_regions"`    // comma-separated
}
```

## Alternatives Considered

### meshtk HTTP API vs SQS for node positions
Could have meshtk serve node data directly to gpx.studio and skip SQS entirely. Chose SQS because it decouples the proxy from consumers, enables analytics/alerting, and provides audit trail. The HTTP hook still exists for direct low-latency access (gpx.studio polling).

### Separate meshmap service vs gpx.studio overlay
dc33 had a standalone meshmap (static HTML served by nginx). For dc34, embedding the mesh overlay into gpx.studio reuses existing infrastructure, gives richer map features (GPX tracks + live nodes), and avoids a new service. The trade-off is coupling to gpx.studio's patch system.

### Custom firmware builder vs Web Serial config
MeshForge-style on-demand firmware building is complex (needs build infrastructure per hardware model). Web Serial configuration is simpler, works with any firmware version, and can set per-user MQTT credentials. Pre-built firmware images are offered as a secondary option for convenience.

### Managed MQTT (AWS IoT Core) vs self-hosted mosquitto
AWS IoT Core would eliminate the NLB and mosquitto container but adds cost, limits protocol customization, and doesn't support meshtk's deep packet inspection. Self-hosted gives full control over the MQTT protocol layer.

## Risks

- **NLB first use in dc34**: The ecs-service module supports `type = "nlb"` but no existing service uses it. May surface edge cases.
- **Web Serial browser support**: Only Chrome/Edge support Web Serial API. Firefox/Safari users need the mobile app or CLI path.
- **Cross-region bridge latency**: Mosquitto bridges add latency for cross-region mesh communication. Acceptable for the use case but worth monitoring.
- **meshtk copy freshness**: Copying meshtk into the monorepo means manual sync. Upstream changes must be deliberately pulled.
