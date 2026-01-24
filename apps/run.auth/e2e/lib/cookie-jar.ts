import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { BrowserContext, Cookie } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Determine environment - local vs production
const isLocal = process.env.BASE_URL?.includes('localhost') || false;

// User roles for multi-user testing
export type UserRole = 'accounta' | 'accountb' | 'accountc';

// Get cookie jar path for a specific user role
export function getCookieJarPathForUser(role: UserRole = 'accounta'): string {
  if (isLocal) {
    return path.join(__dirname, '..', '.auth', `cookies-local-${role}.json`);
  }
  return path.join(__dirname, '..', '.auth', `cookies-${role}.json`);
}

// Default cookie jar path (accounta is the default)
const COOKIE_JAR_PATH = getCookieJarPathForUser('accounta');

interface CookieJar {
  cookies: Cookie[];
  savedAt: string;
  expiresAt: string;
}

export async function saveCookies(context: BrowserContext): Promise<void> {
  const cookies = await context.cookies();

  // Find session cookie to determine expiry
  const sessionCookie = cookies.find(c => c.name === 'sess_auth');
  const expiresAt = sessionCookie?.expires
    ? new Date(sessionCookie.expires * 1000).toISOString()
    : new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(); // 15 days default

  const jar: CookieJar = {
    cookies,
    savedAt: new Date().toISOString(),
    expiresAt,
  };

  // Ensure directory exists
  const dir = path.dirname(COOKIE_JAR_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(COOKIE_JAR_PATH, JSON.stringify(jar, null, 2));
  console.log(`Cookies saved to ${COOKIE_JAR_PATH}`);
}

export async function loadCookies(context: BrowserContext): Promise<boolean> {
  if (!fs.existsSync(COOKIE_JAR_PATH)) {
    console.log('No cookie jar found');
    return false;
  }

  try {
    const jar: CookieJar = JSON.parse(fs.readFileSync(COOKIE_JAR_PATH, 'utf-8'));

    // Check if cookies are expired
    if (new Date(jar.expiresAt) < new Date()) {
      console.log('Cookie jar expired, removing');
      fs.unlinkSync(COOKIE_JAR_PATH);
      return false;
    }

    await context.addCookies(jar.cookies);
    console.log(`Cookies loaded from ${COOKIE_JAR_PATH}`);
    return true;
  } catch (error) {
    console.error('Failed to load cookies:', error);
    return false;
  }
}

export function hasCookieJar(): boolean {
  if (!fs.existsSync(COOKIE_JAR_PATH)) {
    return false;
  }

  try {
    const jar: CookieJar = JSON.parse(fs.readFileSync(COOKIE_JAR_PATH, 'utf-8'));
    return new Date(jar.expiresAt) > new Date();
  } catch {
    return false;
  }
}

export function clearCookieJar(): void {
  if (fs.existsSync(COOKIE_JAR_PATH)) {
    fs.unlinkSync(COOKIE_JAR_PATH);
    console.log('Cookie jar cleared');
  }
}

export function getCookieJarPath(): string {
  return COOKIE_JAR_PATH;
}

// Multi-user support functions

export async function saveCookiesForUser(context: BrowserContext, role: UserRole): Promise<void> {
  const cookies = await context.cookies();
  const cookiePath = getCookieJarPathForUser(role);

  const sessionCookie = cookies.find(c => c.name === 'sess_auth');
  const expiresAt = sessionCookie?.expires
    ? new Date(sessionCookie.expires * 1000).toISOString()
    : new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();

  const jar: CookieJar = {
    cookies,
    savedAt: new Date().toISOString(),
    expiresAt,
  };

  const dir = path.dirname(cookiePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(cookiePath, JSON.stringify(jar, null, 2));
  console.log(`Cookies saved for ${role} to ${cookiePath}`);
}

export async function loadCookiesForUser(context: BrowserContext, role: UserRole): Promise<boolean> {
  const cookiePath = getCookieJarPathForUser(role);

  if (!fs.existsSync(cookiePath)) {
    console.log(`No cookie jar found for ${role} at ${cookiePath}`);
    return false;
  }

  try {
    const jar: CookieJar = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));

    if (new Date(jar.expiresAt) < new Date()) {
      console.log(`Cookie jar for ${role} expired, removing`);
      fs.unlinkSync(cookiePath);
      return false;
    }

    await context.addCookies(jar.cookies);
    console.log(`Cookies loaded for ${role} from ${cookiePath}`);
    return true;
  } catch (error) {
    console.error(`Failed to load cookies for ${role}:`, error);
    return false;
  }
}

export function hasCookieJarForUser(role: UserRole): boolean {
  const cookiePath = getCookieJarPathForUser(role);

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

// Get email for a user role
// All roles use + addressing: jeanclaude+accounta@defcon.run, etc.
export function getEmailForRole(role: UserRole): string {
  const baseEmail = 'jeanclaude@defcon.run';
  const [local, domain] = baseEmail.split('@');
  return `${local}+${role}@${domain}`;
}
