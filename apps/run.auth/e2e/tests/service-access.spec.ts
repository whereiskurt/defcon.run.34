/**
 * Service Access Control Tests
 *
 * Tests that the authenticated user has correct service permissions.
 * Requires credentials to be acquired first via setup/acquire-credentials.spec.ts
 *
 * Usage:
 *   # Test service access for accounta (default)
 *   npx playwright test tests/service-access.spec.ts
 *
 *   # Test for a specific account
 *   TEST_USER_ROLE=accountb npx playwright test tests/service-access.spec.ts
 *
 *   # Against production
 *   BASE_URL=https://auth.defcon.run npx playwright test tests/service-access.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  loadCookiesForUser, hasCookieJarForUser, getEmailForRole, type UserRole
} from '../lib/cookie-jar.js';

// Test configuration
const USER_ROLE = (process.env.TEST_USER_ROLE as UserRole) || 'accounta';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';

// Local dev has no region prefix, production uses regional path
const isLocal = BASE_URL.includes('localhost');
const REGION_SHORT = process.env.REGION_SHORT || 'use1';
const REGION_PREFIX = isLocal ? '' : `/${REGION_SHORT}`;

// Expected services configuration
// Default services for new users: ["auth", "run", "strava", "gpxstudio"]
// CMS access requires explicit 'cms' service grant
const EXPECTED_SERVICES = {
  required: ['auth', 'run'],           // Must have these
  runAccess: ['run', 'human'],         // Either grants run.human access
  gpxAccess: 'gpxstudio',              // Required for GPX access
  cmsAccess: 'cms',                    // Required for CMS access (should NOT have by default)
};

interface SessionValidateResponse {
  valid: boolean;
  user: {
    id: string;
    email: string;
    name: string | null;
    picture: string | null;
    services: string[];
    linkedProviders: string[];
    quotaTier: string;
  };
  expires: string;
}

test.describe(`Service Access: ${USER_ROLE}`, () => {

  test.beforeEach(async ({ context }) => {
    // Check for cookie jar
    const hasJar = hasCookieJarForUser(USER_ROLE);
    if (!hasJar) {
      console.log(`\n[ERROR] No cookie jar found for ${USER_ROLE}`);
      console.log(`Run: TEST_USER_ROLE=${USER_ROLE} npx playwright test setup/acquire-credentials.spec.ts`);
    }
    test.skip(!hasJar, `No cookie jar for ${USER_ROLE} - run acquire-credentials first`);

    // Load cookies
    const loaded = await loadCookiesForUser(context, USER_ROLE);
    expect(loaded).toBe(true);
  });

  test('has required base services (auth, run)', async ({ page }) => {
    console.log('\n[TEST] Checking required base services...');

    const response = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/session/validate`);
    expect(response.ok()).toBe(true);

    const session: SessionValidateResponse = await response.json();
    console.log(`  User:     ${session.user.email}`);
    console.log(`  Services: ${session.user.services.join(', ')}`);

    for (const service of EXPECTED_SERVICES.required) {
      const hasService = session.user.services.includes(service);
      console.log(`  [${hasService ? '✓' : '✗'}] ${service}`);
      expect(session.user.services).toContain(service);
    }

    console.log('\n[PASS] All required services present');
  });

  test('has run.defcon.run access (run service)', async ({ page }) => {
    console.log('\n[TEST] Checking run.defcon.run access...');

    const response = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/session/validate`);
    expect(response.ok()).toBe(true);

    const session: SessionValidateResponse = await response.json();
    console.log(`  User:     ${session.user.email}`);
    console.log(`  Services: ${session.user.services.join(', ')}`);

    const hasRunAccess = EXPECTED_SERVICES.runAccess.some(svc =>
      session.user.services.includes(svc)
    );
    const grantingService = EXPECTED_SERVICES.runAccess.find(svc =>
      session.user.services.includes(svc)
    );

    console.log(`  [${hasRunAccess ? '✓' : '✗'}] run.defcon.run access via '${grantingService}'`);
    expect(hasRunAccess).toBe(true);
  });

  test('has gpx.defcon.run access (gpxstudio service)', async ({ page }) => {
    console.log('\n[TEST] Checking gpx.defcon.run access...');

    const response = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/session/validate`);
    expect(response.ok()).toBe(true);

    const session: SessionValidateResponse = await response.json();
    console.log(`  User:     ${session.user.email}`);
    console.log(`  Services: ${session.user.services.join(', ')}`);

    const hasGpxAccess = session.user.services.includes(EXPECTED_SERVICES.gpxAccess);

    if (!hasGpxAccess) {
      console.log(`  [!] WARNING: User lacks '${EXPECTED_SERVICES.gpxAccess}' service`);
      console.log('      Default services should include gpxstudio');
      console.log('      User may have been created before gpxstudio was added');
    }

    console.log(`  [${hasGpxAccess ? '✓' : '✗'}] gpx.defcon.run access via '${EXPECTED_SERVICES.gpxAccess}'`);
    expect(hasGpxAccess).toBe(true);
  });

  test('does NOT have cms.defcon.run access (no cms service)', async ({ page }) => {
    console.log('\n[TEST] Checking cms.defcon.run access denial...');

    const response = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/session/validate`);
    expect(response.ok()).toBe(true);

    const session: SessionValidateResponse = await response.json();
    console.log(`  User:     ${session.user.email}`);
    console.log(`  Services: ${session.user.services.join(', ')}`);

    const hasCmsAccess = session.user.services.includes(EXPECTED_SERVICES.cmsAccess);

    console.log(`  [${!hasCmsAccess ? '✓' : '✗'}] cms.defcon.run correctly denied`);
    expect(hasCmsAccess).toBe(false);
  });
});
