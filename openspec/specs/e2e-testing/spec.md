# e2e-testing Specification

## Purpose
End-to-end testing infrastructure for defcon.run applications using Playwright. Tests verify authentication flows, cloud storage operations, multi-user sharing, and UI interactions.

## Requirements

### Requirement: Unified Test Orchestration
The system SHALL provide a unified orchestrator (`apps/e2e.sh`) that runs auth tests first, then GPX tests.

#### Scenario: Full suite execution
- **WHEN** `./e2e.sh` is run
- **THEN** auth credential acquisition runs first
- **AND** GPX cloud storage tests run after
- **AND** test cleanup is performed

#### Scenario: Selective execution
- **WHEN** `./e2e.sh --gpx` is run
- **THEN** only GPX tests execute (assumes auth sessions exist)

### Requirement: Session Reuse
The system SHALL persist authenticated sessions as cookie jars to avoid repeated logins.

#### Scenario: Valid session exists
- **WHEN** a cookie jar exists in `run.auth/e2e/.auth/` and is not expired
- **THEN** skip login and reuse the existing session

#### Scenario: Session expired or missing
- **WHEN** no valid cookie jar exists
- **THEN** perform full OIDC login flow with ALTCHA solving and S3 email retrieval

### Requirement: Multi-User Testing
The system SHALL support three test accounts via email +addressing for inter-user interaction testing.

#### Scenario: Three user accounts
- **GIVEN** accounts: accounta, accountb, accountc (jeanclaude+account{a,b,c}@defcon.run)
- **WHEN** multi-user tests run
- **THEN** each account has independent sessions and data

#### Scenario: Private share between users
- **WHEN** accountb creates a private share
- **AND** accountc accesses the share URL
- **THEN** accountc can view the shared content

### Requirement: Auth Service Tests
The system SHALL verify OIDC authentication flows, session validity, and service access.

#### Scenario: Credential acquisition
- **WHEN** acquire-credentials runs
- **THEN** it completes full OIDC login with email OTP via S3 email retrieval

#### Scenario: Session validation
- **WHEN** session-valid tests run
- **THEN** stored sessions are verified as active

#### Scenario: Service access verification
- **WHEN** service-access tests run
- **THEN** the authenticated user can access protected services

### Requirement: GPX Cloud Storage Tests
The system SHALL verify cloud storage UI operations and API endpoints.

#### Scenario: Cloud storage UI tests
- **WHEN** cloud storage UI tests run
- **THEN** dialog opening, file operations, and share link generation are verified

#### Scenario: Cloud storage API tests
- **WHEN** API tests run
- **THEN** file listing, folder listing, upload, and share creation are verified

### Requirement: Test Data Cleanup
The system SHALL clean up test data (files with `e2e-` prefix) after each run.

#### Scenario: E2E file cleanup
- **WHEN** test suite completes
- **THEN** all files with `e2e-` prefix are deleted via UI and API

### Requirement: Production and Local Support
The system SHALL run against both local dev and production environments.

#### Scenario: Local development
- **WHEN** `./e2e.sh` runs without `--prod`
- **THEN** tests target localhost (auth:3002, gpx:3003)

#### Scenario: Production
- **WHEN** `./e2e.sh --prod` runs
- **THEN** tests target auth.defcon.run and gpx.defcon.run
- **AND** regional prefix is applied (default: use1, configurable via REGION_SHORT)

### Requirement: CI Integration
The system SHALL support GitHub Actions via `.github/workflows/e2e-tests.yml` (manual dispatch only).

#### Scenario: CI execution
- **WHEN** workflow_dispatch is triggered
- **THEN** tests run against production with AWS OIDC authentication for S3 email access

## Implementation Notes

### Test Location
```
apps/e2e.sh                         # Unified orchestrator
apps/run.auth/e2e/
  setup/acquire-credentials.spec.ts  # OIDC login flow
  setup/cleanup-test-users.spec.ts   # Test cleanup
  tests/session-valid.spec.ts        # Session verification
  tests/service-access.spec.ts       # Service access checks
  lib/{cookie-jar,altcha-solver,s3-email}.ts
apps/run.gpx/e2e/
  cloud-storage.spec.ts              # Cloud storage tests
  lib/cookie-jar.ts                  # Session loading from auth
```

### Key Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_URL` | `http://localhost:3002` | Auth service URL |
| `BASE_URL` | `http://localhost:3003` | GPX service URL |
| `REGION_SHORT` | `use1` | Region prefix for production |
| `TEST_USER_ROLE` | `accounta` | Test user account |
