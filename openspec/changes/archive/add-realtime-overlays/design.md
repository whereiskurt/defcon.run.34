# Design: Real-Time Map Overlays

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                        Frontend (run.gpx)                       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Mapbox GL Map                          │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│  │  │ GPX Layers   │  │ Realtime     │  │ Game Objects │   │   │
│  │  │ (tracks)     │  │ Markers      │  │ (CTF points) │   │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↑                                  │
│  ┌───────────────────────────┴───────────────────────────┐     │
│  │            realtimeStore (Svelte store)                │     │
│  │  { entities: Map<id, Entity>, connected: boolean }     │     │
│  └────────────────────────────┬──────────────────────────┘     │
└───────────────────────────────┼────────────────────────────────┘
                                │
            ┌───────────────────┴───────────────────┐
            │    SSE: /api/realtime/events/:eventId │
            │    (broadcasts position updates)       │
            └───────────────────┬───────────────────┘
                                │
┌───────────────────────────────┴───────────────────────────────┐
│                     Backend (Next.js API)                      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  RealtimeHub (in-memory)                 │   │
│  │  • Manages SSE connections per event                     │   │
│  │  • Broadcasts updates to all connected clients           │   │
│  │  • In-memory for single instance, Redis for multi        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↑                                  │
│  ┌───────────────────────────┴───────────────────────────┐     │
│  │  POST /api/realtime/position                           │     │
│  │  • Authenticated position updates from participants    │     │
│  │  • Validates + stores + broadcasts                     │     │
│  └───────────────────────────────────────────────────────┘     │
│                              ↑                                  │
│  ┌───────────────────────────┴───────────────────────────┐     │
│  │                    DynamoDB                             │     │
│  │  • Persists entity positions                           │     │
│  │  • TTL auto-cleanup of stale entities                  │     │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ↓                       ↓                       ↓
┌───────────────┐    ┌───────────────┐    ┌───────────────────┐
│ Mobile App    │    │ Web Browser   │    │ External Tracker  │
│ (phone GPS)   │    │ (share loc)   │    │ (webhook/poll)    │
└───────────────┘    └───────────────┘    └───────────────────┘
```

## Data Flow

### Position Update Flow

```
1. Client submits position
   POST /api/realtime/position
   { eventId, lat, lng, heading, speed, ... }

2. Server validates & stores
   - Validate coordinates (-90<=lat<=90, -180<=lng<=180)
   - Validate eventId exists
   - Upsert to DynamoDB with TTL

3. Server broadcasts via RealtimeHub
   - Find all SSE connections for eventId
   - Send 'update' event with entity data

4. Clients update UI
   - realtimeStore receives update
   - Updates entities Map
   - Mapbox source.setData() triggers render
```

### SSE Connection Flow

```
1. Client connects
   GET /api/realtime/events/:eventId
   Accept: text/event-stream

2. Server establishes connection
   - Add connection to RealtimeHub for eventId
   - Send initial 'snapshot' with all current entities
   - Begin keepalive pings every 30s

3. Server sends updates
   event: update
   data: {"id":"user123","lat":36.12,"lng":-115.17,...}

4. Client reconnects on disconnect
   - EventSource auto-reconnects
   - Receives fresh snapshot
```

## API Design

### REST Endpoints

```
POST   /api/realtime/position              Submit position update (auth required)
GET    /api/realtime/snapshot/:eventId     Get current state (optional auth)
GET    /api/realtime/events                List active events
POST   /api/realtime/admin/event           Create event (admin)
PUT    /api/realtime/admin/entity/:id      Update game entity (admin)
DELETE /api/realtime/admin/entity/:id      Remove game entity (admin)
```

### SSE Endpoint

```
GET    /api/realtime/events/:eventId       SSE stream for event
```

### SSE Event Types

```
event: snapshot
data: [{"id":"...","type":"participant",...}, ...]

event: update
data: {"id":"user123","type":"participant","lat":36.12,"lng":-115.17,...}

event: remove
data: {"id":"user123"}

:ping (comment, keepalive)
```

## DynamoDB Schema

### Table: dc34-realtime-entities

| Attribute | Type | Description |
|-----------|------|-------------|
| eventId (PK) | String | Event identifier |
| entityId (SK) | String | Entity identifier |
| type | String | Entity type enum |
| lat | Number | Latitude |
| lng | Number | Longitude |
| altitude | Number | Altitude (optional) |
| heading | Number | Direction (optional) |
| speed | Number | Speed m/s (optional) |
| label | String | Display name (optional) |
| icon | String | Icon identifier (optional) |
| color | String | Hex color (optional) |
| status | String | Entity status (optional) |
| team | String | Team identifier (optional) |
| score | Number | Points value (optional) |
| capturedBy | String | Capturer ID (optional) |
| lastUpdate | Number | Unix timestamp ms |
| source | String | Source enum |
| ttl | Number | Unix timestamp for TTL |

### GSI: entityId-index
- PK: entityId
- Projection: ALL
- Use: Cross-event entity lookup

## Frontend Components

### New Files

```
apps/run.gpx/gpx-studio/website/src/lib/
├── stores/
│   └── realtime.ts              # Svelte store for entity state
├── components/
│   └── map/
│       └── realtime-layer/
│           ├── RealtimeLayer.svelte   # Map layer component
│           ├── realtime-layer.ts      # Layer management class
│           └── icons/                  # SVG icons for entity types
└── types/
    └── realtime.ts              # TypeScript interfaces
```

### Svelte Store API

```typescript
// stores/realtime.ts
import { writable, derived } from 'svelte/store';

interface RealtimeEntity {
  id: string;
  type: 'participant' | 'vehicle' | 'checkpoint' | 'objective' | 'poi';
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
  source: 'gps' | 'tracker' | 'manual';
}

interface RealtimeState {
  eventId: string | null;
  entities: Map<string, RealtimeEntity>;
  connected: boolean;
  lastUpdate: number;
}

export const realtimeStore = createRealtimeStore();

// Usage:
// realtimeStore.connect(eventId)
// realtimeStore.disconnect()
// $realtimeStore.entities.get(id)
```

### Mapbox Layer Integration

```typescript
// realtime-layer.ts
export class RealtimeLayer {
  private map: mapboxgl.Map;
  private sourceId = 'realtime-entities';

  constructor(map: mapboxgl.Map) {
    this.map = map;
    this.setupSource();
    this.setupLayers();
  }

  updateEntities(entities: Map<string, RealtimeEntity>) {
    const geojson = this.entitiesToGeoJSON(entities);
    (this.map.getSource(this.sourceId) as mapboxgl.GeoJSONSource)
      .setData(geojson);
  }

  private entitiesToGeoJSON(entities: Map<string, RealtimeEntity>): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: Array.from(entities.values()).map(e => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [e.lng, e.lat] },
        properties: { ...e }
      }))
    };
  }
}
```

## Security Considerations

### Authentication
- Position updates require valid session (POST /api/realtime/position)
- SSE streams can be public or auth-gated per event configuration
- Admin endpoints require `gpx:admin` service claim

### Data Validation
- Coordinates validated (-90<=lat<=90, -180<=lng<=180)
- Entity type must be valid enum value
- User can only update their own participant entity
- Admins can update any entity

### Rate Limiting
- Position updates: 1/second soft limit (batching)
- SSE connections: 10 per user per event
- Admin operations: standard API rate limits

## Scaling Considerations

### Current Design (Single Instance)
- In-memory RealtimeHub manages SSE connections
- DynamoDB handles persistence
- Suitable for 50-500 concurrent entities, ~1000 viewers

### Future Scaling (Multi-Instance)
- Replace in-memory hub with Redis pub/sub
- Each instance subscribes to event channels
- Position updates published to Redis, broadcast to local SSE connections
- DynamoDB Global Tables for multi-region

## Testing Strategy

### Unit Tests
- Entity validation logic
- GeoJSON conversion
- Store state management

### Integration Tests
- SSE connection/reconnection
- Position update → broadcast flow
- DynamoDB CRUD operations

### E2E Tests
- Connect to event, receive snapshot
- Submit position, see marker appear
- Multiple clients see same state
