import { test, expect } from '@playwright/test';
import { fetchAndSolveAltcha } from './lib/altcha-solver.js';
import { waitForVerificationEmail } from './lib/s3-email.js';
import {
  saveCookies, loadCookies, hasCookieJar, clearCookieJar, getCookieJarPath,
  saveCookiesForUser, loadCookiesForUser, hasCookieJarForUser, getEmailForRole,
  type UserRole
} from './lib/cookie-jar.js';

// Test configuration
// Default role is accounta (all accounts use +addressing)
const USER_ROLE = (process.env.TEST_USER_ROLE as UserRole) || 'accounta';
const TEST_EMAIL = getEmailForRole(USER_ROLE);
const INVITE_CODE = 'hacktheplanet';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';
// Local dev has no region prefix, production uses regional path (default: use1)
const isLocal = BASE_URL.includes('localhost');
const REGION_SHORT = process.env.REGION_SHORT || 'use1';
const REGION_PREFIX = isLocal ? '' : `/${REGION_SHORT}`;

console.log(`Test configuration: USER_ROLE=${USER_ROLE}, EMAIL=${TEST_EMAIL}`);

test.describe('Auth Login E2E', () => {

  test('should complete full login flow and save cookies', async ({ page, context }) => {
    // Skip if we already have valid cookies (use --grep "fresh" to force fresh login)
    const hasJar = hasCookieJarForUser(USER_ROLE);

    if (hasJar) {
      const loaded = await loadCookiesForUser(context, USER_ROLE);
      if (loaded) {
        // Verify session is still valid
        const response = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/session/validate`);
        if (response.ok()) {
          const session = await response.json();
          if (session.valid) {
            console.log(`Using existing valid session from cookie jar for ${USER_ROLE}`);
            console.log(`User: ${session.user.email}`);
            console.log(`Services: ${session.user.services.join(', ')}`);
            return; // Skip login, session is valid
          }
        }
      }
      console.log('Cookie jar invalid or expired, performing fresh login');
    }

    // Record timestamp before starting (for email filtering)
    const loginStartTime = new Date();
    console.log(`Login started at: ${loginStartTime.toISOString()}`);

    // Step 1: Navigate to login page
    console.log('Step 1: Navigating to login page...');
    await page.goto(`${BASE_URL}${REGION_PREFIX}/login`);
    await expect(page.locator('text=Welcome!')).toBeVisible({ timeout: 10000 });

    // Step 2: Get CSRF token from NextAuth API
    console.log('Step 2: Fetching CSRF token from NextAuth API...');
    const csrfResponse = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/auth/csrf`);
    expect(csrfResponse.ok()).toBe(true);
    const csrfData = await csrfResponse.json();
    const csrfToken = csrfData.csrfToken;
    expect(csrfToken).toBeDefined();
    console.log(`CSRF token fetched: ${csrfToken.substring(0, 10)}...`);

    // Step 3: Solve ALTCHA challenge
    console.log('Step 3: Solving ALTCHA challenge...');
    const altchaPayload = await fetchAndSolveAltcha(BASE_URL, REGION_PREFIX);
    console.log('ALTCHA solved!');

    // Step 4: Submit login request via API
    console.log('Step 4: Submitting login request...');
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
    console.log('Login request sent successfully!');

    // Step 5: Wait for verification email in S3
    console.log('Step 5: Waiting for verification email in S3...');
    const emailResult = await waitForVerificationEmail(TEST_EMAIL, loginStartTime);
    console.log(`\nVerification code received: ${emailResult.code}`);

    // Step 6: Complete verification by navigating to callback URL
    console.log('Step 6: Completing verification...');
    const callbackUrl = `${BASE_URL}${REGION_PREFIX}/api/auth/callback/nodemailer?token=${emailResult.code}&email=${encodeURIComponent(TEST_EMAIL)}&callbackUrl=${encodeURIComponent(`${REGION_PREFIX}/`)}`;

    await page.goto(callbackUrl);

    // Step 7: Verify login success - should redirect to home
    console.log('Step 7: Verifying login success...');
    await page.waitForURL(`${BASE_URL}${REGION_PREFIX}/`, { timeout: 30000 });

    // Verify session cookie is set
    const finalCookies = await context.cookies();
    const sessionCookie = finalCookies.find(c => c.name === 'sess_auth');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie!.httpOnly).toBe(true);

    console.log('Login successful! Session cookie set.');
    console.log(`  Cookie name: ${sessionCookie!.name}`);
    console.log(`  Domain: ${sessionCookie!.domain}`);
    console.log(`  HttpOnly: ${sessionCookie!.httpOnly}`);
    console.log(`  Secure: ${sessionCookie!.secure}`);

    // Step 8: Save cookies for reuse
    console.log(`Step 8: Saving cookies to jar for ${USER_ROLE}...`);
    await saveCookiesForUser(context, USER_ROLE);
    console.log(`Cookie jar saved to: ${getCookieJarPath()}`);
  });

  test('should reuse existing session from cookie jar', async ({ page, context }) => {
    const hasJar = hasCookieJarForUser(USER_ROLE);
    test.skip(!hasJar, `No cookie jar available for ${USER_ROLE} - run login test first`);

    // Load cookies from jar
    console.log(`Loading cookies from jar for ${USER_ROLE}...`);
    const loaded = await loadCookiesForUser(context, USER_ROLE);
    expect(loaded).toBe(true);

    // Navigate to authenticated endpoint
    console.log('Navigating to authenticated page...');
    await page.goto(`${BASE_URL}${REGION_PREFIX}/`);

    // Verify we're authenticated (check for session cookie)
    const cookies = await context.cookies();
    const sessionCookie = cookies.find(c => c.name === 'sess_auth');
    expect(sessionCookie).toBeDefined();

    console.log('Session reused from cookie jar successfully!');
  });
});
