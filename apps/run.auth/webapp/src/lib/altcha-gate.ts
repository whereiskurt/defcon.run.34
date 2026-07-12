import { createHmac, createHash, timingSafeEqual } from "crypto";

/**
 * Altcha-on-OAuth gate primitives.
 *
 * Pure requirement math + HMAC-signed cookie helpers + an in-memory replay guard.
 * Signing reuses ALTCHA_HMAC_KEY (already provisioned) so no new secret is required.
 */

const ALTCHA_HMAC_KEY = process.env.ALTCHA_HMAC_KEY || "";

export const ALTCHA_OK_COOKIE = "altcha_ok";
export const ALTCHA_PROGRESS_COOKIE = "altcha_progress";

export const BASE_MAXNUMBER = 2_000_000; // matches the existing email-login difficulty
export const OK_TTL_MS = 10 * 60 * 1000; // long enough to finish the interaction, short enough to not be a standing bypass
export const PROGRESS_TTL_MS = 10 * 60 * 1000;
const SOLUTION_TTL_MS = 2 * 60 * 1000; // matches the challenge expiry

// Jail level tables. Tunable in ONE place. Jail always exceeds the baseline single 2M solve.
export const COUNT_BY_LEVEL: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 6, 5: 8 };
export const DIFFICULTY_BY_LEVEL: Record<number, number> = {
  1: 2_000_000,
  2: 3_000_000,
  3: 4_000_000,
  4: 6_000_000,
  5: 8_000_000,
};

export type ChallengeRequirement = { count: number; difficulty: number };
export type JailProfile = { jailed?: boolean; jailLevel?: number } | null | undefined;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function isBaselineEnforced(): boolean {
  return process.env.ALTCHA_OAUTH_ENFORCED === "true";
}

/**
 * How many Altcha solves (and at what per-solve maxNumber) this subject must complete.
 * Pure aside from the ALTCHA_OAUTH_ENFORCED env read (override via opts in tests).
 */
export function challengeRequirement(
  profile: JailProfile,
  opts?: { baselineEnforced?: boolean }
): ChallengeRequirement {
  const jailed = profile?.jailed === true;
  const baseline = opts?.baselineEnforced ?? isBaselineEnforced();
  if (!jailed && !baseline) return { count: 0, difficulty: 0 };
  if (!jailed) return { count: 1, difficulty: BASE_MAXNUMBER };
  const level = clamp(profile?.jailLevel && profile.jailLevel >= 1 ? profile.jailLevel : 1, 1, 5);
  return { count: COUNT_BY_LEVEL[level], difficulty: DIFFICULTY_BY_LEVEL[level] };
}

// --- signed payloads: base64url(json) + "." + base64url(hmac) ---

export function signPayload(obj: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(obj)).toString("base64url");
  const sig = createHmac("sha256", ALTCHA_HMAC_KEY).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyPayload<T = Record<string, unknown>>(value: string | undefined | null): T | null {
  if (!value || typeof value !== "string") return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac("sha256", ALTCHA_HMAC_KEY).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof obj.exp === "number" && Date.now() > obj.exp) return null;
    return obj as T;
  } catch {
    return null;
  }
}

// --- altcha_ok (requirement cleared) ---

export function emailKey(email: string): string {
  return `email:${email.toLowerCase()}`;
}

export function makeAltchaOk(key: string): string {
  const now = Date.now();
  return signPayload({ k: key, iat: now, exp: now + OK_TTL_MS });
}

export function readAltchaOk(cookieValue: string | undefined, acceptableKeys: string[]): boolean {
  const payload = verifyPayload<{ k: string }>(cookieValue);
  if (!payload || typeof payload.k !== "string") return false;
  return acceptableKeys.includes(payload.k);
}

// --- altcha_progress (partial jail progress) ---

export function makeProgress(key: string, solved: number): string {
  const now = Date.now();
  return signPayload({ k: key, solved, iat: now, exp: now + PROGRESS_TTL_MS });
}

export function readProgress(cookieValue: string | undefined, key: string): number {
  const payload = verifyPayload<{ k: string; solved: number }>(cookieValue);
  if (!payload || payload.k !== key) return 0;
  return typeof payload.solved === "number" ? payload.solved : 0;
}

// --- in-memory replay guard (per-instance; distributed guard is a documented follow-up) ---

const usedSolutions = new Map<string, number>();

export function markSolutionUsed(payload: string): boolean {
  const now = Date.now();
  if (usedSolutions.size > 5000) {
    for (const [k, exp] of usedSolutions) if (exp < now) usedSolutions.delete(k);
  }
  const hash = createHash("sha256").update(payload).digest("hex");
  const seen = usedSolutions.get(hash);
  if (seen !== undefined && seen > now) return false;
  usedSolutions.set(hash, now + SOLUTION_TTL_MS);
  return true;
}

// --- cookie clearing (Pages Router Set-Cookie string) ---

export function clearGateCookieHeader(name: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  const domain = process.env.AUTH_COOKIE_DOMAIN;
  const parts = [`${name}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
  if (!isDev) parts.push("Secure");
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}
