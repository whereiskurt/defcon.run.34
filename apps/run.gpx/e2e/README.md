# run.gpx E2E Tests

End-to-end tests for the GPX Cloud Storage features.

## Prerequisites

1. **Install dependencies**:
   ```bash
   npm install
   npx playwright install chromium
   ```

2. **Authentication session** - These tests require a valid auth session from run.auth e2e tests.

## Running Tests

### Production Testing

```bash
# First, create a production auth session
cd ../../../run.auth/e2e
npm install && npx playwright install chromium
npm test

# Then run gpx tests against production
cd ../../../run.gpx/e2e
npm test
```

### Local Development Testing

**Important:** Local and production use separate cookie jars. You must run auth tests against localhost first.

```bash
# Terminal 1: Start auth service
cd apps/run.auth/webapp && PORT=3002 npm run dev

# Terminal 2: Start gpx service
cd apps/run.gpx/webapp && PORT=3003 npm run dev

# Terminal 3: Create local auth session first
cd apps/run.auth/e2e
BASE_URL=http://localhost:3002 npm test

# Then run gpx tests against localhost
cd apps/run.gpx/e2e
BASE_URL=http://localhost:3003 npm test
```

### Other Commands

```bash
# Run with visible browser
npm run test:headed

# Debug mode
npm run test:debug

# Shortcut for local testing (after auth session exists)
npm run test:local
```

## Test Coverage

### Cloud Storage UI Tests

| Test | Description |
|------|-------------|
| `verify authenticated session` | Confirms user is logged in |
| `open Cloud Storage dialog` | Opens the cloud storage dialog |
| `save a GPX file to cloud` | Uploads a sample GPX and saves it |
| `open a file from cloud storage` | Loads a file from cloud |
| `select and open multiple files` | Batch opens multiple files |
| `create a public share link` | Creates a public share URL |
| `access a public share link` | Verifies share URL works |

### Cloud Storage API Tests

| Test | Description |
|------|-------------|
| `list cloud files via API` | GET /api/gpx/files |
| `list folders via API` | GET /api/gpx/folders |
| `create and delete a test file` | Full upload flow |
| `create public share via API` | POST /api/gpx/shares |

## Session Management

Tests use the cookie jar from `run.auth/e2e/.auth/cookies.json`. This shared session allows running gpx tests without re-authenticating.

If tests fail with 401 errors:
1. Re-run the auth e2e tests: `cd ../run.auth/e2e && npm test`
2. Verify cookies exist: `ls -la ../run.auth/e2e/.auth/`
3. Check session validity

## Local Development

For local testing against dev servers:

```bash
# Start services (in separate terminals)
cd apps/run.auth/webapp && PORT=3002 npm run dev
cd apps/run.gpx/webapp && PORT=3003 npm run dev

# Run tests against localhost
BASE_URL=http://localhost:3003 npm test
```

## Cleanup

Test files created during runs use the prefix `e2e-test-` with a timestamp. These can be manually cleaned up from cloud storage if needed.
