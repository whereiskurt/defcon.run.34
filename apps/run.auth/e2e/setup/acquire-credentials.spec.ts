/**
 * Credential Acquisition Test
 *
 * This test acquires authentication credentials for a user role and saves them
 * to a cookie jar for later use by other tests.
 *
 * Usage:
 *   # Acquire credentials for accounta (default)
 *   npx playwright test setup/acquire-credentials.spec.ts
 *
 *   # Acquire credentials for a specific account
 *   TEST_USER_ROLE=accountb npx playwright test setup/acquire-credentials.spec.ts
 *
 *   # Force fresh login (ignore existing cookies)
 *   FORCE_FRESH=true npx playwright test setup/acquire-credentials.spec.ts
 *
 *   # Against production
 *   BASE_URL=https://auth.defcon.run npx playwright test setup/acquire-credentials.spec.ts
 */

import { test, expect } from '@playwright/test';
import { fetchAndSolveAltcha } from '../lib/altcha-solver.js';
import { waitForVerificationEmail } from '../lib/s3-email.js';
import {
  saveCookiesForUser, loadCookiesForUser, hasCookieJarForUser, getCookieJarPathForUser,
  getEmailForRole, type UserRole
} from '../lib/cookie-jar.js';

// Test configuration
const USER_ROLE = (process.env.TEST_USER_ROLE as UserRole) || 'accounta';
const TEST_EMAIL = getEmailForRole(USER_ROLE);
const INVITE_CODE = 'hacktheplanet';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';
const FORCE_FRESH = process.env.FORCE_FRESH === 'true';

// Local dev has no region prefix, production uses regional path
const isLocal = BASE_URL.includes('localhost');
const REGION_SHORT = process.env.REGION_SHORT || 'use1';
const REGION_PREFIX = isLocal ? '' : `/${REGION_SHORT}`;

console.log('='.repeat(60));
console.log('Credential Acquisition');
console.log('='.repeat(60));
console.log(`Role:     ${USER_ROLE}`);
console.log(`Email:    ${TEST_EMAIL}`);
console.log(`Base URL: ${BASE_URL}`);
console.log(`Region:   ${REGION_PREFIX || '(local)'}`);
console.log(`Force:    ${FORCE_FRESH}`);
console.log('='.repeat(60));

test.describe(`Acquire Credentials: ${USER_ROLE}`, () => {

  test('acquire and save credentials', async ({ page, context }) => {
    // Check for existing valid session (unless forced fresh)
    if (!FORCE_FRESH && hasCookieJarForUser(USER_ROLE)) {
      const loaded = await loadCookiesForUser(context, USER_ROLE);
      if (loaded) {
        // Verify session is still valid
        const response = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/session/validate`);
        if (response.ok()) {
          const session = await response.json();
          if (session.valid) {
            console.log('\n[SKIP] Valid session already exists');
            console.log(`  User:     ${session.user.email}`);
            console.log(`  Services: ${session.user.services.join(', ')}`);
            console.log(`  Cookie:   ${getCookieJarPathForUser(USER_ROLE)}`);
            return; // Skip login, session is valid
          }
        }
      }
      console.log('[INFO] Cookie jar invalid or expired, performing fresh login');
    }

    // Record timestamp before starting (for email filtering)
    const loginStartTime = new Date();
    console.log(`\n[START] Login started at: ${loginStartTime.toISOString()}`);

    // Step 1: Navigate to login page
    console.log('\n[1/8] Navigating to login page...');
    await page.goto(`${BASE_URL}${REGION_PREFIX}/login`);
    await expect(page.locator('text=Welcome!')).toBeVisible({ timeout: 10000 });
    console.log('      Login page loaded');

    // Step 2: Get CSRF token
    console.log('\n[2/8] Fetching CSRF token...');
    const csrfResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/auth/csrf`);
    expect(csrfResponse.ok()).toBe(true);
    const csrfData = await csrfResponse.json();
    const csrfToken = csrfData.csrfToken;
    expect(csrfToken).toBeDefined();
    console.log(`      Token: ${csrfToken.substring(0, 20)}...`);

    // Step 3: Solve ALTCHA challenge
    console.log('\n[3/8] Solving ALTCHA challenge...');
    const altchaPayload = await fetchAndSolveAltcha(BASE_URL, REGION_PREFIX);
    console.log('      ALTCHA solved');

    // Step 4: Submit login request
    console.log('\n[4/8] Submitting login request...');
    const loginResponse = await page.request.post(`${BASE_URL}${REGION_PREFIX}/api/login`, {
      data: {
        email: TEST_EMAIL,
        inviteCode: INVITE_CODE,
        csrfToken: csrfToken,
        altcha: altchaPayload,
      },
    });

    expect(loginResponse.ok()).toBe(true);
    const loginResult = await loginResponse.json();
    expect(loginResult.message).toBe('Success. Check your email.');
    console.log('      Login request sent');

    // Step 5: Wait for verification email (this can take up to 2 minutes)
    console.log('\n[5/8] Waiting for verification email (up to 2 minutes)...');
    console.log('      Polling S3 for email');
    const emailResult = await waitForVerificationEmail(TEST_EMAIL, loginStartTime);
    console.log(`      Code received: ${emailResult.code}`);

    // Step 6: Complete verification
    console.log('\n[6/8] Completing verification...');
    const callbackUrl = `${BASE_URL}${REGION_PREFIX}/api/auth/callback/nodemailer?token=${emailResult.code}&email=${encodeURIComponent(TEST_EMAIL)}&callbackUrl=${encodeURIComponent(`${REGION_PREFIX}/`)}`;
    await page.goto(callbackUrl);
    console.log('      Verification submitted');

    // Step 7: Verify login success
    console.log('\n[7/8] Verifying login success...');
    await page.waitForURL(`${BASE_URL}${REGION_PREFIX}/`, { timeout: 30000 });

    const finalCookies = await context.cookies();
    const sessionCookie = finalCookies.find(c => c.name === 'sess_auth');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie!.httpOnly).toBe(true);
    console.log('      Session cookie set');
    console.log(`      Domain: ${sessionCookie!.domain}`);

    // Step 8: Save cookies
    console.log('\n[8/8] Saving credentials...');
    await saveCookiesForUser(context, USER_ROLE);

    console.log('\n' + '='.repeat(60));
    console.log('SUCCESS: Credentials acquired and saved');
    console.log('='.repeat(60));
    console.log(`Role:   ${USER_ROLE}`);
    console.log(`Email:  ${TEST_EMAIL}`);
    console.log(`Cookie: ${getCookieJarPathForUser(USER_ROLE)}`);
    console.log('='.repeat(60));
  });
});
