import { test, expect, request as apiRequest, type Page } from '@playwright/test';
import { loadAuthCookies, hasAuthCookieJar, getAuthCookieJarPath } from './lib/cookie-jar.js';

/**
 * Silent-SSO warm-session SMOKE for run.flash.
 *
 * Mirrors run.gpx/e2e/silent-sso.spec.ts trimmed to the single warm invariant:
 * for a warm run.auth session the flash app reaches its authenticated view with
 * the app session cookie (`sess_flash`) established via the hidden prompt=none
 * iframe, the auth `/login` page never rendering and no `/signin` oscillation.
 *
 * Availability-gated in a fixture-free beforeEach (app + IdP reachable, warm
 * cookie jar) so the browser never launches on skip. A green `--list` proves the
 * spec is registered — it does NOT prove the invariant; the EXECUTED warm run is
 * the real gate. No new dependency: reuses the same pinned @playwright/test +
 * typescript versions and the run.auth cookie-jar loader as run.gpx/e2e.
 */

// Defaults to local flash dev (:3004); override BASE_URL for prod.
const BASE_URL = process.env.BASE_URL || 'http://localhost:3004';
// The IdP origin the silent flow depends on (auth.defcon.run / localhost:3002).
const AUTH_SERVICE_URL = process.env.AUTH_URL || 'http://localhost:3002';
const isLocal = BASE_URL.includes('localhost');
const REGION_SHORT = process.env.REGION_SHORT || 'use1';
const REGION_PREFIX = isLocal ? '' : `/${REGION_SHORT}`;

// Public entry route (default region root; flash auth-gates every route to /signin).
const ENTRY_PATH = process.env.SSO_ENTRY_PATH || `${REGION_PREFIX}/`;
// App session cookie the silent iframe establishes on success.
const APP_SESSION_COOKIE = process.env.SSO_APP_COOKIE || 'sess_flash';
const SETTLE_MS = Number(process.env.SSO_SETTLE_MS || 8000);

function pathnameOf(u: string): string {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
}
function isAuthLoginRender(u: string): boolean {
  return /(^|\/)login$/.test(pathnameOf(u));
}
function isRpSigninPage(u: string): boolean {
  const p = pathnameOf(u);
  return /(^|\/)signin$/.test(p) && !p.includes('/api/auth/');
}
function countBy(urls: string[], pred: (u: string) => boolean): number {
  return urls.filter(pred).length;
}
function trackMainFrameNavigations(page: Page): string[] {
  const urls: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url());
  });
  return urls;
}
async function urlReachable(url: string): Promise<boolean> {
  try {
    const ctx = await apiRequest.newContext();
    const res = await ctx.get(url, { timeout: 4000, maxRedirects: 0 }).catch(() => null);
    await ctx.dispose();
    return !!res;
  } catch {
    return false;
  }
}
async function stackReachable(): Promise<boolean> {
  const [app, idp] = await Promise.all([
    urlReachable(`${BASE_URL}${REGION_PREFIX}/`),
    urlReachable(`${AUTH_SERVICE_URL}/`),
  ]);
  return app && idp;
}
async function sessionUser(page: Page): Promise<unknown> {
  try {
    const res = await page.request.get(`${BASE_URL}${REGION_PREFIX}/api/auth/session`);
    const json = await res.json().catch(() => ({}));
    return (json as { user?: unknown })?.user;
  } catch {
    return undefined;
  }
}

test.describe('Silent SSO (run.flash smoke) — warm', () => {
  test.beforeEach(async () => {
    test.skip(
      !hasAuthCookieJar(),
      `[SKIP] No warm run.auth cookie jar at ${getAuthCookieJarPath()} — the flash warm smoke cannot run. ` +
        `Acquire a session (run.auth e2e) first. A green --list does NOT prove the invariant.`,
    );
    test.skip(
      !(await stackReachable()),
      `[SKIP] flash stack not reachable (app ${BASE_URL} + IdP ${AUTH_SERVICE_URL}) — start the flash dev server + run.auth to run the warm smoke.`,
    );
  });

  test('warm session: authed view renders, no /login render, no loop, sess_flash set via iframe [warm]', async ({
    page,
    context,
  }) => {
    await loadAuthCookies(context);

    const navs = trackMainFrameNavigations(page);
    await page.goto(`${BASE_URL}${ENTRY_PATH}`, { waitUntil: 'networkidle' }).catch(() => {});

    await expect
      .poll(async () => (await context.cookies()).some((c) => c.name === APP_SESSION_COOKIE), {
        timeout: 30000,
        message: `expected ${APP_SESSION_COOKIE} to be set silently via the iframe`,
      })
      .toBe(true);

    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(SETTLE_MS);

    expect(
      countBy(navs, isAuthLoginRender),
      `auth /login must never render for a warm user. main-frame navs: ${navs.join(' -> ')}`,
    ).toBe(0);
    expect(
      countBy(navs, isRpSigninPage),
      `no /signin oscillation for a warm user. main-frame navs: ${navs.join(' -> ')}`,
    ).toBeLessThanOrEqual(1);
    expect(isAuthLoginRender(page.url())).toBe(false);
    expect(isRpSigninPage(page.url())).toBe(false);
    expect(await sessionUser(page), 'expected an authenticated session after silent SSO').toBeTruthy();
  });
});
