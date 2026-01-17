# Quota Service

**Status:** Draft
**Change:** centralize-quota-service

## ADDED Requirements

### Requirement: Centralized Quota API

run.auth SHALL expose HTTP APIs for quota management that all services can call.

#### Scenario: User checks own quota via session
- **GIVEN** user is authenticated with valid session
- **WHEN** user calls `GET /api/quota/gpx_upload`
- **THEN** response includes remaining, initialAmount, quotaId
- **AND** quota is auto-initialized if not exists

#### Scenario: Backend consumes quota via internal API
- **GIVEN** run.gpx backend has valid X-Internal-Secret
- **WHEN** backend calls `POST /api/internal/quota/{userId}/gpx_upload/consume`
- **THEN** quota is atomically decremented
- **AND** response includes success status and remaining count

#### Scenario: Backend restores quota on failure
- **GIVEN** upload validation failed after quota consumed
- **WHEN** backend calls `POST /api/internal/quota/{userId}/gpx_upload/restore`
- **THEN** quota is incremented (capped at initialAmount)
- **AND** response confirms restoration

### Requirement: Internal Service URLs

Backend services SHALL use internal DNS names for quota API calls.

#### Scenario: Backend uses internal URL
- **GIVEN** run.gpx needs to consume quota
- **WHEN** making quota API call
- **THEN** URL is `https://auth.app-{region}-defcon-run.local/api/internal/...`
- **AND** NOT `https://auth.defcon.run/api/internal/...`

#### Scenario: Development uses localhost
- **GIVEN** running in development mode
- **WHEN** making quota API call
- **THEN** URL is `http://localhost:3002/api/internal/...`

### Requirement: X-Internal-Secret Authentication

Service-to-service quota operations SHALL require shared secret authentication.

#### Scenario: Valid internal secret accepted
- **GIVEN** request includes `X-Internal-Secret: <valid-secret>`
- **WHEN** calling internal quota endpoint
- **THEN** request is processed successfully

#### Scenario: Invalid internal secret rejected
- **GIVEN** request has missing or invalid X-Internal-Secret
- **WHEN** calling internal quota endpoint
- **THEN** response is HTTP 401 Unauthorized

#### Scenario: Internal endpoints not accessible via session
- **GIVEN** user has valid session cookie
- **WHEN** calling `/api/internal/quota/{userId}/...`
- **THEN** response is HTTP 401 (session not accepted)

### Requirement: Quota Tier Management

User quota tiers SHALL be stored explicitly on AuthProfile.

#### Scenario: New user gets default tier
- **GIVEN** new user completes registration
- **THEN** AuthProfile.quotaTier is set to "upload"

#### Scenario: Admin upgrades user tier
- **GIVEN** admin calls upgrade-tier endpoint
- **WHEN** newTier is "admin"
- **THEN** AuthProfile.quotaTier updated to "admin"
- **AND** all quota limits increased to admin tier

#### Scenario: Locked out user gets zero tier
- **GIVEN** user account is locked out
- **THEN** AuthProfile.quotaTier is set to "zero"
- **AND** all quota operations return 0 remaining

#### Scenario: Session validation includes tier
- **GIVEN** service calls `/api/session/validate`
- **THEN** response includes `quotaTier` field

### Requirement: Dedicated Quota DynamoDB Table

Quota data SHALL be stored in a separate DynamoDB table.

#### Scenario: Table isolation
- **GIVEN** quota service operates on data
- **THEN** operations use `run-quota` table
- **AND** NOT `run-auth-electro` table

#### Scenario: Table structure
- **GIVEN** quota record is created
- **THEN** primary key is `userId + quotaId`
- **AND** attributes include: remaining, initialAmount, totalConsumed, consumptionCount

### Requirement: Atomic Quota Operations

Quota consumption SHALL be atomic to prevent race conditions.

#### Scenario: Concurrent consume requests
- **GIVEN** two requests try to consume same quota simultaneously
- **WHEN** only 1 quota remains
- **THEN** exactly one request succeeds
- **AND** other request receives 429 (quota exceeded)

#### Scenario: Conditional update failure
- **GIVEN** consume request with amount > remaining
- **WHEN** DynamoDB conditional check fails
- **THEN** response is HTTP 429
- **AND** remaining is unchanged

### Requirement: Quota Definitions API

Quota type definitions SHALL be publicly accessible.

#### Scenario: List all definitions
- **GIVEN** any client (no auth required)
- **WHEN** calling `GET /api/quota/definitions`
- **THEN** response includes all quota types
- **AND** each includes name, limits by tier, resetPolicy

### Requirement: Admin Quota Operations

Administrators SHALL be able to manage user quotas.

#### Scenario: Reset quota to tier limit
- **GIVEN** admin calls reset endpoint
- **THEN** remaining is set to initialAmount

#### Scenario: Set custom VIP limit
- **GIVEN** admin calls set-limit with newLimit=200
- **THEN** initialAmount is updated to 200
- **AND** optionally remaining is reset to 200

#### Scenario: Cleanup stale pending quotas
- **GIVEN** uploads pending for >2 hours without confirmation
- **WHEN** admin calls cleanup endpoint
- **THEN** stale records are identified
- **AND** associated quotas are restored

## MODIFIED Requirements

### Requirement: run.human Quota Usage

run.human SHALL call centralized quota APIs instead of local implementation.

#### Scenario: Upload presign consumes quota
- **GIVEN** user requests upload presign
- **WHEN** run.human processes request
- **THEN** calls `POST /api/internal/quota/{userId}/file_upload/consume`
- **AND** proceeds only if successful

#### Scenario: Quota check in user profile
- **GIVEN** user loads profile page
- **WHEN** run.human fetches user data
- **THEN** calls quota service for quota info
- **AND** displays remaining quotas

### Requirement: Session Validation Response

Session validation SHALL include quota tier information.

#### Scenario: Enhanced session response
- **GIVEN** service calls `/api/session/validate`
- **THEN** response includes existing fields (user, services, etc.)
- **AND** also includes `quotaTier: "zero" | "upload" | "admin"`

## REMOVED Requirements

### Requirement: Local Quota Implementation in run.human

**Reason:** Replaced by centralized quota service in run.auth

#### Scenario: No local quota code
- **GIVEN** quota operations needed in run.human
- **THEN** code calls quota-client HTTP wrapper
- **AND** NOT local quota service functions
