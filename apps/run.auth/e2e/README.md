# E2E Tests for auth.defcon.run

End-to-end tests for the authentication flow and service access control.

## Prerequisites

- Node.js 18+
- AWS credentials configured (for S3 email retrieval)
- Playwright browsers installed

## Setup

```bash
cd apps/run.auth/e2e
npm install
npx playwright install chromium
```

## Running Tests

```bash
# Run all tests
npm test

# Run with browser visible
npm run test:headed

# Run in debug mode
npm run test:debug

# Run specific test file
npx playwright test auth.login.spec.ts
npx playwright test service-access.spec.ts
```

## Test Structure

### auth.login.spec.ts
Full login flow using email verification:
1. Navigate to login page
2. Fetch CSRF token from NextAuth API
3. Solve ALTCHA proof-of-work challenge
4. Submit login with test credentials
5. Retrieve verification code from S3 (SES inbox)
6. Complete verification callback
7. Save session cookies to jar

### service-access.spec.ts
Service access validation (requires cookie jar from login test):
- **run.defcon.run** - Requires `run` or `human` service (allowed)
- **gpx.defcon.run** - Requires `gpxstudio` service (allowed)
- **cms.defcon.run** - Requires `cms` service (denied by default)

## Configuration

| Setting | Value |
|---------|-------|
| Test user | `jeanclaude@defcon.run` |
| Invite code | `hacktheplanet` |
| Cookie jar | `.auth/cookies.json` |
| S3 bucket | Fetched from SSM `/dc34/ses/s3/use1/bucket_name` |

## Cookie Jar

Tests use a shared cookie jar (`.auth/cookies.json`) for session persistence:
- Login test saves cookies after successful authentication
- Service access tests load cookies to validate access
- Cookie jar is gitignored

To force a fresh login, delete the cookie jar:
```bash
rm -rf .auth/
```

## AWS Requirements

The tests need AWS credentials with:
- `ssm:GetParameter` for `/dc34/ses/s3/use1/bucket_name`
- `s3:ListBucket` and `s3:GetObject` for the SES inbox bucket
