# MQTT Mesh Network Specification

**Status:** Draft
**Change:** add-mqtt-mesh-service

## ADDED Requirements

### Requirement: MQTT Proxy Service
The system SHALL provide an MQTT reverse proxy (meshtk) that sits in front of the mosquitto broker, performing deep packet inspection, rate limiting, and configurable output hooks on all Meshtastic mesh traffic.

#### Scenario: MQTT client connects through proxy
- **WHEN** an MQTT client connects to mqtt.defcon.run on port 1883 or 8883
- **THEN** the connection is accepted by meshtk proxy
- **AND** meshtk inspects the CONNECT packet for valid credentials
- **AND** meshtk forwards the connection to mosquitto on internal port 1884
- **AND** all subsequent PUBLISH packets are inspected and decoded

#### Scenario: Rate limiting enforced
- **WHEN** a client exceeds the configured rate limit (tokens per second)
- **THEN** meshtk applies a socket penalty delay
- **AND** if the client continues to exceed limits, the connection is terminated

#### Scenario: Blocked packet
- **WHEN** a packet matches a block rule in the decider
- **THEN** the packet is not forwarded to mosquitto
- **AND** the block decision is logged

### Requirement: Configurable Output Hooks
The system SHALL support pluggable output hooks that receive enriched packet data after inspection. Hooks SHALL be configurable via YAML and environment variables, disabled by default, and non-blocking to the proxy hot path.

#### Scenario: SQS hook publishes packet data
- **WHEN** SQS hook is enabled and a packet passes inspection
- **THEN** the enriched packet data (connection info, decoded Meshtastic payload, decision) is published to the configured SQS queue
- **AND** publishing is asynchronous via buffered channel and batch API calls
- **AND** if the buffer is full, the message is dropped without blocking the proxy

#### Scenario: HTTP hook serves node positions
- **WHEN** HTTP hook is enabled
- **THEN** meshtk serves a REST API on the configured listen address
- **AND** `GET /api/nodes` returns a GeoJSON FeatureCollection of all known nodes
- **AND** `GET /api/health` returns 200 OK for liveness probes

#### Scenario: Hook filtering
- **WHEN** a hook has PortNum or Decision filters configured
- **THEN** only packets matching the filter criteria are sent to that hook
- **AND** an empty filter list means all packets are sent

### Requirement: NodeDB Tracking
The system SHALL maintain an in-memory database of known mesh nodes, updated from POSITION_APP and MAP_REPORT_APP packets flowing through the proxy.

#### Scenario: Node position updated
- **WHEN** a POSITION_APP or MAP_REPORT_APP packet is decoded by the proxy
- **THEN** the node's position (latitude, longitude, altitude, precision) is updated in the NodeDB
- **AND** the node's last-seen timestamp is updated

#### Scenario: Stale node pruning
- **WHEN** a node has not been seen within the configured TTL
- **THEN** the node is removed from the NodeDB

### Requirement: Cross-Region MQTT Bridge
The system SHALL support mosquitto broker-to-broker bridging across AWS regions so that mesh messages published in one region are available in all regions.

#### Scenario: Message bridged across regions
- **WHEN** a Meshtastic packet is published to mosquitto in us-east-1
- **THEN** the packet is replicated to mosquitto in ca-central-1 via the bridge connection
- **AND** subscribers in ca-central-1 receive the packet

#### Scenario: Bridge reconnection
- **WHEN** the bridge connection between regions is interrupted
- **THEN** mosquitto automatically reconnects after the configured retry interval

### Requirement: NLB Multi-Protocol Access
The system SHALL expose MQTT services via a Network Load Balancer supporting multiple protocols on dedicated ports.

#### Scenario: Raw MQTT access
- **WHEN** a client connects to mqtt.defcon.run on port 1883
- **THEN** the connection is forwarded to meshtk proxy via TCP with Proxy Protocol v2

#### Scenario: TLS MQTT access
- **WHEN** a client connects to mqtt.defcon.run on port 8883
- **THEN** TLS is terminated at the NLB using the mqtt.defcon.run ACM certificate
- **AND** the decrypted connection is forwarded to meshtk proxy

#### Scenario: WebSocket MQTT access
- **WHEN** a client connects to mqtt.defcon.run on port 8443
- **THEN** TLS is terminated at the NLB
- **AND** the WebSocket connection is forwarded to mosquitto on port 9001

### Requirement: Mesh Map Overlay
The system SHALL display live mesh node positions as an interactive overlay on the gpx.studio map in run.gpx.

#### Scenario: Nodes rendered on map
- **WHEN** a user opens gpx.studio with the mesh overlay enabled
- **THEN** mesh node positions are displayed as markers on the Mapbox GL map
- **AND** markers include visual indicators for battery level and staleness
- **AND** markers are updated by polling the mesh nodes API

#### Scenario: Node popup details
- **WHEN** a user clicks on a mesh node marker
- **THEN** a popup displays node details including name, hardware model, battery, signal strength, temperature, altitude, and last seen time

### Requirement: Radio Provisioning
The system SHALL provide a web-based provisioning experience for attendees to configure their Meshtastic radios for the event mesh network.

#### Scenario: Web Serial one-click configuration
- **WHEN** an authenticated user connects their radio via USB and clicks "Configure"
- **THEN** the system writes the event configuration to the radio (channels, LoRa settings, MQTT credentials, device name) using the Meshtastic Web Serial API
- **AND** the configuration includes per-user MQTT credentials generated from their auth identity

#### Scenario: Channel URL generation
- **WHEN** an authenticated user requests a channel URL or QR code
- **THEN** the system generates a Meshtastic channel URL encoding the event channels and LoRa settings
- **AND** the URL is displayed as both a clickable link and a scannable QR code

#### Scenario: Config YAML download
- **WHEN** an authenticated user requests a configuration download
- **THEN** the system generates a YAML file compatible with `meshtastic --configure`
- **AND** the file includes per-user MQTT credentials, event channels, and LoRa settings

#### Scenario: Firmware image download
- **WHEN** an authenticated user selects their hardware model and requests a firmware download
- **THEN** the system serves a pre-built Meshtastic firmware image with event configuration baked in

### Requirement: Per-User MQTT Identity
The system SHALL generate unique MQTT credentials for each authenticated user, enabling per-user tracking and abuse prevention on the mesh network.

#### Scenario: Identity generation
- **WHEN** a user visits the mesh provisioning page for the first time
- **THEN** a unique mesh identity is generated (node prefix, MQTT username, MQTT password)
- **AND** the identity is stored in DynamoDB
- **AND** subsequent visits return the same identity

#### Scenario: Credential validation
- **WHEN** an MQTT client connects with a per-user username and password
- **THEN** meshtk proxy validates the credentials against the stored identity
- **AND** invalid credentials are rejected

### Requirement: ConfigUI Network Panel
The system SHALL provide a Network panel in ConfigUI for managing the MQTT mesh service configuration.

#### Scenario: Toggle MQTT service
- **WHEN** an admin enables or disables the MQTT toggle in the Network panel
- **THEN** the generated infrastructure configuration includes or excludes the run-mqtt service

#### Scenario: View service status
- **WHEN** an admin views the Status tab in the Network panel
- **THEN** live statistics from the meshtk HTTP hook are displayed (connection count, packet rates, active node count)
