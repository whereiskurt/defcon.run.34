# GPX Studio Service Specification

## ADDED Requirements

### Requirement: GPX Studio Web Application

The system SHALL provide a web-based GPX editing application at `gpxstudio.defcon.run` that allows authenticated users to create, edit, and manage GPX files for route planning.

#### Scenario: User accesses GPX Studio
- **WHEN** an authenticated user with `gpxstudio` service claim navigates to `gpxstudio.defcon.run`
- **THEN** the system displays the GPX Studio editor interface with map and editing tools

#### Scenario: Unauthenticated user access
- **WHEN** an unauthenticated user navigates to `gpxstudio.defcon.run`
- **THEN** the system redirects to auth.defcon.run for OIDC authentication
- **AND** after successful authentication, redirects back to GPX Studio

#### Scenario: User without service claim access
- **WHEN** an authenticated user without `gpxstudio` in their services claim navigates to `gpxstudio.defcon.run`
- **THEN** the system displays an access denied page
- **AND** the page explains that `gpxstudio` service access is required

---

### Requirement: OIDC Authentication Integration

The GPX Studio service SHALL authenticate users via OIDC through auth.defcon.run using the `gpxstudio` OIDC client.

#### Scenario: OIDC login flow
- **WHEN** a user initiates login at GPX Studio
- **THEN** the system redirects to auth.defcon.run authorization endpoint
- **AND** requests scopes: `openid profile email services`
- **AND** uses redirect_uri: `https://gpxstudio.defcon.run/api/auth/callback/run.defcon.run`

#### Scenario: Service claim extraction
- **WHEN** the OIDC callback returns user claims
- **THEN** the system extracts the `services` array from the claims
- **AND** stores the services in the user session

#### Scenario: Session persistence
- **WHEN** a user completes OIDC authentication
- **THEN** the system creates a secure session cookie
- **AND** the session persists across page reloads
- **AND** the session expires according to OIDC token lifetime

---

### Requirement: Service Claim Authorization

The GPX Studio service SHALL enforce authorization based on the `gpxstudio` service claim in the user's OIDC token.

#### Scenario: API request with valid service claim
- **WHEN** an authenticated user with `gpxstudio` service claim makes an API request
- **THEN** the system processes the request normally

#### Scenario: API request without service claim
- **WHEN** an authenticated user without `gpxstudio` service claim makes an API request
- **THEN** the system returns HTTP 403 Forbidden
- **AND** the response body contains an error message indicating missing service access

#### Scenario: Service claim revocation
- **WHEN** a user's `gpxstudio` service claim is removed from their profile
- **THEN** the user's existing sessions continue until token refresh
- **AND** upon token refresh, the user loses access to GPX Studio

---

### Requirement: GPX File Storage

The system SHALL store user GPX files in S3 with user-isolated prefixes to ensure data separation between users.

#### Scenario: Save new GPX file
- **WHEN** a user saves a new GPX file in the editor
- **THEN** the system generates a presigned S3 PUT URL
- **AND** the client uploads the GPX content directly to S3
- **AND** the file is stored at `uploads/{userId}/gpx/{fileId}.gpx`
- **AND** a metadata record is created in DynamoDB

#### Scenario: Load existing GPX file
- **WHEN** a user requests to load an existing GPX file
- **THEN** the system generates a presigned S3 GET URL
- **AND** the client downloads the GPX content directly from S3
- **AND** the file is loaded into the editor

#### Scenario: List user's GPX files
- **WHEN** a user requests their file list
- **THEN** the system queries DynamoDB for files where userId matches the authenticated user
- **AND** returns file metadata including name, size, and last modified date
- **AND** does NOT return files belonging to other users

#### Scenario: Delete GPX file
- **WHEN** a user deletes a GPX file
- **THEN** the system deletes the file from S3
- **AND** the system deletes the metadata record from DynamoDB
- **AND** the file is no longer accessible

---

### Requirement: User Data Isolation

The system SHALL ensure complete data isolation between users, preventing any user from accessing another user's GPX files.

#### Scenario: S3 key isolation
- **WHEN** generating S3 keys for file operations
- **THEN** the key MUST include the authenticated user's ID in the path prefix
- **AND** the format MUST be `uploads/{userId}/gpx/{fileId}.gpx`

#### Scenario: Presigned URL scope
- **WHEN** generating presigned S3 URLs
- **THEN** the URL MUST only grant access to objects within the user's prefix
- **AND** the S3 object MUST be tagged with `owner={userId}`

#### Scenario: Cross-user access attempt
- **WHEN** a user attempts to access a file with a different user's prefix
- **THEN** the system MUST reject the request
- **AND** return HTTP 403 Forbidden

---

### Requirement: GPX File Metadata

The system SHALL track metadata for each GPX file to enable efficient file management and search.

#### Scenario: Metadata extraction on save
- **WHEN** a GPX file is saved
- **THEN** the system extracts and stores:
  - File name (user-provided)
  - File size in bytes
  - Track count
  - Waypoint count
  - Total distance (meters)
  - Total elevation gain (meters)
  - Geographic bounds (minLat, maxLat, minLon, maxLon)
  - Created timestamp
  - Updated timestamp

#### Scenario: Metadata query
- **WHEN** listing user files
- **THEN** the system returns metadata for each file
- **AND** supports filtering by file type and date range

---

### Requirement: GPX Composition Management

The system SHALL support multi-file compositions (projects) that group related GPX files together.

#### Scenario: Create composition
- **WHEN** a user creates a new composition
- **THEN** the system creates a composition record in DynamoDB
- **AND** the composition can contain references to multiple GPX files
- **AND** the composition stores editor state (view settings, layer visibility)

#### Scenario: Save composition state
- **WHEN** a user saves their editor state
- **THEN** the system serializes the composition state as JSON
- **AND** stores it at `uploads/{userId}/compositions/{compositionId}.json`

#### Scenario: Load composition
- **WHEN** a user opens a composition
- **THEN** the system loads the composition state
- **AND** loads all referenced GPX files
- **AND** restores editor state

---

### Requirement: Mapbox Token Management (Hybrid Default + BYOK)

The system SHALL provide a default Mapbox token for immediate access while allowing users to optionally provide their own token for cost ownership.

#### Scenario: User without personal Mapbox token accesses GPX Studio
- **WHEN** a user with `gpxstudio` service but no personal Mapbox token navigates to GPX Studio
- **THEN** the system uses the default `MAPBOX_DEFAULT_TOKEN` from environment
- **AND** initializes Mapbox GL with the default token
- **AND** the application loads without requiring additional setup

#### Scenario: User with personal Mapbox token accesses GPX Studio
- **WHEN** a user with a personal `mapboxPublicToken` in their profile loads GPX Studio
- **THEN** the system uses the user's personal token instead of the default
- **AND** initializes Mapbox GL with the user's token
- **AND** all Mapbox API usage is billed to the user's Mapbox account

#### Scenario: Token resolution order
- **WHEN** the system resolves which Mapbox token to use
- **THEN** it first checks for `mapboxPublicToken` in the user's AuthProfile
- **AND** if present and non-empty, uses the user's token
- **AND** if not present, falls back to `MAPBOX_DEFAULT_TOKEN` environment variable

#### Scenario: User enters personal Mapbox token in profile
- **WHEN** a user enters a token in the Mapbox Token field in profile settings
- **THEN** the system validates the token format (must start with `pk.`)
- **AND** rejects secret tokens (starting with `sk.`) with a clear error
- **AND** tests the token by making a Mapbox API call
- **AND** saves the token to the user's profile if validation passes
- **AND** displays a specific error message if validation fails

#### Scenario: User's personal Mapbox token becomes invalid
- **WHEN** a user's previously valid personal token is revoked or expires
- **THEN** the system detects the failure when initializing Mapbox GL
- **AND** displays an error suggesting to update or remove the token
- **AND** offers option to fall back to default token by clearing personal token

#### Scenario: User removes personal Mapbox token
- **WHEN** a user clears their personal Mapbox token from profile settings
- **THEN** the system removes the token from their AuthProfile
- **AND** subsequent GPX Studio loads use the default token

#### Scenario: Token storage security
- **WHEN** a Mapbox public token is stored
- **THEN** the token is stored in the AuthProfile entity in DynamoDB
- **AND** the token is encrypted at rest via DynamoDB encryption
- **AND** the token is NEVER logged in application logs

---

### Requirement: Profile API Keys Section

The system SHALL provide a section in user profile settings for managing API keys including Mapbox tokens.

#### Scenario: View API keys section
- **WHEN** a user navigates to profile settings
- **THEN** the system displays an "API Keys" or "Integrations" section
- **AND** shows the Mapbox token field (masked except last 4 characters)
- **AND** shows token validation status (valid/invalid/not set)

#### Scenario: Update Mapbox token
- **WHEN** a user submits a new Mapbox token
- **THEN** the system validates the token before saving
- **AND** updates the token in AuthProfile if valid
- **AND** the new token is used on next GPX Studio load

#### Scenario: Remove Mapbox token
- **WHEN** a user clears their Mapbox token
- **THEN** the system removes the token from their profile
- **AND** the user can no longer access GPX Studio until they provide a new token

---

### Requirement: Health Check Endpoint

The system SHALL provide a health check endpoint for load balancer monitoring.

#### Scenario: Health check success
- **WHEN** the load balancer requests `/api/health`
- **THEN** the system returns HTTP 200
- **AND** the response includes service status

#### Scenario: Health check failure
- **WHEN** the application has critical errors (database unavailable, etc.)
- **THEN** the `/api/health` endpoint returns HTTP 503
- **AND** ECS marks the task as unhealthy

---

### Requirement: Multi-Region Deployment

The system SHALL support multi-region deployment with S3 cross-region replication for data availability.

#### Scenario: S3 replication
- **WHEN** a file is uploaded to the primary region bucket
- **THEN** S3 automatically replicates the file to the secondary region bucket
- **AND** replication completes within the S3 replication SLA

#### Scenario: Regional failover
- **WHEN** the primary region is unavailable
- **THEN** users can access their files from the secondary region bucket
- **AND** CloudFront routes requests to the healthy region

---

### Requirement: Logout Flow

The system SHALL support user logout with proper session cleanup.

#### Scenario: User initiated logout
- **WHEN** a user clicks the logout button
- **THEN** the system clears the local session cookie
- **AND** redirects to auth.defcon.run logout endpoint
- **AND** auth.defcon.run clears the SSO session
- **AND** the user is redirected back to gpxstudio.defcon.run landing page

---

## Infrastructure Requirements

### Requirement: Container Deployment

The system SHALL deploy as a containerized application on AWS ECS Fargate.

#### Scenario: Container startup
- **WHEN** ECS starts a new task
- **THEN** the container starts the Next.js application
- **AND** the health check passes within 60 seconds
- **AND** the container is registered with the target group

#### Scenario: Container resources
- **WHEN** the container runs
- **THEN** it uses the configured CPU (512 units) and memory (1024 MB)
- **AND** scales based on load if autoscaling is enabled

---

### Requirement: CloudFront Distribution

The system SHALL serve traffic through CloudFront for global performance and SSL termination.

#### Scenario: HTTPS access
- **WHEN** a user accesses gpxstudio.defcon.run
- **THEN** CloudFront terminates SSL
- **AND** forwards requests to the ALB origin

#### Scenario: Static asset caching
- **WHEN** static assets (JS, CSS, images) are requested
- **THEN** CloudFront caches the responses
- **AND** serves cached responses to subsequent requests

---

### Requirement: ALB Integration

The system SHALL route traffic through Application Load Balancer for health checking and target group management.

#### Scenario: ALB routing
- **WHEN** CloudFront forwards a request
- **THEN** ALB routes based on Host header: `gpxstudio.defcon.run`
- **AND** forwards to healthy ECS tasks

#### Scenario: Health check monitoring
- **WHEN** ALB performs health checks
- **THEN** it requests `/api/health` on port 3000
- **AND** marks targets healthy with 2 consecutive successful responses
- **AND** marks targets unhealthy with 3 consecutive failed responses
