/**
 * Silent SSO — IdP-level integration tests (Phase 33, plan 33-04)
 *
 * Proves the five locked provider behaviors from the design's Testing Strategy
 * (docs/superpowers/specs/2026-07-03-oidc-silent-sso-design.md, lines 92-96),
 * at the raw HTTP/redirect (302) layer — independent of any RP wiring. This is
 * the layer between plan-01's loadExistingGrant unit test and the full browser
 * e2e in run.gpx/e2e.
 *
 * Cases:
 *   A. prompt=none + warm provider session -> 302 to redirect_uri carrying code= (silent success), no /login render.
 *   B. prompt=none + no session          -> 302 carrying error=login_required, no code.
 *   C. interactive authorize + no session -> redirect path contains /api/oidc/interaction/ (interactions.url target).
 *   D. authenticated interaction          -> completes without ever rendering /login.
 *   E. unauthenticated interaction        -> still redirects to /{region}/login?oidc={uid}.
 *
 * Reuses the run.auth/e2e @playwright/test package, the region-prefix pattern
 * from session-valid.spec.ts, and the cookie-jar helpers — no new dependency and
 * no new e2e project (plan 33-04 key_links; threat T-33-SC).
 *
 * ENVIRONMENT GATING (honest CI/local behavior):
 *   These are live-service integration tests. They require a reachable run.auth
 *   IdP (BASE_URL, default http://localhost:3002) and, for the warm-session
 *   cases, an acquired cookie jar (setup/acquire-credentials.spec.ts). When a
 *   precondition is missing the affected case SKIPS with a clear reason (mirrors
 *   session-valid.spec.ts's `test.skip(!hasJar, ...)`) rather than failing or
 *   fabricating a pass. Point BASE_URL at a running IdP and acquire creds to run
 *   them for real.
 *
 * Usage:
 *   # Local dev IdP on :3002, accounta cookie jar
 *   npx playwright test tests/silent-sso.spec.ts
 *
 *   # Against a specific client / redirect_uri (both must be registered on the IdP)
 *   OIDC_CLIENT_ID=<id> OIDC_REDIRECT_URI=<uri> npx playwright test tests/silent-sso.spec.ts
 *
 *   # Against production
 *   BASE_URL=https://auth.defcon.run npx playwright test tests/silent-sso.spec.ts
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { createHash, randomBytes } from 'crypto';
import {
  loadCookiesForUser, hasCookieJarForUser, getEmailForRole, type UserRole,
} from '../lib/cookie-jar.js';

// ---------------------------------------------------------------------------
// Configuration (mirrors session-valid.spec.ts region-prefix conventions)
// ---------------------------------------------------------------------------

const USER_ROLE = (process.env.TEST_USER_ROLE as UserRole) || 'accounta';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';

// Local dev has no region prefix; production uses the regional path.
const isLocal = BASE_URL.includes('localhost');
const REGION_SHORT = process.env.REGION_SHORT || 'use1';
const REGION_PREFIX = isLocal ? '' : `/${REGION_SHORT}`;
const IDP_ORIGIN = new URL(BASE_URL).origin;

// Provider authorization endpoint == config.oidc.routePrefix + "/auth"
// (routePrefix is "/api/oidc" in dev, "/{region}/api/oidc" in prod).
const AUTHORIZE_URL = `${BASE_URL}${REGION_PREFIX}/api/oidc/auth`;

// The first-party client used to build the authorize request. client_id must be
// a registered first-party client and redirect_uri one of its registered URIs
// (see run.auth/webapp/src/config/oidc.ts). Both are parameterized via env so
// the spec runs against local/dev/prod without hardcoding secrets or ids. When
// absent, authorize-based cases skip (config not available in this environment).
const CLIENT_ID =
  process.env.OIDC_CLIENT_ID || process.env.OIDC_RUNHUMAN_CLIENT_ID || '';
const REDIRECT_URI =
  process.env.OIDC_REDIRECT_URI ||
  (isLocal ? 'http://localhost:3000/api/auth/callback/run.defcon.run' : '');
const SCOPE = process.env.OIDC_SCOPE || 'openid profile email services';

const CONFIG_READY = Boolean(CLIENT_ID && REDIRECT_URI);

// ---------------------------------------------------------------------------
// PKCE + authorize-URL helpers
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Build a full authorization-code + PKCE authorize URL. When `prompt` is set to
 * "none" the request asks the provider to answer silently (302 with code) or
 * fail with login_required — never rendering an interaction page.
 */
function buildAuthorizeUrl(opts: { prompt?: string } = {}): string {
  const { challenge } = makePkce();
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    state: base64url(randomBytes(16)),
    nonce: base64url(randomBytes(16)),
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (opts.prompt) q.set('prompt', opts.prompt);
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// Redirect walker — follows 3xx hops WITHOUT auto-following (maxRedirects: 0),
// capturing each Location so the raw 302 chain can be inspected. Stops when the
// chain leaves the IdP origin (final redirect to the RP redirect_uri) or reaches
// the /login page (asserted on, never fetched — so no login HTML is rendered).
// ---------------------------------------------------------------------------

interface Hop {
  url: string;
  status: number;
  location: string | null;
}

async function walkRedirects(
  request: APIRequestContext,
  startUrl: string,
  maxHops = 10,
): Promise<Hop[]> {
  const hops: Hop[] = [];
  let url = startUrl;

  for (let i = 0; i < maxHops; i++) {
    const res = await request.get(url, { maxRedirects: 0, timeout: 15000 });
    const location = res.headers()['location'] ?? null;
    hops.push({ url, status: res.status(), location });

    // Not a redirect, or nowhere to go next -> chain ends here.
    if (res.status() < 300 || res.status() >= 400 || !location) break;

    const next = new URL(location, url);
    // Left the IdP (e.g. final hop to the RP redirect_uri carrying ?code=).
    if (next.origin !== IDP_ORIGIN) break;
    // Reached the login page — assert on it, don't render it.
    if (next.pathname.endsWith('/login')) break;
    url = next.toString();
  }

  return hops;
}

/** The last Location in a redirect chain (the terminal target). */
function finalLocation(hops: Hop[]): string | null {
  for (let i = hops.length - 1; i >= 0; i--) {
    if (hops[i].location) return hops[i].location;
  }
  return null;
}

/** True if any hop's Location targets the /login page. */
function chainTouchesLogin(hops: Hop[]): boolean {
  return hops.some((h) => {
    if (!h.location) return false;
    try {
      return new URL(h.location, h.url).pathname.endsWith('/login');
    } catch {
      return false;
    }
  });
}

/** True if any hop's Location targets the server interaction-completion route. */
function chainTargetsInteractionRoute(hops: Hop[]): boolean {
  return hops.some((h) => {
    if (!h.location) return false;
    try {
      return new URL(h.location, h.url).pathname.includes('/api/oidc/interaction/');
    } catch {
      return false;
    }
  });
}

/** The hop whose URL *is* the interaction route (i.e. the route we fetched). */
function interactionRouteHop(hops: Hop[]): Hop | undefined {
  return hops.find((h) => h.url.includes('/api/oidc/interaction/'));
}

/** Probe the IdP once; used to skip the suite when no server is reachable. */
async function idpReachable(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get(AUTHORIZE_URL, {
      maxRedirects: 0,
      timeout: 5000,
    });
    // Any HTTP answer (even a 400 for the bare endpoint) proves reachability.
    return res.status() > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Silent SSO — IdP integration (prompt=none + interaction route)', () => {
  let reachable = false;

  test.beforeAll(async ({ request }) => {
    reachable = await idpReachable(request);
    if (!reachable) {
      console.log(
        `\n[SKIP] IdP not reachable at ${BASE_URL} — start run.auth (PORT=3002 npm run dev) ` +
          `or set BASE_URL to a running IdP to run silent-SSO integration cases.`,
      );
    }
    if (!CONFIG_READY) {
      console.log(
        `\n[SKIP] OIDC client not configured. Set OIDC_CLIENT_ID (or OIDC_RUNHUMAN_CLIENT_ID) ` +
          `and OIDC_REDIRECT_URI (a registered redirect_uri) to run authorize-based cases.`,
      );
    }
  });

  // Common preconditions. Declared without fixtures so that when the IdP is
  // unreachable / unconfigured the whole suite skips BEFORE any browser or
  // request context is set up (no chromium needed in a headless CI shell).
  test.beforeEach(() => {
    test.skip(!reachable, `IdP not reachable at ${BASE_URL}`);
    test.skip(!CONFIG_READY, 'OIDC_CLIENT_ID / OIDC_REDIRECT_URI not set');
  });

  test('Case A: prompt=none with a warm provider session yields a silent code, no login render', async ({
    page,
  }) => {
    test.skip(
      !hasCookieJarForUser(USER_ROLE),
      `No cookie jar for ${USER_ROLE} — run setup/acquire-credentials.spec.ts first`,
    );

    console.log(`\n[TEST] Case A — warm-session prompt=none for ${getEmailForRole(USER_ROLE)}`);

    // Inject the acquired Auth.js session (sess_auth) into the browser context.
    const loaded = await loadCookiesForUser(page.context(), USER_ROLE);
    expect(loaded).toBe(true);

    // Warm-up: one interactive authorize completes server-side (interactions.url
    // now targets the interaction route) and establishes the provider _session
    // cookie for the warm user. page.request shares the context cookie store, so
    // the _session persists into the prompt=none request below.
    await walkRedirects(page.request, buildAuthorizeUrl());

    // The silent check: prompt=none must now succeed with an authorization code.
    const hops = await walkRedirects(page.request, buildAuthorizeUrl({ prompt: 'none' }));
    const target = finalLocation(hops);
    console.log(`  final Location: ${target}`);

    expect(target, 'prompt=none should terminate in a redirect').toBeTruthy();
    const targetUrl = new URL(target!, BASE_URL);
    // Silent success: redirect leaves the IdP to the client redirect_uri with a code.
    expect(targetUrl.origin).toBe(new URL(REDIRECT_URI).origin);
    expect(
      targetUrl.searchParams.get('code'),
      'warm prompt=none must carry an authorization code',
    ).toBeTruthy();
    expect(targetUrl.searchParams.get('error')).toBeNull();
    // No interaction/login page was rendered along the way.
    expect(chainTouchesLogin(hops)).toBe(false);
  });

  test('Case B: prompt=none with no session yields login_required, no code', async ({
    request,
  }) => {
    console.log('\n[TEST] Case B — no-session prompt=none');

    // `request` fixture is a fresh context with no cookies -> no provider session.
    const hops = await walkRedirects(request, buildAuthorizeUrl({ prompt: 'none' }));
    const target = finalLocation(hops);
    console.log(`  final Location: ${target}`);

    expect(target, 'prompt=none should terminate in a redirect').toBeTruthy();
    const targetUrl = new URL(target!, BASE_URL);
    // prompt=none cannot interact, so it must fail closed with a login_required class error.
    const error = targetUrl.searchParams.get('error');
    expect(
      error,
      'no-session prompt=none must return a login_required-class error (regression guard T-33-09)',
    ).toMatch(/login_required|interaction_required|consent_required|account_selection_required/);
    // Never a silent code for an unauthenticated caller.
    expect(targetUrl.searchParams.get('code')).toBeNull();
  });

  test('Case C: an interactive authorize with no session redirects into the interaction route (interactions.url target)', async ({
    request,
  }) => {
    console.log('\n[TEST] Case C — interactions.url resolves to the interaction route');

    // Fresh context (no cookies). A normal (non-none) authorize needs interaction,
    // so the provider redirects to interactions.url — which plan-01 repointed from
    // `${loginPage}?oidc=` to the server route `/{region}/api/oidc/interaction/{uid}`.
    const hops = await walkRedirects(request, buildAuthorizeUrl());
    console.log(hops.map((h) => `  ${h.status} ${h.url} -> ${h.location ?? ''}`).join('\n'));

    expect(
      chainTargetsInteractionRoute(hops),
      'interactions.url must target /api/oidc/interaction/, not ?oidc= on /login',
    ).toBe(true);
  });

  test('Case D: an authenticated interaction completes without ever rendering /login', async ({
    page,
  }) => {
    test.skip(
      !hasCookieJarForUser(USER_ROLE),
      `No cookie jar for ${USER_ROLE} — run setup/acquire-credentials.spec.ts first`,
    );

    console.log(`\n[TEST] Case D — authenticated interaction for ${getEmailForRole(USER_ROLE)}`);

    // Warm session: sess_auth present -> the interaction route completes the
    // interaction server-side (interactionResult) and continues the OIDC flow to
    // the client redirect_uri with a code, never bouncing to the /login page.
    const loaded = await loadCookiesForUser(page.context(), USER_ROLE);
    expect(loaded).toBe(true);

    const hops = await walkRedirects(page.request, buildAuthorizeUrl());
    console.log(hops.map((h) => `  ${h.status} ${h.url} -> ${h.location ?? ''}`).join('\n'));

    // It routed through the interaction route (proving completion happens there)...
    expect(chainTargetsInteractionRoute(hops)).toBe(true);
    // ...and the /login page was never rendered for the authenticated user.
    expect(
      chainTouchesLogin(hops),
      'authenticated interaction must not render /login',
    ).toBe(false);
    // The flow continued to a code at the client redirect_uri (interaction completed).
    const target = finalLocation(hops);
    expect(target, 'authenticated flow should terminate in a redirect').toBeTruthy();
    const targetUrl = new URL(target!, BASE_URL);
    expect(targetUrl.origin).toBe(new URL(REDIRECT_URI).origin);
    expect(
      targetUrl.searchParams.get('code'),
      'authenticated interaction should complete with an authorization code',
    ).toBeTruthy();
  });

  test('Case E: an unauthenticated interaction still redirects to /{region}/login?oidc={uid}', async ({
    request,
  }) => {
    console.log('\n[TEST] Case E — unauthenticated interaction falls back to /login');

    // Fresh context (no session). The authorize -> interaction route chain must
    // preserve the login fallback: with no sess_auth the interaction route
    // redirects to the region-prefixed /login carrying the interaction uid.
    const hops = await walkRedirects(request, buildAuthorizeUrl());
    console.log(hops.map((h) => `  ${h.status} ${h.url} -> ${h.location ?? ''}`).join('\n'));

    const interHop = interactionRouteHop(hops);
    expect(interHop, 'chain should traverse the interaction route').toBeTruthy();
    expect(interHop!.location, 'interaction route should redirect somewhere').toBeTruthy();

    const loginTarget = new URL(interHop!.location!, interHop!.url);
    // Region-prefixed in prod (/{region}/login), bare in dev (/login).
    expect(loginTarget.pathname.endsWith('/login')).toBe(true);
    if (REGION_PREFIX) {
      expect(loginTarget.pathname).toBe(`${REGION_PREFIX}/login`);
    }
    // The interaction uid is preserved via the ?oidc= param and matches the route uid.
    const oidcParam = loginTarget.searchParams.get('oidc');
    expect(oidcParam, 'login fallback must preserve the interaction uid via ?oidc=').toBeTruthy();
    const uidFromPath = new URL(interHop!.url).pathname.split('/').filter(Boolean).pop();
    expect(oidcParam).toBe(uidFromPath);
  });
});
