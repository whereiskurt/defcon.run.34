# Testing Patterns

**Analysis Date:** 2026-02-28

## Test Framework

**E2E Runner:**
- Playwright ^1.48.0
- Config: `apps/run.auth/e2e/playwright.config.ts`, `apps/run.gpx/e2e/playwright.config.ts`
- Browser: Chromium only
- Serial execution (workers: 1, fullyParallel: false) for cookie jar management

**Go Unit Tests:**
- Standard `testing` package
- Config: None (built into Go toolchain)
- One test file: `apps/configui/import_test.go`

**Unit Test Framework (JavaScript):**
- None configured. No Jest, Vitest, or other unit test framework for the Next.js apps.
- No `*.test.ts` or `*.spec.ts` files exist in any webapp `src/` directory.

**Assertion Library:**
- Playwright: Built-in `expect` from `@playwright/test`
- Go: Custom `assertEqual`, `assertIntEqual`, `assertBoolEqual`, `assertSliceEqual` helpers (not using testify)

**Run Commands:**
```bash
# E2E Tests (auth) - requires AWS credentials
cd apps/run.auth/e2e && npm test          # Run session-valid + service-access tests
cd apps/run.auth/e2e && npm run test:headed  # Run with visible browser

# E2E Tests (gpx) - requires auth sessions
cd apps/run.gpx/e2e && npm test           # Run cloud storage tests
cd apps/run.gpx/e2e && npm run test:headed  # Run with visible browser

# Unified E2E runner (all services)
./apps/e2e.sh                    # Run all e2e tests against localhost
./apps/e2e.sh --prod             # Run against production
./apps/e2e.sh --setup            # Only create auth sessions
./apps/e2e.sh --gpx --headed     # Run GPX tests with visible browser
./apps/e2e.sh --setup --clean    # Clean DynamoDB + create fresh sessions

# Credential acquisition
cd apps/run.auth/e2e && npm run creds        # Create local session for accounta
cd apps/run.auth/e2e && npm run creds:prod   # Create production session
cd apps/run.auth/e2e && npm run creds:all    # Create sessions for all accounts
cd apps/run.auth/e2e && npm run creds:fresh  # Clean + fresh session

# Go tests (configui)
cd apps/configui && go test ./...  # Run all Go tests

# Linting (per app)
cd apps/run.human/webapp && npm run lint
cd apps/run.auth/webapp && npm run lint
cd apps/run.gpx/webapp && npm run lint
```

## Test File Organization

**Location:**
- E2E tests live in separate `e2e/` directories alongside each app, NOT co-located with source
- Go tests co-located with source files (`import_test.go` next to `import.go`)
- No unit tests exist in webapp `src/` directories

**Naming:**
- E2E test specs: `*.spec.ts` (e.g., `session-valid.spec.ts`, `cloud-storage.spec.ts`)
- E2E setup/teardown: `setup/*.spec.ts` (e.g., `acquire-credentials.spec.ts`, `cleanup-test-users.spec.ts`)
- E2E helpers: `lib/*.ts` (e.g., `cookie-jar.ts`, `s3-email.ts`, `altcha-solver.ts`)
- Go tests: `*_test.go` (e.g., `import_test.go`)

**Structure:**
```
apps/run.auth/e2e/
├── playwright.config.ts
├── package.json
├── tsconfig.json
├── setup/
│   ├── acquire-credentials.spec.ts   # Creates auth sessions
│   └── cleanup-test-users.spec.ts    # DynamoDB cleanup
├── tests/
│   ├── session-valid.spec.ts         # Session validation
│   └── service-access.spec.ts        # Service permission checks
└── lib/
    ├── cookie-jar.ts                 # Cookie persistence
    ├── s3-email.ts                   # Email verification via S3
    └── altcha-solver.ts              # CAPTCHA solver

apps/run.gpx/e2e/
├── playwright.config.ts
├── package.json
├── tsconfig.json
├── cloud-storage.spec.ts            # GPX file upload/download tests
├── samples/                         # Test GPX files
└── lib/
    └── cookie-jar.ts                # Cookie persistence (shared pattern)
```

## Test Structure

**E2E Suite Organization:**
```typescript
import { test, expect } from '@playwright/test';
import { loadCookiesForUser, hasCookieJarForUser, type UserRole } from '../lib/cookie-jar.js';

const USER_ROLE = (process.env.TEST_USER_ROLE as UserRole) || 'accounta';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';
const isLocal = BASE_URL.includes('localhost');
const REGION_PREFIX = isLocal ? '' : `/${REGION_SHORT}`;

test.describe(`Session Validation: ${USER_ROLE}`, () => {
  test.beforeEach(async ({ context }) => {
    const hasJar = hasCookieJarForUser(USER_ROLE);
    test.skip(!hasJar, `No cookie jar for ${USER_ROLE} - run acquire-credentials first`);
    const loaded = await loadCookiesForUser(context, USER_ROLE);
    expect(loaded).toBe(true);
  });

  test('session is valid', async ({ page }) => {
    const response = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/session/validate`);
    expect(response.ok()).toBe(true);
    const session = await response.json();
    expect(session.valid).toBe(true);
    expect(session.user.email).toBe(TEST_EMAIL);
  });
});
```

**Go Test Structure:**
```go
func TestImportSiteHCL(t *testing.T) {
    repoRoot := "../.."
    siteHCLPath := filepath.Join(repoRoot, "infra", "terraform", "live", "site", "site.hcl")

    cfg, err := importSiteHCL(siteHCLPath)
    if err != nil {
        t.Fatalf("importSiteHCL failed: %v", err)
    }

    assertEqual(t, "Site.Label", cfg.Site.Label, "dc34")
    assertIntEqual(t, "DNS.TTL", cfg.DNS.TTL, 300)
}
```

**Patterns:**
- Setup: Cookie jar loading in `beforeEach`, skip test if no credentials
- Teardown: No explicit teardown - cookie jars persist between runs
- Assertions: Playwright `expect()` for HTTP responses, cookie properties, and page content

## Mocking

**Framework:** None. No mocking framework is used.

**E2E Approach:**
- Tests run against real services (localhost dev servers or production)
- No mocks, stubs, or test doubles
- Real DynamoDB tables, real S3 buckets, real SES email delivery
- Email verification uses S3 bucket polling (real emails stored by SES)

**What is NOT mocked:**
- AWS services (DynamoDB, S3, SES)
- Authentication flows (real OIDC, real email magic links)
- CAPTCHA (ALTCHA challenges solved programmatically via `altcha-lib`)
- Service-to-service communication (real HTTP calls)

## Fixtures and Factories

**Test Data:**
- User accounts: Three roles defined via email `+` addressing:
  ```typescript
  export type UserRole = 'accounta' | 'accountb' | 'accountc';

  export function getEmailForRole(role: UserRole): string {
    const baseEmail = 'jeanclaude@defcon.run';
    const [local, domain] = baseEmail.split('@');
    return `${local}+${role}@${domain}`;
  }
  ```
- Invite code: Hardcoded `'hacktheplanet'` in tests
- GPX test files: Sample `.gpx` files in `apps/run.gpx/e2e/samples/`

**Cookie Jar (Credential Persistence):**
```typescript
interface CookieJar {
  cookies: Cookie[];
  savedAt: string;
  expiresAt: string;
}
```
- Saved to `e2e/.auth/cookies-{role}.json` (production) or `cookies-local-{role}.json` (localhost)
- Auto-expire check on load; skip login if valid session exists
- Shared across test suites (auth e2e creates cookies, gpx e2e consumes them)

**Location:**
- Cookie jars: `apps/run.auth/e2e/.auth/` and `apps/run.gpx/e2e/.auth/`
- Sample files: `apps/run.gpx/e2e/samples/`
- Test results/screenshots: `apps/run.gpx/e2e/test-results/`

## Coverage

**Requirements:** None enforced. No coverage targets, no coverage reports.

**View Coverage:** Not applicable. No coverage tooling configured.

## Test Types

**Unit Tests:**
- **Go (configui):** One test file `apps/configui/import_test.go` with 2 test functions (`TestImportSiteHCL`, `TestImportServiceHCL`). Tests HCL config import by reading actual repo files and asserting ~80 field values. Custom assertion helpers used (no testify).
- **TypeScript/JavaScript:** No unit tests exist for any Next.js app. Zero `*.test.ts` or `*.spec.ts` files in any `webapp/src/` directory.

**Integration Tests:**
- No dedicated integration test suite. E2E tests serve double duty as integration tests since they test real service interactions.

**E2E Tests (Playwright):**
- **run.auth** (`apps/run.auth/e2e/`): 4 spec files
  - `setup/acquire-credentials.spec.ts` - Full login flow: navigate to login page, solve ALTCHA, submit email, poll S3 for verification email, complete callback, save cookies
  - `setup/cleanup-test-users.spec.ts` - DynamoDB cleanup across 4 tables (auth, profile, quota, gpx)
  - `tests/session-valid.spec.ts` - Validate saved session is still valid, check cookie security properties
  - `tests/service-access.spec.ts` - Verify user has correct service permissions (auth, run, gpxstudio, NOT cms)
- **run.gpx** (`apps/run.gpx/e2e/`): 1 spec file
  - `cloud-storage.spec.ts` - GPX file upload/download lifecycle with presigned URLs, folder management, sharing

**E2E Infrastructure:**
- `apps/e2e.sh` - Unified runner that orchestrates auth credential acquisition then GPX tests
- Supports `--prod` for production testing, `--headed` for visible browser, `--slow` for slow-motion debugging
- Supports `--clean` for DynamoDB test data cleanup before fresh runs

## Common Patterns

**Async Testing (E2E):**
```typescript
test('acquire and save credentials', async ({ page, context }) => {
  // Step-based approach with console.log progress
  console.log('\n[1/8] Navigating to login page...');
  await page.goto(`${BASE_URL}${REGION_PREFIX}/login`);
  await expect(page.locator('text=Welcome!')).toBeVisible({ timeout: 10000 });

  // API calls via page.request
  const csrfResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/auth/csrf`);
  expect(csrfResponse.ok()).toBe(true);
  const csrfData = await csrfResponse.json();

  // External service interaction (S3 email polling)
  const emailResult = await waitForVerificationEmail(TEST_EMAIL, loginStartTime);
});
```

**Conditional Test Skipping:**
```typescript
test.beforeEach(async ({ context }) => {
  const hasJar = hasCookieJarForUser(USER_ROLE);
  test.skip(!hasJar, `No cookie jar for ${USER_ROLE} - run acquire-credentials first`);
});
```

**Environment-Aware URLs:**
```typescript
const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';
const isLocal = BASE_URL.includes('localhost');
const REGION_SHORT = process.env.REGION_SHORT || 'use1';
const REGION_PREFIX = isLocal ? '' : `/${REGION_SHORT}`;
```

**Screenshot Pattern (GPX E2E):**
```typescript
async function takeScreenshot(page: Page, name: string, description?: string): Promise<string> {
  screenshotCounter++;
  const paddedNum = String(screenshotCounter).padStart(3, '0');
  const filename = `${paddedNum}-${name}.png`;
  const filepath = path.join(TEST_RESULTS_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  return filepath;
}
```

**Go Test Helpers:**
```go
func assertEqual(t *testing.T, name, got, want string) {
    t.Helper()
    if got != want {
        t.Errorf("%s = %q, want %q", name, got, want)
    }
}

func assertSliceEqual(t *testing.T, name string, got, want []string) {
    t.Helper()
    if len(got) != len(want) {
        t.Errorf("%s length = %d, want %d (got %v)", name, len(got), len(want), got)
        return
    }
    for i := range got {
        if got[i] != want[i] {
            t.Errorf("%s[%d] = %q, want %q", name, i, got[i], want[i])
        }
    }
}
```

## Test Data Cleanup

**DynamoDB Cleanup:**
- `apps/run.auth/e2e/setup/cleanup-test-users.spec.ts` cleans test data from 4 tables:
  - `run-auth-authjs` (Auth.js session/user records)
  - `run-auth-electro` (ElectroDB profile records)
  - `run-quota-electro` (Quota records)
  - `run-gpx-electro` (GPX file/folder records)
- Dry-run by default; set `CLEANUP_EXECUTE=true` to actually delete
- Finds user by email via GSI, then cascades deletion across all tables

**Cookie Cleanup:**
- `./apps/e2e.sh --clean` removes all cookie jar files
- Cookie jars auto-expire based on session token expiry

## Playwright Configuration

**run.auth:**
```typescript
defineConfig({
  testDir: '.',
  testMatch: ['setup/**/*.spec.ts', 'tests/**/*.spec.ts'],
  timeout: 180000,     // 3 minutes (ALTCHA + email wait up to 2 min)
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 30000 },
  use: { baseURL, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: [['list'], ['html', { open: 'never' }]],
});
```

**run.gpx:**
```typescript
defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 120000,     // 2 minutes for cloud operations
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 30000 },
  use: { baseURL, trace: 'on-first-retry', launchOptions: { slowMo } },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
```

## What is Missing

**Critical Gaps:**
1. **No unit tests for TypeScript apps** - Zero unit tests in `apps/run.human/webapp/`, `apps/run.auth/webapp/`, `apps/run.gpx/webapp/`, or `apps/run.cms/app/`. All business logic (entities, quota, validation) is untested at the unit level.
2. **No mocking infrastructure** - No jest/vitest config, no mock factories, no test utilities for DynamoDB/S3 operations.
3. **No CI pipeline test execution** - No GitHub Actions or CI config found for automated test runs.
4. **No test coverage measurement** - No coverage tool, no coverage thresholds, no coverage reports.
5. **Minimal Go test coverage** - Only HCL import parsing is tested in configui. No tests for handlers, AWS operations, terminal sessions, or WAF test orchestration.
6. **No API contract tests** - Session validation, quota API, and profile endpoints have no contract/schema tests.
7. **No Terraform testing** - No terratest, no `terraform validate` CI step (461 `.tf` files untested).

**Recommended Priorities for New Tests:**
1. Unit tests for ElectroDB entity CRUD operations (mock DynamoDB client)
2. Unit tests for quota-client consume/restore/check logic
3. Unit tests for GPX validator (`apps/run.gpx/webapp/src/lib/gpx-validator.ts`)
4. API route handler tests for auth guard pattern (session check, service check)
5. Go handler tests for configui save/import/export operations

---

*Testing analysis: 2026-02-28*
