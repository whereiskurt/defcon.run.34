# run.gpx E2E Tests

End-to-end tests for the GPX Cloud Storage features.

## Quick Start

The easiest way to run the full e2e suite is with the helper script:

```bash
# Run full e2e suite (creates sessions, uploads files, runs tests)
./gpxe2e.sh

# Check status of services and sessions
./gpxe2e.sh --status

# Just run tests (assumes setup already done)
./gpxe2e.sh --tests

# Run with visible browser
./gpxe2e.sh --headed

# Clean up test data
./gpxe2e.sh --clean
```

The script handles:
- Installing dependencies
- Creating authenticated sessions for multiple users (accounta, accountb, accountc)
- Uploading sample files to cloud storage
- Running the full test suite

## Prerequisites

1. **Services must be running**:
   ```bash
   # Terminal 1: Auth service
   cd apps/run.auth/webapp && PORT=3002 npm run dev

   # Terminal 2: GPX service
   cd apps/run.gpx/webapp && PORT=3003 npm run dev
   ```

2. **AWS credentials** for email verification (if creating new sessions)

## Manual Setup

If you prefer to run steps manually:

### Install dependencies
```bash
npm install
npx playwright install chromium
```

### Create user sessions

```bash
cd ../../../run.auth/e2e

# Create accounta session (default)
TEST_USER_ROLE=accounta BASE_URL=http://localhost:3002 npm test

# Create accountb session (for share tests - file owner)
TEST_USER_ROLE=accountb BASE_URL=http://localhost:3002 npm test

# Create accountc session (for share tests - share recipient)
TEST_USER_ROLE=accountc BASE_URL=http://localhost:3002 npm test
```

### Run tests

```bash
cd apps/run.gpx/e2e

# Run all tests
BASE_URL=http://localhost:3003 npm test

# Run with visible browser
npm run test:headed

# Debug mode
npm run test:debug
```

## Test Coverage

### Auth & Session Tests

| Test | Description |
|------|-------------|
| `Auth Smoke Test` | Verifies OIDC flow and session establishment |
| `verify authenticated session` | Confirms user is logged in |

### Cloud Storage UI Tests

| Test | Description |
|------|-------------|
| `open Cloud Storage dialog` | Opens the cloud storage dialog |
| `open Save As dialog` | Verifies Save As menu item |
| `open a file from cloud storage` | Loads a file from cloud |
| `select and open multiple files` | Batch opens multiple files |
| `create a public share link` | Creates a public share URL |
| `access a public share link` | Verifies share URL works |

### Multi-User Share Tests

| Test | Description |
|------|-------------|
| `create and access a private share` | accountb shares, accountc accesses |

### Cloud Storage API Tests

| Test | Description |
|------|-------------|
| `list cloud files via API` | GET /api/gpx/files |
| `list folders via API` | GET /api/gpx/folders |
| `create and delete a test file` | Full upload flow |
| `create public share via API` | POST /api/gpx/shares |
| `upload a sample GPX file` | Uploads test data |

## Session Management

Tests use cookie jars from `run.auth/e2e/.auth/`:
- `cookies-local-accounta.json` - accounta user (local dev, default)
- `cookies-local-accountb.json` - accountb user (local dev, file owner)
- `cookies-local-accountc.json` - accountc user (local dev, share recipient)
- `cookies-accounta.json` - Production sessions

If tests fail with 401 errors:
1. Check status: `./gpxe2e.sh --status`
2. Re-run setup: `./gpxe2e.sh --setup`
3. Or manually re-run auth tests

## Sample Files

The `samples/` directory contains GPX files for testing. These are uploaded during test setup and used for file operations tests.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3003` | GPX service URL |
| `AUTH_URL` | `http://localhost:3002` | Auth service URL |
| `TEST_USER_ROLE` | `accounta` | User role: accounta, accountb, accountc |

## Cleanup

```bash
# Remove all test sessions and data
./gpxe2e.sh --clean
```

Test files created during runs use the prefix `e2e-` with a timestamp. These can be manually cleaned up from cloud storage if needed.
