/**
 * Session Validation Test
 *
 * Verifies that saved credentials are valid and the session works.
 * Requires credentials to be acquired first via setup/acquire-credentials.spec.ts
 *
 * Usage:
 *   # Validate session for accounta (default)
 *   npx playwright test tests/session-valid.spec.ts
 *
 *   # Validate session for a specific account
 *   TEST_USER_ROLE=accountb npx playwright test tests/session-valid.spec.ts
 *
 *   # Against production
 *   BASE_URL=https://auth.defcon.run npx playwright test tests/session-valid.spec.ts
 */

import { test, expect } from '@playwright/test';
import {
  loadCookiesForUser, hasCookieJarForUser, getCookieJarPathForUser,
  getEmailForRole, type UserRole
} from '../lib/cookie-jar.js';

// Test configuration
const USER_ROLE = (process.env.TEST_USER_ROLE as UserRole) || 'accounta';
const TEST_EMAIL = getEmailForRole(USER_ROLE);
const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';

// Local dev has no region prefix, production uses regional path
const isLocal = BASE_URL.includes('localhost');
const REGION_SHORT = process.env.REGION_SHORT || 'use1';
const REGION_PREFIX = isLocal ? '' : `/${REGION_SHORT}`;

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

test.describe(`Session Validation: ${USER_ROLE}`, () => {

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

  test('session is valid', async ({ page }) => {
    console.log('\n[TEST] Validating session...');
    console.log(`  Role:   ${USER_ROLE}`);
    console.log(`  Email:  ${TEST_EMAIL}`);
    console.log(`  Cookie: ${getCookieJarPathForUser(USER_ROLE)}`);

    const response = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/session/validate`);
    expect(response.ok()).toBe(true);

    const session: SessionValidateResponse = await response.json();

    expect(session.valid).toBe(true);
    expect(session.user).toBeDefined();
    expect(session.user.email).toBe(TEST_EMAIL);

    console.log('\n[RESULT] Session Valid');
    console.log(`  User ID:   ${session.user.id}`);
    console.log(`  Email:     ${session.user.email}`);
    console.log(`  Services:  ${session.user.services.join(', ')}`);
    console.log(`  Tier:      ${session.user.quotaTier}`);
    console.log(`  Expires:   ${session.expires}`);
  });

  test('session cookie is httpOnly and secure', async ({ context }) => {
    console.log('\n[TEST] Checking cookie security...');

    const cookies = await context.cookies();
    const sessionCookie = cookies.find(c => c.name === 'sess_auth');

    expect(sessionCookie).toBeDefined();
    expect(sessionCookie!.httpOnly).toBe(true);

    console.log('\n[RESULT] Cookie Security');
    console.log(`  Name:     ${sessionCookie!.name}`);
    console.log(`  Domain:   ${sessionCookie!.domain}`);
    console.log(`  HttpOnly: ${sessionCookie!.httpOnly}`);
    console.log(`  Secure:   ${sessionCookie!.secure}`);
    console.log(`  SameSite: ${sessionCookie!.sameSite}`);
  });
});
