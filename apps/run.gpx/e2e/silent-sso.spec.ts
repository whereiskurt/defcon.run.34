import { test, expect, request as apiRequest, type Page } from '@playwright/test';
import { loadAuthCookies, hasAuthCookieJar, getAuthCookieJarPath } from './lib/cookie-jar.js';

/**
 * Full silent-SSO e2e for run.gpx (the goal-level SSO-08 gate).
 *
 * Proves the user-visible invariant that unit + IdP-integration tests cannot
 * observe: for a warm run.auth session the gpx app reaches its authenticated
 * view WITHOUT the auth-service `/login` page ever rendering and WITHOUT a
 * redirect loop, with the app session cookie (`sess_gpx`) established via the
 * hidden prompt=none iframe (SilentSSO.tsx). For a logged-out visitor the
 * silent probe posts `login_required`, the parent stays logged-out (no app
 * session minted), and there is no oscillation to /login and back.
 *
 * Availability-gated (mirrors run.auth/e2e/tests/silent-sso.spec.ts and the
 * cloud-storage suite): each test SKIPS with a clear reason when its
 * preconditions are absent (no warm cookie jar / app not reachable) rather than
 * fabricating a green. A green `playwright test --list` proves the spec is valid
 * and registered — it does NOT prove SSO-08. The real gate is the EXECUTED
 * warm-session assertion below (run with dev servers up + a warm run.auth cookie
 * jar), or the equivalent manual warm-session run.
 */

// Defaults to local gpx dev (:3003); override BASE_URL for prod.
const BASE_URL = process.env.BASE_URL || 'http://localhost:3003';
// The IdP origin the silent flow depends on (auth.defcon.run / localhost:3002).
// Silent SSO cannot be exercised without a reachable run.auth IdP, so both the
// app AND the IdP must be up for these live cases to run (else they skip).
const AUTH_SERVICE_URL = process.env.AUTH_URL || 'http://localhost:3002';
const isLocal = BASE_URL.includes('localhost');
const REGION_SHORT = process.env.REGION_SHORT || 'use1';
// Local dev has no region prefix; production uses a regional basePath.
const REGION_PREFIX = isLocal ? '' : `/${REGION_SHORT}`;

// The public entry route the probe starts from (default: region root). Every
// gpx route auth-gates to /signin, so the app root is the realistic entry; an
// operator can repoint this for a deployment that exposes a different route.
const ENTRY_PATH = process.env.SSO_ENTRY_PATH || `${REGION_PREFIX}/`;
// The app session cookie the silent iframe establishes on success.
const APP_SESSION_COOKIE = process.env.SSO_APP_COOKIE || 'sess_gpx';
// Room for the hidden iframe + prompt=none round-trip (>> SILENT_SSO_TIMEOUT_MS).
const SETTLE_MS = Number(process.env.SSO_SETTLE_MS || 8000);

function pathnameOf(u: string): string {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
}

// The auth-service login HTML render — the exact thing plan-01 (server-side
// interaction completion) makes invisible for a warm user. Matches `/login`
// or a region-prefixed `/{region}/login`, NOT the next-auth `/api/auth/*` routes.
function isAuthLoginRender(u: string): boolean {
  return /(^|\/)login$/.test(pathnameOf(u));
}

// The RP's own transient `/signin` shell page ("Redirecting to DEF CON login...").
// Excludes the `/api/auth/signin/...` handler paths, which are not page renders.
function isRpSigninPage(u: string): boolean {
  const p = pathnameOf(u);
  return /(^|\/)signin$/.test(p) && !p.includes('/api/auth/');
}

function countBy(urls: string[], pred: (u: string) => boolean): number {
  return urls.filter(pred).length;
}

// Record every MAIN-FRAME navigation over the flow so the login/loop invariants
// can be asserted against the actual top-level URL sequence (hidden-iframe
// navigations are on a child frame and are intentionally excluded).
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
    // Any HTTP response (including a 3xx auth redirect) means the endpoint is up.
    return !!res;
  } catch {
    return false;
  }
}

// Silent SSO needs BOTH the app and the IdP up to complete the prompt=none flow.
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

// Warm-session gate — the real SSO-08 proof. Tagged "warm" so CI can target it
// with `-g "warm"` only when a warm run.auth cookie jar is present.
// The precondition checks live in a fixture-free beforeEach so the browser is
// NEVER launched when the gate must skip (clean CI skip, no chromium error) —
// mirrors run.auth/e2e/tests/silent-sso.spec.ts.
test.describe('Silent SSO (run.gpx full) — warm', () => {
  test.beforeEach(async () => {
    test.skip(
      !hasAuthCookieJar(),
      `[SKIP] No warm run.auth cookie jar at ${getAuthCookieJarPath()} — the SSO-08 warm gate cannot run. ` +
        `Acquire a session (run.auth e2e) first. A green --list does NOT prove SSO-08.`,
    );
    test.skip(
      !(await stackReachable()),
      `[SKIP] gpx stack not reachable (app ${BASE_URL} + IdP ${AUTH_SERVICE_URL}) — start the gpx dev server + run.auth to run the warm SSO-08 gate.`,
    );
  });

  test('warm session: authed view renders, no /login render, no loop, sess_gpx set via iframe [warm]', async ({
    page,
    context,
  }) => {
    // Inject the warm run.auth session (same-site .defcon.run cookies flow into the iframe).
    await loadAuthCookies(context);

    const navs = trackMainFrameNavigations(page);
    await page.goto(`${BASE_URL}${ENTRY_PATH}`, { waitUntil: 'networkidle' }).catch(() => {});

    // (b) The app session cookie is established VIA the hidden iframe (poll — the
    //     silent prompt=none round-trip is async). This is the core "cookie set
    //     via iframe" invariant.
    await expect
      .poll(async () => (await context.cookies()).some((c) => c.name === APP_SESSION_COOKIE), {
        timeout: 30000,
        message: `expected ${APP_SESSION_COOKIE} to be set silently via the iframe`,
      })
      .toBe(true);

    // Let the top-level view settle after the silent session is established.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(SETTLE_MS);

    // (a) The auth-service /login page is NEVER rendered at the top level (plan-01 invariant).
    expect(
      countBy(navs, isAuthLoginRender),
      `auth /login must never render for a warm user. main-frame navs: ${navs.join(' -> ')}`,
    ).toBe(0);

    // No redirect loop: the RP /signin shell is transited at most once (the entry),
    // never oscillating to /signin and back.
    expect(
      countBy(navs, isRpSigninPage),
      `no /signin oscillation for a warm user. main-frame navs: ${navs.join(' -> ')}`,
    ).toBeLessThanOrEqual(1);

    // Settled on the authenticated view (not parked on a login/signin page).
    expect(isAuthLoginRender(page.url())).toBe(false);
    expect(isRpSigninPage(page.url())).toBe(false);

    // (c) The authenticated session is real (server confirms a user).
    expect(await sessionUser(page), 'expected an authenticated session after silent SSO').toBeTruthy();
  });
});

// Logged-out no-loop gate (T-33-11 / T-33-12). Needs a live app but no cookie jar.
// Precondition in a fixture-free beforeEach so the browser is not launched on skip.
test.describe('Silent SSO (run.gpx full) — logged-out', () => {
  test.beforeEach(async () => {
    test.skip(
      !(await stackReachable()),
      `[SKIP] gpx stack not reachable (app ${BASE_URL} + IdP ${AUTH_SERVICE_URL}) — start the gpx dev server + run.auth to run the logged-out no-loop check.`,
    );
  });

  test('logged-out: parent stays logged-out, no redirect loop, no app session minted', async ({
    page,
    context,
  }) => {
    // Ensure a truly logged-out context (belt-and-suspenders; test context is fresh).
    await context.clearCookies();

    const navs = trackMainFrameNavigations(page);
    await page.goto(`${BASE_URL}${ENTRY_PATH}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    // Give the silent iframe its full timeout (SILENT_SSO_TIMEOUT_MS ~4.5s) + settle,
    // so any oscillation would have occurred by now.
    await page.waitForTimeout(SETTLE_MS);

    // No redirect loop: neither the RP /signin shell nor the auth /login page is
    // visited repeatedly (a genuine one-time login prompt is expected and allowed;
    // oscillation is the T-33-11 regression this guards).
    expect(
      countBy(navs, isRpSigninPage),
      `no /signin oscillation for a logged-out user. main-frame navs: ${navs.join(' -> ')}`,
    ).toBeLessThanOrEqual(1);
    expect(
      countBy(navs, isAuthLoginRender),
      `no /login oscillation for a logged-out user. main-frame navs: ${navs.join(' -> ')}`,
    ).toBeLessThanOrEqual(1);

    // Parent stays logged-out: the silent iframe must NOT mint an app session (T-33-12).
    const cookies = await context.cookies();
    expect(
      cookies.some((c) => c.name === APP_SESSION_COOKIE),
      `${APP_SESSION_COOKIE} must NOT be set for a logged-out visitor`,
    ).toBe(false);
    // ...and no authenticated session exists.
    expect(await sessionUser(page), 'a logged-out visitor must not have a session').toBeFalsy();
  });
});
