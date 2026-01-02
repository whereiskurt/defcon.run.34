# human-auth Specification

## Purpose
TBD - created by archiving change add-human-silent-sso. Update Purpose after archive.
## Requirements
### Requirement: Silent SSO with auth.defcon.run
The run.human application SHALL automatically authenticate users who have an active session at auth.defcon.run.

#### Scenario: Automatic authentication when auth session exists
- **GIVEN** a user has an active session at auth.defcon.run (sess_auth cookie present)
- **WHEN** the user visits run.defcon.run without an active run.human session
- **THEN** the system validates the auth session via server-to-server call
- **AND** if valid, automatically initiates the OIDC authentication flow
- **AND** the user lands on the dashboard without clicking a sign-in button

#### Scenario: Normal login flow when no auth session
- **GIVEN** a user does NOT have an active session at auth.defcon.run
- **WHEN** the user visits run.defcon.run without an active run.human session
- **THEN** the login page is displayed
- **AND** the user must click the sign-in button to authenticate

#### Scenario: Direct dashboard access with existing session
- **GIVEN** a user has an active run.human session (sess_run cookie present)
- **WHEN** the user visits the public page (/)
- **THEN** the user is redirected to /dashboard
- **AND** no silent SSO check is performed

### Requirement: Server-to-Server Token Validation
The run.auth service SHALL provide an internal API for validating sess_auth tokens.

#### Scenario: Valid token validation
- **GIVEN** a valid sess_auth JWT token
- **WHEN** run.human calls POST /api/session/validate/token with the token
- **AND** includes the correct X-Internal-Secret header
- **THEN** the response indicates valid: true
- **AND** includes user information (id, email, name)

#### Scenario: Invalid token rejection
- **GIVEN** an invalid or expired sess_auth JWT token
- **WHEN** run.human calls POST /api/session/validate/token with the token
- **THEN** the response indicates valid: false
- **AND** includes an error code (invalid_token, expired, etc.)

#### Scenario: Unauthorized request rejection
- **GIVEN** a request without a valid X-Internal-Secret header
- **WHEN** the validation endpoint is called
- **THEN** the response is 401 Unauthorized
- **AND** indicates error: "unauthorized"

### Requirement: Regional URL Support for Silent SSO
The silent SSO flow SHALL work correctly with regional URL prefixes.

#### Scenario: Production environment with regional prefix
- **GIVEN** the application is deployed with regional prefix (e.g., /use1)
- **WHEN** silent SSO redirects to the auto-signin route
- **THEN** the redirect URL includes the regional prefix
- **AND** the callback URL includes the regional prefix

#### Scenario: Development environment without prefix
- **GIVEN** the application is running in development mode
- **WHEN** silent SSO redirects to the auto-signin route
- **THEN** no regional prefix is used in URLs

### Requirement: Infinite Loop Prevention
The silent SSO check SHALL not cause infinite redirect loops.

#### Scenario: Prevent re-checking on auto-signin routes
- **GIVEN** a user is being redirected to /api/auth/auto-signin
- **WHEN** the request is processed by the public layout
- **THEN** the silent SSO check is skipped
- **AND** the auto-signin route is allowed to complete

#### Scenario: Prevent re-checking when autoLogin flag present
- **GIVEN** a request URL contains autoLogin=true parameter
- **WHEN** the public layout processes the request
- **THEN** the silent SSO check is skipped

