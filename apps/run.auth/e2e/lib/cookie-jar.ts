import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { BrowserContext, Cookie } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_JAR_PATH = path.join(__dirname, '..', '.auth', 'cookies.json');

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
