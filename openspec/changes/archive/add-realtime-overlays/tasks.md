# Tasks: Add Real-Time Map Overlays

## Phase 1: Infrastructure

### 1.1 DynamoDB Table
- [ ] 1.1.1 Create Terraform module for realtime-entities table
- [ ] 1.1.2 Configure TTL on `ttl` attribute
- [ ] 1.1.3 Create entityId GSI for cross-event lookups
- [ ] 1.1.4 Add table to Terragrunt configuration
- [ ] 1.1.5 Deploy table to both regions

### 1.2 ElectroDB Entity
- [ ] 1.2.1 Create RealtimeEntity model in run.gpx/webapp/src/lib/db/
- [ ] 1.2.2 Define attributes matching spec (type, lat, lng, heading, etc.)
- [ ] 1.2.3 Add TTL calculation on save
- [ ] 1.2.4 Add CRUD operations (create, get, update, delete, listByEvent)
- [ ] 1.2.5 Add unit tests for entity operations

## Phase 2: Backend API

### 2.1 Position Update Endpoint
- [ ] 2.1.1 Create `/api/realtime/position/route.ts`
- [ ] 2.1.2 Implement POST handler with authentication
- [ ] 2.1.3 Add coordinate validation (lat/lng bounds)
- [ ] 2.1.4 Implement DynamoDB upsert with TTL
- [ ] 2.1.5 Integrate with RealtimeHub for broadcast
- [ ] 2.1.6 Add error handling and response formatting

### 2.2 SSE Events Endpoint
- [ ] 2.2.1 Create `/api/realtime/events/[eventId]/route.ts`
- [ ] 2.2.2 Implement SSE response with proper headers
- [ ] 2.2.3 Send initial snapshot on connect
- [ ] 2.2.4 Implement 30-second keepalive pings
- [ ] 2.2.5 Handle client disconnect cleanup

### 2.3 Snapshot Endpoint
- [ ] 2.3.1 Create `/api/realtime/snapshot/[eventId]/route.ts`
- [ ] 2.3.2 Implement GET handler to fetch all entities for event
- [ ] 2.3.3 Filter out expired entities (TTL check)
- [ ] 2.3.4 Return empty array for unknown events (not 404)

### 2.4 RealtimeHub Service
- [ ] 2.4.1 Create RealtimeHub class for SSE connection management
- [ ] 2.4.2 Implement connection registration/deregistration
- [ ] 2.4.3 Implement broadcast method (event → all connections)
- [ ] 2.4.4 Add connection tracking per event
- [ ] 2.4.5 Implement cleanup on server shutdown

### 2.5 Admin Endpoints
- [ ] 2.5.1 Create `/api/realtime/admin/entity/route.ts` (POST)
- [ ] 2.5.2 Create `/api/realtime/admin/entity/[id]/route.ts` (PUT, DELETE)
- [ ] 2.5.3 Implement admin authorization check (`gpx:admin` claim)
- [ ] 2.5.4 Add entity creation for game objects
- [ ] 2.5.5 Add entity update for position changes
- [ ] 2.5.6 Add entity deletion with broadcast

## Phase 3: Frontend Store

### 3.1 TypeScript Types
- [ ] 3.1.1 Create `types/realtime.ts` with RealtimeEntity interface
- [ ] 3.1.2 Define entity type enum
- [ ] 3.1.3 Define SSE event types (snapshot, update, remove)
- [ ] 3.1.4 Export types for use across components

### 3.2 Realtime Store
- [ ] 3.2.1 Create `stores/realtime.ts` Svelte store
- [ ] 3.2.2 Implement SSE connection with EventSource
- [ ] 3.2.3 Handle snapshot event (initialize entities Map)
- [ ] 3.2.4 Handle update event (upsert entity)
- [ ] 3.2.5 Handle remove event (delete entity)
- [ ] 3.2.6 Implement connect/disconnect methods
- [ ] 3.2.7 Track connection status and lastUpdate
- [ ] 3.2.8 Implement reconnection on connection loss

## Phase 4: Map Layer

### 4.1 Realtime Layer Component
- [ ] 4.1.1 Create `components/map/realtime-layer/RealtimeLayer.svelte`
- [ ] 4.1.2 Create `components/map/realtime-layer/realtime-layer.ts`
- [ ] 4.1.3 Add GeoJSON source for entities
- [ ] 4.1.4 Add symbol layer for markers
- [ ] 4.1.5 Implement entity → GeoJSON conversion
- [ ] 4.1.6 Subscribe to realtimeStore for updates
- [ ] 4.1.7 Call source.setData() on store changes

### 4.2 Entity Icons
- [ ] 4.2.1 Create SVG icons for entity types (participant, vehicle, checkpoint, objective, poi)
- [ ] 4.2.2 Register icons with Mapbox GL
- [ ] 4.2.3 Implement icon selection based on entity type
- [ ] 4.2.4 Support custom icon override via entity.icon field

### 4.3 Entity Styling
- [ ] 4.3.1 Implement color coding by entity type (default colors)
- [ ] 4.3.2 Support custom color via entity.color field
- [ ] 4.3.3 Implement heading-based rotation for vehicles
- [ ] 4.3.4 Add label rendering below markers
- [ ] 4.3.5 Implement opacity fade for stale entities (>60s)

### 4.4 Entity Interaction
- [ ] 4.4.1 Implement click handler for entity markers
- [ ] 4.4.2 Create popup component showing entity details
- [ ] 4.4.3 Display label, status, team, last update in popup
- [ ] 4.4.4 Optional: show recent track trail for moving entities

## Phase 5: Integration

### 5.1 Map Integration
- [ ] 5.1.1 Add RealtimeLayer to Map.svelte
- [ ] 5.1.2 Pass eventId prop for activation
- [ ] 5.1.3 Initialize layer above GPX layers
- [ ] 5.1.4 Handle layer visibility toggle

### 5.2 UI Controls
- [ ] 5.2.1 Add real-time toggle in sidebar/toolbar
- [ ] 5.2.2 Show connection status indicator
- [ ] 5.2.3 Show entity count badge
- [ ] 5.2.4 Add event selector dropdown (if multiple events)

### 5.3 Position Sharing
- [ ] 5.3.1 Add "Share My Location" button
- [ ] 5.3.2 Implement Geolocation API permission request
- [ ] 5.3.3 Start position reporting on enable
- [ ] 5.3.4 Stop reporting on disable or page close
- [ ] 5.3.5 Handle geolocation errors gracefully

## Phase 6: Testing & Documentation

### 6.1 Backend Tests
- [ ] 6.1.1 Unit tests for RealtimeEntity ElectroDB model
- [ ] 6.1.2 Unit tests for coordinate validation
- [ ] 6.1.3 Integration tests for position update → broadcast
- [ ] 6.1.4 Integration tests for SSE connection lifecycle

### 6.2 Frontend Tests
- [ ] 6.2.1 Unit tests for realtimeStore
- [ ] 6.2.2 Unit tests for GeoJSON conversion
- [ ] 6.2.3 Component tests for RealtimeLayer

### 6.3 E2E Tests
- [ ] 6.3.1 Test: connect to event, receive snapshot
- [ ] 6.3.2 Test: submit position, see marker on map
- [ ] 6.3.3 Test: multiple clients see same state
- [ ] 6.3.4 Test: reconnection after disconnect

### 6.4 Documentation
- [ ] 6.4.1 Add real-time overlay documentation to gpxstudio spec
- [ ] 6.4.2 Document API endpoints in AGENTS.md or API docs
- [ ] 6.4.3 Add usage guide for event organizers
