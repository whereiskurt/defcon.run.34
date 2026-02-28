# Testing Patterns

**Analysis Date:** 2026-02-28

## Test Framework

**Runner:**
- Playwright v1.48.0 (for E2E tests in `run.auth`)
- No unit test runner (Jest/Vitest) configured
- Focus: integration and end-to-end testing
- Config: `playwright.config.ts` in each e2e directory

**Assertion Library:**
- Playwright's built-in `expect()` from `@playwright/test`

**Run Commands:**
```bash
# run.auth E2E tests
cd apps/run.auth/e2e
npm test                  # Run all tests serially (single worker)
npm run test:headed      # Run with browser visible
npm run test:debug       # Run in debug mode

# Test-specific commands
npm run creds           # Acquire credentials for accounta
npm run creds:all       # Acquire credentials for all test accounts (accounta, accountb, accountc)
npm run cleanup         # Check stale test users (dry run)
npm run cleanup:execute # Actually delete stale test users
npm run validate        # Validate session for accounta
npm run validate:prod   # Validate session against production

# Setup before running tests
npm run creds:fresh     # Clean up old credentials and acquire fresh ones
```

## Test File Organization

**Location:**
- E2E tests co-located: `apps/run.auth/e2e/tests/` and `apps/run.auth/e2e/setup/`
- No unit tests in `/src` directories (not enforced)
- Test utilities: `apps/run.auth/e2e/lib/`

**Naming:**
- Test files: `*.spec.ts` (Playwright naming convention)
- Setup/fixture files: `*.spec.ts` (executed like tests but for setup)
- Test libraries: regular `.ts` modules in `lib/`

**Structure:**
```
apps/run.auth/e2e/
├── tests/
│   ├── session-valid.spec.ts      # Verify credentials are valid
│   └── service-access.spec.ts     # Verify user permissions
├── setup/
│   ├── acquire-credentials.spec.ts # Playwright test that logs in and saves cookies
│   └── cleanup-test-users.spec.ts  # Delete test users from DynamoDB
├── lib/
│   ├── cookie-jar.ts              # Save/load/manage session cookies
│   ├── altcha-solver.js           # Solve ALTCHA captchas
│   ├── s3-email.js                # Retrieve verification emails from S3
│   └── playwright-report/         # Generated HTML reports
├── playwright.config.ts
└── package.json
```

## Test Structure

**Suite Organization:**
```typescript
import { test, expect } from '@playwright/test';
import { loadCookiesForUser, type UserRole } from '../lib/cookie-jar.js';

const USER_ROLE = (process.env.TEST_USER_ROLE as UserRole) || 'accounta';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';

test.describe(`Service Access: ${USER_ROLE}`, () => {
  test.beforeEach(async ({ context }) => {
    // Setup: verify prerequisites, load cookies, skip if missing
    const hasJar = hasCookieJarForUser(USER_ROLE);
    test.skip(!hasJar, `No cookie jar for ${USER_ROLE} - run acquire-credentials first`);

    const loaded = await loadCookiesForUser(context, USER_ROLE);
    expect(loaded).toBe(true);
  });

  test('has required base services (auth, run)', async ({ page }) => {
    console.log('\n[TEST] Checking required base services...');

    const response = await page.request.get(`${BASE_URL}/api/session/validate`);
    expect(response.ok()).toBe(true);

    const session = await response.json();
    console.log(`  User:     ${session.user.email}`);
    expect(session.user.services).toContain('auth');
    expect(session.user.services).toContain('run');
  });
});
```

**Patterns:**
- **Setup:** `test.beforeEach()` for prerequisites (load cookies, check jar exists)
- **Teardown:** Not used (state persists in cookies between tests)
- **Assertion:** `expect()` from Playwright with `.toBe()`, `.toContain()`, `.ok()`
- **Skip:** Use `test.skip()` when prerequisites missing (e.g., no credentials acquired)
- **Logging:** `console.log()` with `[TEST]` prefix for progress tracking

## Mocking

**Framework:** No mocking library configured

**What IS mocked:**
- HTTP responses via Playwright's `page.request` API (not actual mocking, but HTTP client)
- Browser context cookies: saved/loaded from JSON files for multi-user testing
- Environment variables: set via env vars passed to test runner

**What NOT mocked:**
- Database queries: real DynamoDB tables (tests interact with actual database)
- Email delivery: uses real S3 bucket to retrieve verification emails
- ALTCHA captchas: solved via actual API calls (not mocked)
- Authentication flow: real OIDC login flow with real credentials

**Patterns:**
HTTP assertions using Playwright's built-in request API:
```typescript
const response = await page.request.get(`${BASE_URL}/api/session/validate`);
expect(response.ok()).toBe(true);
const data = await response.json();
expect(data.valid).toBe(true);
```

Cookie persistence via JSON files (Playwright's native context.addCookies):
```typescript
// Save cookies after login
export async function saveCookiesForUser(context: BrowserContext, role: UserRole): Promise<void> {
  const cookies = await context.cookies();
  const jar: CookieJar = { cookies, savedAt: new Date().toISOString(), expiresAt: "..." };
  fs.writeFileSync(getCookieJarPathForUser(role), JSON.stringify(jar, null, 2));
}

// Load cookies before test
export async function loadCookiesForUser(context: BrowserContext, role: UserRole): Promise<boolean> {
  const jar = JSON.parse(fs.readFileSync(getCookieJarPathForUser(role), 'utf-8'));
  await context.addCookies(jar.cookies);
  return true;
}
```

## Fixtures and Factories

**Test Data:**
Cookie jars stored as JSON files after first login. Fixtures include:
- Session cookies (from OIDC provider)
- Expiry timestamps for credential validation
- Multiple test users (accounta, accountb, accountc)

Location: `apps/run.auth/e2e/.auth/cookies-{local-}{role}.json`

Format:
```typescript
interface CookieJar {
  cookies: Cookie[];          // Array of Playwright Cookie objects
  savedAt: string;            // ISO timestamp when saved
  expiresAt: string;          // ISO timestamp when cookie expires
}
```

**Test User Generation:**
Handled in setup test (`setup/acquire-credentials.spec.ts`):
1. Playwright login flow (fills email, solves ALTCHA, waits for verification email)
2. Extracts session cookie from response
3. Saves cookie jar to `.auth/` directory
4. Subsequent tests load cookies from jar (no login needed)

```typescript
// From cookie-jar.ts - helper to check if credentials exist
export function hasCookieJarForUser(role: UserRole = 'accounta'): boolean {
  const jar = JSON.parse(fs.readFileSync(getCookieJarPathForUser(role), 'utf-8'));
  return new Date(jar.expiresAt) > new Date();  // Check not expired
}
```

## Coverage

**Requirements:** Not enforced

**View Coverage:**
No coverage reporting configured. Tests are integration/E2E focused.

## Test Types

**Unit Tests:**
- Not implemented (no Jest/Vitest setup)
- Focus is on integration/E2E testing of full auth flows

**Integration Tests:**
- Primary test type in `apps/run.auth/e2e/tests/`
- Test full HTTP request/response cycles
- Test session persistence and cookie management
- Test API validation endpoints

Example: `session-valid.spec.ts`
```typescript
test('session is valid', async ({ page }) => {
  const response = await page.request.get(`${BASE_URL}/api/session/validate`);
  expect(response.ok()).toBe(true);

  const session = await response.json();
  expect(session.valid).toBe(true);
  expect(session.user.email).toBe(TEST_EMAIL);
});
```

**E2E Tests:**
- Full login flows in `setup/acquire-credentials.spec.ts`
- Real browser automation with Chromium
- Solve CAPTCHAs, wait for emails, navigate forms
- Validate user permissions in `tests/service-access.spec.ts`

Example: `setup/acquire-credentials.spec.ts`
```typescript
test('acquire credentials for user account', async ({ page }) => {
  await page.goto(`${BASE_URL}/signin?invite=${INVITE_CODE}`);
  await page.fill('input[type="email"]', TEST_EMAIL);

  // Solve ALTCHA captcha
  const altchaToken = await fetchAndSolveAltcha(page);

  // Wait for verification email
  const emailCode = await waitForVerificationEmail(TEST_EMAIL);

  // Submit code and save session
  await saveCookiesForUser(page.context(), USER_ROLE);
});
```

## Playwright Configuration

**Key Settings:**
```typescript
// playwright.config.ts
export default defineConfig({
  testDir: '.',
  testMatch: ['setup/**/*.spec.ts', 'tests/**/*.spec.ts'],
  timeout: 180000,           // 3 minutes per test (allows for email wait)
  fullyParallel: false,      // Run serially to manage single cookie jar
  workers: 1,                // Single worker (no parallelization)
  expect: {
    timeout: 30000,          // 30 seconds for assertions
  },
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3002',
    trace: 'on-first-retry',  // Capture trace on first failure
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  reporter: [
    ['list'],                 // Console output
    ['html', { open: 'never' }], // HTML report (saved, not auto-opened)
  ],
});
```

## Common Patterns

**Async Testing:**
All tests are async (Playwright requirement). Use `async ({ page, context })` fixtures:
```typescript
test('async operation', async ({ page, context }) => {
  await page.goto(url);
  const response = await page.request.get(endpoint);
  expect(response.ok()).toBe(true);
});
```

**Error Testing:**
Check error responses and status codes:
```typescript
test('handles error responses', async ({ page }) => {
  const response = await page.request.get(`${BASE_URL}/api/invalid`);
  expect(response.status()).toBe(404);

  const error = await response.json();
  expect(error.error).toBeDefined();
});
```

**Multi-User Testing:**
Environment variable controls which user to test:
```typescript
// Run for accounta (default)
npm test

// Run for accountb
TEST_USER_ROLE=accountb npm test

// Run for accountc
TEST_USER_ROLE=accountc npm test
```

Cookies per role: `.auth/cookies-accounta.json`, `.auth/cookies-accountb.json`, etc.

**Multi-Region Testing:**
Environment variables control target:
```bash
# Test against local dev (use1 region)
npm test

# Test against production
BASE_URL=https://auth.defcon.run REGION_SHORT=use1 npm test

# Test ca-central-1 production
BASE_URL=https://auth.defcon.run REGION_SHORT=cac1 npm test
```

## Test Execution Environment

**Prerequisites:**
- Node.js 18+
- AWS credentials (for S3 email retrieval and DynamoDB access)
- Playwright browser installed: `npx playwright install chromium`

**Setup Flow:**
1. Run `npm run creds:fresh` to clean old credentials and log in fresh
2. This acquires credentials for accounta automatically
3. To acquire for other accounts: `TEST_USER_ROLE=accountb npm run creds`
4. Run tests: `npm test`

**Test Database Access:**
Tests access real DynamoDB tables specified by environment variables:
- `AUTH_AUTHJS_TABLE` - Auth.js session table (default: `run-auth-authjs`)
- `AUTH_ELECTRO_TABLE` - Auth ElectroDB table (default: `run-auth-electro`)
- `QUOTA_TABLE` - Quota service table (default: `run-quota-electro`)
- `GPX_TABLE` - GPX editor table (default: `run-gpx-electro`)

Used in `setup/cleanup-test-users.spec.ts` to remove test data.

## Notes on Non-Tested Code

**Strapi CMS (`run.cms`):**
- No tests configured
- No Jest/Vitest setup
- Built-in Strapi admin interface for testing

**Next.js Apps (`run.human`, `run.gpx`):**
- No unit tests
- No component tests
- Can be tested via E2E (through Playwright)
- Internal library functions tested manually or via E2E

**Terraform/Infrastructure:**
- No Terraform tests configured
- Validation via `terraform plan --all` and `terragrunt plan --all`
- No TFLint or policy-as-code setup

---

*Testing analysis: 2026-02-28*
