# E2E Tests for auth.defcon.run

End-to-end tests for authentication flow and service access control.

## Quick Start

```bash
cd apps/run.auth/e2e
npm install
npx playwright install chromium

# Check status of saved credentials
npm run status

# Full fresh start (cleanup + acquire + test)
./scripts/acquire-all.sh --prod --clean
npm test
```

## Directory Structure

```
apps/run.auth/e2e/
├── setup/                              # Credential setup (run first)
│   ├── cleanup-test-users.spec.ts      # Clean DynamoDB test data
│   └── acquire-credentials.spec.ts     # Login and save cookies
├── tests/                              # Tests (require credentials)
│   ├── session-valid.spec.ts           # Validate saved session
│   └── service-access.spec.ts          # Test service permissions
├── scripts/                            # Helper scripts
│   ├── acquire-all.sh                  # Parallel credential acquisition
│   └── status.sh                       # Check cookie jar status
├── lib/                                # Shared utilities
│   ├── altcha-solver.ts                # ALTCHA proof-of-work solver
│   ├── cookie-jar.ts                   # Cookie persistence
│   └── s3-email.ts                     # Email verification via S3
└── .auth/                              # Cookie jars (gitignored)
    ├── cookies-accounta.json           # Production credentials
    ├── cookies-accountb.json
    ├── cookies-accountc.json
    ├── cookies-local-accounta.json     # Local dev credentials
    └── ...
```

## Test Accounts

Tests use three accounts with `+` addressing:

| Role | Email | Purpose |
|------|-------|---------|
| `accounta` | `jeanclaude+accounta@defcon.run` | Primary test account |
| `accountb` | `jeanclaude+accountb@defcon.run` | Multi-user scenarios |
| `accountc` | `jeanclaude+accountc@defcon.run` | Multi-user scenarios |

## Workflow

### Phase 1: Cleanup (Optional)

Remove existing test user data from DynamoDB:

```bash
# Dry run - see what would be deleted
npm run cleanup

# Actually delete test user data
npm run cleanup:execute

# Cleanup specific account
TEST_USER_ROLE=accounta npm run cleanup:execute
```

**Tables cleaned:**
- `run-auth-authjs` - User records, sessions, account links
- `run-auth-electro` - User profiles
- `run-quota-electro` - Quota records
- `run-gpx-electro` - GPX files and folders

### Phase 2: Acquire Credentials

Login and save session cookies (can take up to 2 minutes for email):

```bash
# Single account (local)
npm run creds                              # accounta (default)
TEST_USER_ROLE=accountb npm run creds      # accountb

# Single account (production)
npm run creds:prod
TEST_USER_ROLE=accountb npm run creds:prod

# All accounts in parallel
npm run creds:all           # local
npm run creds:all:prod      # production

# Cleanup + fresh login (combined)
npm run creds:fresh         # local
npm run creds:fresh:prod    # production

# Parallel with cleanup
./scripts/acquire-all.sh --clean        # local
./scripts/acquire-all.sh --prod --clean # production
```

### Phase 3: Validate & Test

```bash
# Check credential status
npm run status

# Validate session works
npm run validate              # local
npm run validate:prod         # production

# Run service access tests
npm test
BASE_URL=https://auth.defcon.run npm test

# Run with browser visible
npm run test:headed

# Debug mode
npm run test:debug
```

## NPM Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run status` | Check cookie jar status |
| `npm run cleanup` | Dry run - show what would be deleted |
| `npm run cleanup:execute` | Delete test user data from DynamoDB |
| `npm run creds` | Acquire credentials (local, accounta) |
| `npm run creds:prod` | Acquire credentials (production) |
| `npm run creds:all` | Parallel acquisition for all accounts (local) |
| `npm run creds:all:prod` | Parallel acquisition (production) |
| `npm run creds:fresh` | Cleanup + force fresh login (local, single account) |
| `npm run creds:fresh:prod` | Cleanup + force fresh login (production, single account) |
| `npm run creds:fresh:all` | Cleanup + acquire all accounts (local) |
| `npm run creds:fresh:all:prod` | Cleanup + acquire all accounts (production) |
| `npm run validate` | Validate saved session (local) |
| `npm run validate:prod` | Validate saved session (production) |
| `npm test` | Run service access tests |
| `npm run test:headed` | Run tests with browser visible |
| `npm run test:debug` | Run tests in debug mode |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3002` | Auth service URL |
| `TEST_USER_ROLE` | `accounta` | Which account to use (`accounta`, `accountb`, `accountc`) |
| `FORCE_FRESH` | `false` | Force fresh login even if cookies exist |
| `CLEANUP_EXECUTE` | `false` | Actually delete (vs dry run) |
| `AWS_REGION` | `us-east-1` | AWS region for DynamoDB/S3 |
| `REGION_SHORT` | `use1` | Region prefix for production URLs |

## AWS Requirements

The tests need AWS credentials with these permissions:

**For email verification (S3):**
- `ssm:GetParameter` for `/dc34/ses/s3/use1/bucket_name`
- `s3:ListBucket` and `s3:GetObject` for the SES inbox bucket

**For cleanup (DynamoDB):**
- `dynamodb:Query` and `dynamodb:Scan` on auth tables
- `dynamodb:DeleteItem` on auth tables (only if `CLEANUP_EXECUTE=true`)

## Configuration

| Setting | Value |
|---------|-------|
| Invite code | `hacktheplanet` |
| Email timeout | 120 seconds (60 polls × 2s) |
| Test timeout | 180 seconds |
| Cookie expiry | 15 days |

## Troubleshooting

### "No cookie jar found"

Run credential acquisition first:
```bash
npm run creds:prod
```

### "Cookie jar expired"

Force a fresh login:
```bash
FORCE_FRESH=true npm run creds:prod
```

### "No verification email found"

- Check AWS credentials are configured
- Verify SSM parameter `/dc34/ses/s3/use1/bucket_name` exists
- Check S3 bucket permissions
- Email may take up to 2 minutes to arrive

### "User already exists" or stale data

Run cleanup before acquiring:
```bash
npm run creds:fresh:prod
# or
./scripts/acquire-all.sh --prod --clean
```

### Tests fail with service access errors

Verify the user has expected services:
```bash
npm run validate:prod
```

Default services for new users: `auth`, `run`, `strava`, `gpxstudio`

## Local Development

```bash
# Start auth service locally
cd apps/run.auth/webapp && PORT=3002 npm run dev

# Run tests against localhost (uses separate cookie jar)
npm run creds
npm test
```

Local and production use separate cookie jars to prevent conflicts.
