# Change: Add Real-Time Map Overlays to GPX Studio

## Why

DEF CON events need live tracking capabilities for participants, game mechanics (CTF), and spectator viewing. The current GPX Studio only supports static tracks and waypoints. Adding real-time overlays enables:
- Spectators watching runners/vehicles during events
- Participants sharing and viewing each other's locations
- Interactive game elements (capture points, moving objectives)

## What Changes

- **NEW** Real-time entity API for position updates (SSE broadcast + REST submission)
- **NEW** RealtimeLayer component in Svelte map for animated markers
- **NEW** DynamoDB table for position storage with TTL cleanup
- **NEW** Entity type system (participant, vehicle, checkpoint, objective, poi)
- **NEW** Admin controls for managing game objects

## Impact

- Affected specs: `gpxstudio` (new capability), `gpx-realtime` (new spec)
- Affected code:
  - `apps/run.gpx/webapp/src/app/api/realtime/` (new API routes)
  - `apps/run.gpx/gpx-studio/website/src/lib/stores/realtime.ts` (new store)
  - `apps/run.gpx/gpx-studio/website/src/lib/components/map/realtime-layer/` (new layer)
  - `infra/terraform/modules/dynamodb/` (new table)

## Design Decisions

### Communication Protocol: SSE + REST Hybrid

**Choice**: Server-Sent Events for broadcast, REST for submissions

**Rationale**:
- 10-60s latency requirement doesn't need WebSocket complexity
- SSE is simpler (HTTP-based, auto-reconnect, works through CDNs)
- REST POST for position updates integrates with existing auth
- Scales easily with standard HTTP infrastructure

**Alternatives considered**:
- WebSockets: More complex, needed for <1s bidirectional
- WebRTC: Too complex for this use case
- Polling: Higher server load, acceptable but SSE is better

### Entity Model: Flexible Type System

**Choice**: Generic entity with `type` field vs separate endpoints per type

**Rationale**:
- Single data model simplifies API and storage
- Frontend can filter/style by type
- Easy to add new entity types without schema changes
- Game mechanics can repurpose entities (checkpoint → captured)

### Storage: DynamoDB with TTL

**Choice**: DynamoDB over Redis/in-memory

**Rationale**:
- Already using DynamoDB for GPX metadata
- TTL handles stale entity cleanup automatically
- Cross-region replication via DynamoDB Global Tables (future)
- Sufficient for 500 entities with 10-60s update intervals

### Scale Considerations

For 50-500 concurrent entities:
- SSE broadcast is efficient (one connection per viewer)
- DynamoDB handles read/write easily
- Mapbox GL renders 500+ markers without issue
- Clustering available if needed for dense areas
