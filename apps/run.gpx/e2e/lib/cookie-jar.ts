import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { BrowserContext, Cookie } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Determine environment - local vs production
const isLocal = process.env.BASE_URL?.includes('localhost') || false;

// User roles for multi-user testing
export type UserRole = 'default' | 'owner' | 'viewer';

// Cookie jar paths - separate for local vs production
const AUTH_E2E_DIR = path.join(__dirname, '..', '..', '..', 'run.auth', 'e2e');

function getAuthCookieJarPathForUser(role: UserRole = 'default'): string {
  const suffix = role === 'default' ? '' : `-${role}`;
  if (isLocal) {
    return path.join(AUTH_E2E_DIR, '.auth', `cookies-local${suffix}.json`);
  }
  return path.join(AUTH_E2E_DIR, '.auth', `cookies${suffix}.json`);
}

const AUTH_COOKIE_JAR_PATH = getAuthCookieJarPathForUser('default');

// Local cookie jar for gpx-specific state
const LOCAL_COOKIE_JAR_PATH = path.join(__dirname, '..', '.auth', 'cookies.json');

// Get email for a user role
export function getEmailForRole(role: UserRole): string {
  const baseEmail = 'jeanclaude@defcon.run';
  if (role === 'default') {
    return baseEmail;
  }
  const [local, domain] = baseEmail.split('@');
  return `${local}+${role}@${domain}`;
}

interface CookieJar {
  cookies: Cookie[];
  savedAt: string;
  expiresAt: string;
}

/**
 * Load cookies from the run.auth e2e cookie jar.
 * This reuses the authenticated session from the auth tests.
 *
 * For local testing: BASE_URL=http://localhost:3003 npm test
 * Requires running run.auth e2e tests with BASE_URL=http://localhost:3002 first
 */
export async function loadAuthCookies(context: BrowserContext): Promise<boolean> {
  console.log(`Environment: ${isLocal ? 'LOCAL' : 'PRODUCTION'}`);
  console.log(`Looking for cookie jar at: ${AUTH_COOKIE_JAR_PATH}`);

  if (!fs.existsSync(AUTH_COOKIE_JAR_PATH)) {
    console.log('No auth cookie jar found at:', AUTH_COOKIE_JAR_PATH);
    if (isLocal) {
      console.log('For local testing, run the run.auth e2e tests first:');
      console.log('  cd ../run.auth/e2e');
      console.log('  BASE_URL=http://localhost:3002 npm test');
    } else {
      console.log('Run the run.auth e2e tests first to create a session.');
    }
    return false;
  }

  try {
    const jar: CookieJar = JSON.parse(fs.readFileSync(AUTH_COOKIE_JAR_PATH, 'utf-8'));

    // Check if cookies are expired
    if (new Date(jar.expiresAt) < new Date()) {
      console.log('Auth cookie jar expired. Re-run run.auth e2e tests.');
      return false;
    }

    await context.addCookies(jar.cookies);
    console.log(`Auth cookies loaded from ${AUTH_COOKIE_JAR_PATH}`);
    return true;
  } catch (error) {
    console.error('Failed to load auth cookies:', error);
    return false;
  }
}

/**
 * Check if auth cookie jar exists and is valid.
 */
export function hasAuthCookieJar(): boolean {
  if (!fs.existsSync(AUTH_COOKIE_JAR_PATH)) {
    return false;
  }

  try {
    const jar: CookieJar = JSON.parse(fs.readFileSync(AUTH_COOKIE_JAR_PATH, 'utf-8'));
    return new Date(jar.expiresAt) > new Date();
  } catch {
    return false;
  }
}

/**
 * Save cookies to local gpx cookie jar (for gpx-specific state if needed).
 */
export async function saveCookies(context: BrowserContext): Promise<void> {
  const cookies = await context.cookies();

  const sessionCookie = cookies.find(c => c.name === 'sess_auth');
  const expiresAt = sessionCookie?.expires
    ? new Date(sessionCookie.expires * 1000).toISOString()
    : new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();

  const jar: CookieJar = {
    cookies,
    savedAt: new Date().toISOString(),
    expiresAt,
  };

  const dir = path.dirname(LOCAL_COOKIE_JAR_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(LOCAL_COOKIE_JAR_PATH, JSON.stringify(jar, null, 2));
  console.log(`Cookies saved to ${LOCAL_COOKIE_JAR_PATH}`);
}

export function getAuthCookieJarPath(): string {
  return AUTH_COOKIE_JAR_PATH;
}

// Multi-user support

export async function loadAuthCookiesForUser(context: BrowserContext, role: UserRole): Promise<boolean> {
  const cookiePath = getAuthCookieJarPathForUser(role);

  console.log(`Environment: ${isLocal ? 'LOCAL' : 'PRODUCTION'}`);
  console.log(`Looking for cookie jar for ${role} at: ${cookiePath}`);

  if (!fs.existsSync(cookiePath)) {
    console.log(`No auth cookie jar found for ${role} at:`, cookiePath);
    if (isLocal) {
      console.log(`For local testing with ${role} user, run:`);
      console.log(`  cd apps/run.auth/e2e`);
      console.log(`  TEST_USER_ROLE=${role} BASE_URL=http://localhost:3002 npm test`);
    }
    return false;
  }

  try {
    const jar: CookieJar = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));

    if (new Date(jar.expiresAt) < new Date()) {
      console.log(`Auth cookie jar for ${role} expired.`);
      return false;
    }

    await context.addCookies(jar.cookies);
    console.log(`Auth cookies loaded for ${role} from ${cookiePath}`);
    return true;
  } catch (error) {
    console.error(`Failed to load auth cookies for ${role}:`, error);
    return false;
  }
}

export function hasAuthCookieJarForUser(role: UserRole): boolean {
  const cookiePath = getAuthCookieJarPathForUser(role);

  if (!fs.existsSync(cookiePath)) {
    return false;
  }

  try {
    const jar: CookieJar = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
    return new Date(jar.expiresAt) > new Date();
  } catch {
    return false;
  }
}
