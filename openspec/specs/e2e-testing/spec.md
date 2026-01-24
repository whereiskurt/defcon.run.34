# E2E Testing Specification

**Status:** Implemented
**Created:** 2026-01-24

## Summary

End-to-end testing infrastructure for the defcon.run 34 applications using Playwright. Tests verify authentication flows, cloud storage operations, multi-user sharing, and UI interactions.

## Architecture

### Test Location

```
apps/
├── e2e.sh                    # Unified orchestrator (runs auth then gpx)
├── run.auth/e2e/             # Auth service e2e tests
│   ├── auth.login.spec.ts    # OIDC login flow tests
│   ├── lib/
│   │   ├── cookie-jar.ts     # Session persistence
│   │   ├── altcha-solver.ts  # CAPTCHA solving
│   │   └── s3-email.ts       # Email verification via S3
│   └── .auth/                # Cookie jars (gitignored)
└── run.gpx/e2e/              # GPX service e2e tests
    ├── cloud-storage.spec.ts # Cloud storage tests
    ├── samples/              # Sample GPX files for testing
    ├── lib/cookie-jar.ts     # Session loading from auth
    └── test-results/         # Screenshots (gitignored)
```

### Multi-User Support

Tests use three user accounts via email +addressing:

| Role | Email | Purpose |
|------|-------|---------|
| `accounta` | jeanclaude+accounta@defcon.run | Default test user |
| `accountb` | jeanclaude+accountb@defcon.run | File owner for share tests |
| `accountc` | jeanclaude+accountc@defcon.run | Share recipient |

### Session Management

Sessions are persisted as cookie jars in `run.auth/e2e/.auth/`:

```
cookies-local-accounta.json   # Local dev sessions
cookies-local-accountb.json
cookies-local-accountc.json
cookies-accounta.json         # Production sessions
```

Cookie jars include:
- Session cookie (`sess_auth`)
- Expiration timestamp
- Domain binding

GPX tests load auth cookies from the auth e2e directory - no separate login needed.

## Requirements

### Requirement: Session Reuse

The system SHALL persist authenticated sessions between test runs to avoid repeated logins.

#### Scenario: Valid session exists
- **WHEN** a cookie jar exists and is not expired
- **THEN** skip login and reuse existing session

#### Scenario: Session expired or missing
- **WHEN** no valid cookie jar exists
- **THEN** perform full OIDC login flow and save new session

### Requirement: Multi-User Testing

The system SHALL support testing interactions between multiple users.

#### Scenario: Private share between users
- **WHEN** accountb creates a private share
- **AND** accountc accesses the share URL
- **THEN** accountc can view the shared content

### Requirement: Test Data Cleanup

The system SHALL clean up test data after each test run.

#### Scenario: E2E file cleanup
- **WHEN** test suite completes
- **THEN** all files with `e2e-` prefix are deleted
- **AND** quota is not restored (by design)

### Requirement: Geographic Diversity in Multi-File Tests

The system SHALL select geographically diverse files for map testing.

#### Scenario: Map centering verification
- **WHEN** multiple GPX files are loaded
- **THEN** files from different locations (Japan, NYC, Vegas) are selected
- **AND** centering on each file moves the map to that location
- **AND** screenshots capture each distinct view

## Running Tests

### Quick Start

```bash
# Full suite (creates sessions, uploads files, runs tests, cleans up)
cd apps && ./e2e.sh

# Check status of services and sessions
./e2e.sh --status

# Run with visible browser
./e2e.sh --headed

# Run with slow-mo (500ms between actions)
./e2e.sh --slow

# Only run GPX tests (assumes auth sessions exist)
./e2e.sh --gpx

# Clean up test data and sessions
./e2e.sh --clean
```

### Prerequisites

1. **Services running:**
   ```bash
   # Terminal 1: Auth service
   cd apps/run.auth/webapp && PORT=3002 npm run dev

   # Terminal 2: GPX service
   cd apps/run.gpx/webapp && PORT=3003 npm run dev
   ```

2. **AWS credentials** for email verification (reads from S3)

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3003` | GPX service URL |
| `AUTH_URL` | `http://localhost:3002` | Auth service URL |
| `TEST_USER_ROLE` | `accounta` | User: accounta, accountb, accountc |
| `SLOW_MO` | `0` | Milliseconds delay between actions |

## Test Categories

### 1. Auth & Session Tests

| Test | Description |
|------|-------------|
| Complete full login flow | OIDC flow with email verification |
| Reuse existing session | Cookie jar validation |

### 2. Cloud Storage UI Tests

| Test | Description |
|------|-------------|
| Open Cloud Storage dialog | Basic dialog opening |
| Open Save As dialog | Save menu verification |
| Open file from cloud | Single file loading |
| Select and open multiple files | Batch open with map verification |
| Create public share link | Share URL generation |
| Access public share link | Share URL resolution |

### 3. Multi-User Share Tests

| Test | Description |
|------|-------------|
| Private share between users | accountb shares, accountc accesses |

### 4. Cloud Storage API Tests

| Test | Description |
|------|-------------|
| List cloud files via API | GET /api/gpx/files |
| List folders via API | GET /api/gpx/folders |
| Create and delete test file | Full upload flow |
| Create public share via API | POST /api/gpx/shares |
| Upload sample GPX files | Batch upload for test setup |

### 5. Test Cleanup

| Test | Description |
|------|-------------|
| Delete all e2e test files | UI and API cleanup |
| Clean up accountb files | Multi-user cleanup |
| Verify no e2e files remain | Final validation |

## Sample Files

The `samples/` directory contains GPX files for testing:

| File | Size | Location |
|------|------|----------|
| guelph-loop-approx.gpx | 1KB | Guelph, Canada |
| lvccindoor.gpx | 6KB | Las Vegas |
| japan.gpx | 10KB | Japan |
| Test NYC Route.gpx | 134KB | New York City |
| Test Japan Route.gpx | 178KB | Japan (detailed) |

Files under 200KB are automatically selected for upload tests to balance diversity with speed.

## Screenshots

The multi-file test captures screenshots in `test-results/`:

| Screenshot | Content |
|------------|---------|
| multi-file-all-loaded.png | Initial map with all files |
| multi-file-centered-1.png | Map centered on file 1 (e.g., Japan) |
| multi-file-centered-2.png | Map centered on file 2 (e.g., NYC) |
| multi-file-centered-3.png | Map centered on file 3 (e.g., Vegas) |
| multi-file-track-hidden.png | Track visibility toggled |

## Key Implementation Details

### Share URL Generation

Share URLs must NOT include region prefix (`/use1/`) in local development:

```typescript
// Correct: Check if NEXT_PUBLIC_BASE_URL contains production domain
const configuredBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
const isProduction = configuredBaseUrl?.includes("defcon.run");

if (isProduction) {
  shareUrl = `${configuredBaseUrl}/${regionShort}/studio/share/${shareId}`;
} else {
  const baseUrl = configuredBaseUrl || `http://localhost:${process.env.PORT}`;
  shareUrl = `${baseUrl}/studio/share/${shareId}`;
}
```

### Map Centering

Use `Ctrl+Enter` keyboard shortcut to center map on selected file:

```typescript
await fileTab.click();           // Select the file
await page.keyboard.press('Control+Enter');  // Center map
await page.waitForTimeout(2000); // Wait for animation
```

### File Selection for Diversity

Select files matching geographic patterns:

```typescript
const diversePatterns = ['NYC', 'Japan', 'lvcc', 'Guelph', 'bigstar'];
// Search file names for these patterns to ensure map shows different locations
```

## GitHub Actions CI

The e2e tests can run in GitHub Actions via `.github/workflows/e2e-tests.yml`.

### Trigger

**Manual only** - Via workflow_dispatch in GitHub Actions UI. This prevents accidental runs and allows control over when e2e tests consume AWS resources.

### Prerequisites

#### 1. GitHub Environment

Create a GitHub environment named `e2e-tests` with:
- Variable: `AWS_ACCOUNT_ID` - Your AWS account ID

#### 2. IAM Role

Create an IAM role `dc34-github-e2e` with:
- Trust policy for GitHub OIDC provider
- Permissions for SSM, S3, DynamoDB, SES

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ssm:GetParameter"],
      "Resource": "arn:aws:ssm:*:*:parameter/defcon-run/e2e/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::your-e2e-bucket", "arn:aws:s3:::your-e2e-bucket/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["dynamodb:*"],
      "Resource": "arn:aws:dynamodb:*:*:table/e2e-*"
    }
  ]
}
```

#### 3. SSM Parameters

Create these SSM parameters under `/defcon-run/e2e/`:

| Parameter | Type | Description |
|-----------|------|-------------|
| `/defcon-run/e2e/nextauth-secret` | SecureString | NextAuth.js secret |
| `/defcon-run/e2e/auth-internal-secret` | SecureString | Service-to-service auth |
| `/defcon-run/e2e/s3-bucket` | String | GPX file storage bucket |
| `/defcon-run/e2e/s3-email-bucket` | String | SES email storage bucket |
| `/defcon-run/e2e/dynamodb-table-prefix` | String | Table prefix (e.g., `e2e-`) |
| `/defcon-run/e2e/email-server` | SecureString | SMTP connection string |
| `/defcon-run/e2e/email-from` | String | Sender address |

### CI Workflow Steps

1. Authenticate via AWS OIDC
2. Fetch configuration from SSM Parameter Store
3. Install webapp and e2e dependencies (in parallel)
4. Install Playwright browsers
5. Build GPX Studio frontend
6. Start Auth service on port 3002
7. Start GPX service on port 3003
8. Wait for services to be healthy
9. Run full e2e test suite
10. Upload test results and screenshots as artifacts

### Artifacts

On test completion, these artifacts are uploaded:

| Artifact | Contents | Retention |
|----------|----------|-----------|
| `e2e-screenshots` | Map screenshots (always) | 14 days |
| `e2e-test-results` | Test results + service logs (on failure) | 7 days |

## Troubleshooting

### 401 Errors
Session expired. Re-run: `./e2e.sh --setup`

### Quota Exceeded
Upload quota depleted. Wait for quota reset or use admin API to restore.

### Share URL 404
Check that share URL doesn't contain `/use1/` in local dev. The API should generate correct URLs based on `NEXT_PUBLIC_BASE_URL`.

### Map Not Moving
Ensure `Ctrl+Enter` is being sent after file selection. Double-click on file tabs does NOT center the map.
