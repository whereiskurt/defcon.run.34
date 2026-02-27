# GPX Real-Time Overlay Specification

## ADDED Requirements

### Requirement: Real-Time Entity Model

The system SHALL support a flexible entity model for representing moving objects on the map, including participants, vehicles, checkpoints, objectives, and points of interest.

#### Scenario: Entity data structure
- **WHEN** a real-time entity is created or updated
- **THEN** the entity contains:
  - `id` (string): Unique identifier
  - `type` (enum): 'participant' | 'vehicle' | 'checkpoint' | 'objective' | 'poi'
  - `eventId` (string): Event/session identifier
  - `lat` (number): Latitude in decimal degrees
  - `lng` (number): Longitude in decimal degrees
  - `altitude` (number, optional): Altitude in meters
  - `heading` (number, optional): Direction of travel in degrees (0-360)
  - `speed` (number, optional): Speed in meters per second
  - `label` (string, optional): Display name/callsign
  - `icon` (string, optional): Icon identifier
  - `color` (string, optional): Hex color code
  - `status` (string, optional): 'active' | 'captured' | 'inactive'
  - `team` (string, optional): Team identifier
  - `score` (number, optional): Points value
  - `capturedBy` (string, optional): Capturing entity ID
  - `lastUpdate` (number): Unix timestamp in milliseconds
  - `source` (enum): 'gps' | 'tracker' | 'manual'

#### Scenario: Entity type differentiation
- **WHEN** entities are rendered on the map
- **THEN** different entity types display with distinct default icons and behaviors:
  - `participant`: Person icon, trails enabled
  - `vehicle`: Vehicle icon, heading-oriented
  - `checkpoint`: Flag icon, stationary, can be captured
  - `objective`: Target icon, may move, game-controlled
  - `poi`: Pin icon, informational only

---

### Requirement: Position Update API

The system SHALL provide a REST API for authenticated clients to submit position updates.

#### Scenario: Submit position update
- **WHEN** an authenticated client POSTs to `/api/realtime/position`
- **WITH** body: `{ eventId, lat, lng, altitude?, heading?, speed?, label?, icon?, color?, status?, team? }`
- **THEN** the system validates the request
- **AND** creates or updates the entity in DynamoDB
- **AND** broadcasts the update to all connected SSE clients for that event
- **AND** returns HTTP 200 with the updated entity

#### Scenario: Position update authentication
- **WHEN** a position update request is received
- **THEN** the system validates the user's session
- **AND** uses the authenticated user's ID as the entity ID (for participant type)
- **AND** rejects unauthenticated requests with HTTP 401

#### Scenario: Position update validation
- **WHEN** a position update contains invalid coordinates
- **THEN** the system returns HTTP 400 with error details
- **AND** does NOT broadcast the invalid update

#### Scenario: Rate limiting
- **WHEN** a client submits position updates faster than 1 per second
- **THEN** the system accepts the update but may batch broadcasts
- **AND** does NOT return an error (client may have valid reasons)

---

### Requirement: SSE Event Stream

The system SHALL provide a Server-Sent Events endpoint for real-time position broadcasts.

#### Scenario: Connect to event stream
- **WHEN** a client connects to `/api/realtime/events/[eventId]`
- **THEN** the system establishes an SSE connection
- **AND** immediately sends a `snapshot` event with all current entities for that event
- **AND** keeps the connection open for subsequent updates

#### Scenario: Receive position update
- **WHEN** an entity position is updated
- **THEN** all connected SSE clients for that event receive an `update` event
- **AND** the event data contains the full updated entity object
- **AND** clients receive updates within 1 second of submission

#### Scenario: Entity removal
- **WHEN** an entity is removed (TTL expiry, explicit delete, or disconnect)
- **THEN** connected clients receive a `remove` event with the entity ID
- **AND** clients remove the entity from their map display

#### Scenario: Connection keepalive
- **WHEN** an SSE connection is idle for 30 seconds
- **THEN** the server sends a `:ping` comment to keep the connection alive
- **AND** prevents proxy/CDN timeouts

#### Scenario: Reconnection
- **WHEN** an SSE connection is lost and the client reconnects
- **THEN** the client receives a fresh `snapshot` event
- **AND** resumes receiving updates without missing state

---

### Requirement: Event Snapshot API

The system SHALL provide a REST endpoint to retrieve the current state of all entities for an event.

#### Scenario: Get event snapshot
- **WHEN** a client GETs `/api/realtime/snapshot/[eventId]`
- **THEN** the system queries DynamoDB for all entities with that eventId
- **AND** returns an array of entity objects
- **AND** filters out entities with `lastUpdate` older than TTL threshold

#### Scenario: Empty event
- **WHEN** no entities exist for an eventId
- **THEN** the system returns an empty array
- **AND** returns HTTP 200 (not 404)

---

### Requirement: Entity Storage

The system SHALL persist entity positions in DynamoDB with automatic TTL cleanup.

#### Scenario: DynamoDB table schema
- **WHEN** the realtime entities table is created
- **THEN** it uses:
  - Partition key: `eventId` (String)
  - Sort key: `entityId` (String)
  - TTL attribute: `ttl` (Number) - Unix timestamp for auto-deletion
  - GSI: `entityId-index` for cross-event entity lookup

#### Scenario: Entity TTL
- **WHEN** an entity is created or updated
- **THEN** the `ttl` attribute is set to `lastUpdate + 3600` (1 hour default)
- **AND** DynamoDB automatically deletes expired entities
- **AND** expired entities trigger `remove` events before deletion

#### Scenario: Entity persistence
- **WHEN** a position update is received
- **THEN** the system upserts the entity in DynamoDB
- **AND** updates the `lastUpdate` and `ttl` fields
- **AND** the entity survives server restarts

---

### Requirement: Realtime Map Layer

The system SHALL render real-time entities as an overlay layer on the Mapbox map.

#### Scenario: Layer initialization
- **WHEN** the map loads with an active event
- **THEN** the system creates a `realtime-entities` GeoJSON source
- **AND** creates symbol and circle layers for entity rendering
- **AND** the layer appears above GPX tracks but below UI controls

#### Scenario: Entity rendering
- **WHEN** an entity update is received
- **THEN** the system updates the GeoJSON source data
- **AND** Mapbox re-renders the affected markers
- **AND** the visual update appears within one animation frame (~16ms)

#### Scenario: Entity styling
- **WHEN** entities are rendered
- **THEN** markers display:
  - Icon based on entity type (or custom icon if specified)
  - Color from entity color field (or default by type)
  - Rotation based on heading (for vehicles)
  - Label below marker if label field is set
  - Opacity reduced for stale entities (>60s since update)

#### Scenario: Entity interaction
- **WHEN** a user clicks on an entity marker
- **THEN** a popup displays entity details (label, status, last update)
- **AND** optionally shows recent track trail for moving entities

#### Scenario: Clustering (optional)
- **WHEN** many entities are in close proximity at low zoom levels
- **THEN** the system may cluster markers to prevent visual clutter
- **AND** cluster icons show the count of entities
- **AND** clicking a cluster zooms to show individual entities

---

### Requirement: Realtime Store

The system SHALL maintain a Svelte store for real-time entity state management.

#### Scenario: Store initialization
- **WHEN** the realtime feature is enabled for an event
- **THEN** the store connects to the SSE endpoint
- **AND** initializes with the snapshot data
- **AND** begins receiving live updates

#### Scenario: Store state
- **WHEN** the store is active
- **THEN** it maintains:
  - `entities`: Map<entityId, Entity>
  - `eventId`: Current event ID
  - `connected`: Boolean connection status
  - `lastUpdate`: Timestamp of most recent update

#### Scenario: Store cleanup
- **WHEN** the user navigates away or disables realtime
- **THEN** the store closes the SSE connection
- **AND** clears the entity map
- **AND** releases resources

---

### Requirement: Admin Entity Management

The system SHALL allow authorized users to create and manage game entities (checkpoints, objectives).

#### Scenario: Create game entity
- **WHEN** an admin POSTs to `/api/realtime/admin/entity`
- **WITH** body including type: 'checkpoint' | 'objective'
- **THEN** the system creates the entity at the specified location
- **AND** broadcasts the new entity to all connected clients

#### Scenario: Move game entity
- **WHEN** an admin PUTs to `/api/realtime/admin/entity/[id]`
- **WITH** new lat/lng coordinates
- **THEN** the system updates the entity position
- **AND** broadcasts the movement to all clients

#### Scenario: Remove game entity
- **WHEN** an admin DELETEs `/api/realtime/admin/entity/[id]`
- **THEN** the system removes the entity from DynamoDB
- **AND** broadcasts a `remove` event to all clients

#### Scenario: Admin authorization
- **WHEN** an admin request is received
- **THEN** the system checks for `gpx:admin` service claim
- **AND** rejects unauthorized requests with HTTP 403

---

### Requirement: Event Management

The system SHALL support creating and managing events that group real-time entities.

#### Scenario: Create event
- **WHEN** an admin POSTs to `/api/realtime/admin/event`
- **WITH** body: `{ name, startTime?, endTime?, bounds? }`
- **THEN** the system creates an event record
- **AND** returns the generated eventId

#### Scenario: List events
- **WHEN** a user GETs `/api/realtime/events`
- **THEN** the system returns a list of active events
- **AND** includes event name, participant count, and time range

#### Scenario: Event cleanup
- **WHEN** an event's endTime passes
- **THEN** the system marks the event as archived
- **AND** stops accepting new position updates
- **AND** entity TTLs expire normally

---

## Infrastructure Requirements

### Requirement: DynamoDB Realtime Table

The system SHALL create a DynamoDB table for storing real-time entity positions.

#### Scenario: Table creation
- **WHEN** infrastructure is deployed
- **THEN** a `dc34-realtime-entities` table is created
- **WITH** on-demand capacity mode
- **AND** TTL enabled on the `ttl` attribute
- **AND** encryption at rest enabled

#### Scenario: Global table (future)
- **WHEN** multi-region real-time is needed
- **THEN** the table can be converted to a Global Table
- **AND** entities replicate across regions automatically
