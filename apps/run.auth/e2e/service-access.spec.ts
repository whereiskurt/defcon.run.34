import { test, expect } from '@playwright/test';
import { loadCookies, hasCookieJar } from './lib/cookie-jar.js';

// Determine environment - local vs production
const isLocal = process.env.BASE_URL?.includes('localhost') || false;

// Service URLs - local dev uses different ports, production uses subdomains
const AUTH_URL = process.env.BASE_URL || 'https://auth.defcon.run';
const RUN_URL = isLocal ? 'http://localhost:3001' : 'https://run.defcon.run';
const GPX_URL = isLocal ? 'http://localhost:3003' : 'https://gpx.defcon.run';
const CMS_URL = isLocal ? 'http://localhost:1337' : 'https://cms.defcon.run';
// Local dev has no region prefix, production uses regional path (default: use1)
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

test.describe('Service Access Control', () => {

  test.beforeEach(async ({ context }) => {
    // All tests require a valid cookie jar
    test.skip(!hasCookieJar(), 'No cookie jar available - run auth.login.spec.ts first');

    // Load cookies from jar
    const loaded = await loadCookies(context);
    expect(loaded).toBe(true);
  });

  test('should have valid session with user services', async ({ page }) => {
    // Validate session via auth.defcon.run API
    console.log('Validating session via auth API...');
    const response = await page.request.get(`${AUTH_URL}${REGION_PREFIX}/api/session/validate`);
    expect(response.ok()).toBe(true);

    const session: SessionValidateResponse = await response.json();
    console.log('Session data:', JSON.stringify(session, null, 2));

    // Verify session structure
    expect(session.valid).toBe(true);
    expect(session.user).toBeDefined();
    expect(session.user.email).toBeDefined();
    expect(session.user.services).toBeDefined();
    expect(Array.isArray(session.user.services)).toBe(true);

    // Log services for debugging
    console.log(`User email: ${session.user.email}`);
    console.log(`User services: ${session.user.services.join(', ')}`);

    // Verify required base services are present
    for (const service of EXPECTED_SERVICES.required) {
      expect(session.user.services).toContain(service);
    }

    console.log('Session validation passed!');
  });

  test('should have access to run.defcon.run (run service)', async ({ page }) => {
    // Verify user has the run service required for run.human access
    console.log('Testing run.human access authorization...');

    const authResponse = await page.request.get(`${AUTH_URL}${REGION_PREFIX}/api/session/validate`);
    expect(authResponse.ok()).toBe(true);
    const session: SessionValidateResponse = await authResponse.json();

    console.log(`User email: ${session.user.email}`);
    console.log(`User services: ${session.user.services.join(', ')}`);

    // Check for run or human service (either grants access)
    const hasRunAccess = EXPECTED_SERVICES.runAccess.some(svc => session.user.services.includes(svc));
    expect(hasRunAccess).toBe(true);
    console.log(`run.human access authorized via '${EXPECTED_SERVICES.runAccess.find(svc => session.user.services.includes(svc))}' service!`);
  });

  test('should have access to gpx.defcon.run (gpxstudio service)', async ({ page }) => {
    // Verify user has the gpxstudio service required for GPX access
    console.log('Testing GPX access authorization...');

    const authResponse = await page.request.get(`${AUTH_URL}${REGION_PREFIX}/api/session/validate`);
    expect(authResponse.ok()).toBe(true);
    const session: SessionValidateResponse = await authResponse.json();

    console.log(`User email: ${session.user.email}`);
    console.log(`User services: ${session.user.services.join(', ')}`);

    // Check for gpxstudio service
    const hasGpxAccess = session.user.services.includes(EXPECTED_SERVICES.gpxAccess);

    if (!hasGpxAccess) {
      console.log(`WARNING: User lacks '${EXPECTED_SERVICES.gpxAccess}' service`);
      console.log('Default services should include gpxstudio per auth-profile.ts:5');
      console.log('This user may have been created before gpxstudio was added to defaults');
    }

    expect(hasGpxAccess).toBe(true);
    console.log(`GPX access authorized via '${EXPECTED_SERVICES.gpxAccess}' service!`);
  });

  test('should NOT have access to cms.defcon.run (no cms service)', async ({ page }) => {
    // Verify user does NOT have CMS service (not granted by default)
    console.log('Testing CMS access denial...');

    const authResponse = await page.request.get(`${AUTH_URL}${REGION_PREFIX}/api/session/validate`);
    expect(authResponse.ok()).toBe(true);
    const session: SessionValidateResponse = await authResponse.json();

    console.log(`User email: ${session.user.email}`);
    console.log(`User services: ${session.user.services.join(', ')}`);

    // Verify CMS service is NOT present
    const hasCmsAccess = session.user.services.includes(EXPECTED_SERVICES.cmsAccess);
    expect(hasCmsAccess).toBe(false);

    console.log(`CMS access correctly denied - user lacks '${EXPECTED_SERVICES.cmsAccess}' service`);
    console.log('CMS admin would return 403: "Access denied. You need the cms service permission"');
  });
});
