# Altcha-on-OAuth Enforcement + Jail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring OAuth logins (GitHub/Discord/LinkedIn) to Altcha parity with the email flow, and add a per-user admin-toggled "jail" that dials up Altcha friction — all enforced at the single OIDC interaction chokepoint.

**Architecture:** A pure `src/lib/altcha-gate.ts` holds the requirement math (`challengeRequirement`), HMAC cookie sign/verify, and an in-memory replay guard. The Pages-Router OIDC interaction route `[uid].ts` reads the caller's `AuthProfile` live and, when a challenge is required and no valid `altcha_ok` cookie is present, redirects to a new `/challenge` page. That page solves Altcha `N` times against a session-aware `/api/captcha/challenge` and posts each solution to a new `/api/captcha/verify-login`, which sets the `altcha_ok` cookie once satisfied. The email `/api/login` sets the same cookie for non-jailed users so they aren't double-challenged. Jail state lives on `AuthProfile` and is toggled from the PR #542 admin identity drawer.

**Tech Stack:** Next.js 16 (App + Pages Router), next-auth v5 beta, `altcha-lib` (server `createChallenge`/`verifySolution`), `altcha` web component (client), ElectroDB + DynamoDB, `node:crypto` HMAC, vitest.

## Global Constraints

- **Ships inert-by-default.** `ALTCHA_OAUTH_ENFORCED` is unset in prod → `challengeRequirement` returns `{count:0}` for non-jailed users, and no users are jailed → the gate never fires on real logins until explicitly toggled. This is the safety valve; do not change the default.
- **Node ≥ 22.12 for vitest.** Run `nvm use 23.6.0` before `npm test` (default v22.1.0 fails to start; looks like a test failure but is environmental).
- **Reuse `ALTCHA_HMAC_KEY`** (already provisioned) to HMAC-sign the `altcha_ok` / `altcha_progress` cookies. Do NOT introduce a new required env var — that adds deploy friction.
- **Enforcement is gate-only (v1 decision).** The gate does a live `getAuthProfile` read every fire. Jail bumps `sessionVersion` for parity with lock (kicks the user from consuming services) but does NOT instantly invalidate a warm run.auth session — a jailed user on a warm oidc `_session` silent-SSOs past the gate until that session lapses or they re-login. This is a documented v1 limitation (Task 9), not a bug.
- **Difficulty/count is server-derived only.** The client never supplies its own `maxNumber` or solve count — both come from `challengeRequirement(profile)` server-side.
- **Manual body validation, no zod.** Match the existing admin routes.
- **Cookie options** mirror the app: `httpOnly`, `secure: !isDev`, `sameSite: "lax"`, `domain: process.env.AUTH_COOKIE_DOMAIN`, `path: "/"`.
- **Commit style:** end each commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility | Task |
|------|----------------|------|
| `src/entities/auth-profile.ts` | +`jailed`/`jailLevel`/`jailReason`/`jailedAt` attributes | 1 |
| `src/lib/altcha-gate.ts` (NEW) | `challengeRequirement`, cookie sign/verify, replay guard, level tables, enforcement flag | 2 |
| `src/lib/altcha-gate.test.ts` (NEW) | Unit tests for all of the above | 2 |
| `src/app/api/captcha/challenge/route.ts` | Session-aware `maxNumber` from profile | 3 |
| `src/app/api/captcha/verify-login/route.ts` (NEW) | Verify solve, track progress, set `altcha_ok` | 3 |
| `src/pages/api/oidc/interaction/[uid].ts` | Inject the gate before `interactionResult` | 4 |
| `src/app/api/login/route.ts` | Pre-clear non-jailed email users with `altcha_ok` | 4 |
| `src/app/challenge/page.tsx` (NEW) | Multi-solve challenge UI | 5 |
| `src/app/challenge/layout.tsx` (NEW) | Own root layout (globals.css) — avoids `(authlogin)` redirect landmine | 5 |
| `src/app/api/admin/identities/[userId]/jail/route.ts` (NEW) | Admin jail/release route (mirrors lock) | 6 |
| `src/lib/identity-report.ts` | Surface jail fields on report rows + tile | 7 |
| `src/app/api/admin/identities/route.ts` | Projection + CSV column for jail | 7 |
| `src/app/admin/AdminActions.tsx` | `JailAction` component | 8 |
| `src/app/admin/AdminConsole.tsx` | `JAILED L{n}` badge, jailed pill, drawer wiring | 8 |
| `architecture.md` (repo root) + follow-up todo | Document env + v1 limitation | 9 |

---

## Task 1: Jail data model on AuthProfile

**Files:**
- Modify: `src/entities/auth-profile.ts` (attributes block, after `lockedAt` at ~line 172)

**Interfaces:**
- Produces: four new sparse ElectroDB attributes on `AuthProfile` and thus on `getAuthProfile(userId)`'s return: `jailed?: boolean`, `jailLevel?: number`, `jailReason?: string`, `jailedAt?: number`. Adding attributes to an ElectroDB entity is backward-compatible (sparse; no migration, no re-index).

- [ ] **Step 1: Add the attributes.** In the `attributes` map, immediately after the `lockedAt` attribute (currently ends ~line 174), insert:

```ts
      // Jail: punitive per-user Altcha friction (separate from lockedOut).
      // Toggled from the admin identity console; dials PoW difficulty AND solve count.
      jailed: {
        type: "boolean",
        default: false,
      },
      // Jail severity 1..5 (meaningful only when jailed)
      jailLevel: {
        type: "number",
      },
      // Admin note for why the user was jailed
      jailReason: {
        type: "string",
      },
      // When the jail was applied
      jailedAt: {
        type: "number",
      },
```

- [ ] **Step 2: Typecheck.** Run: `npx tsc --noEmit` (from `apps/run.auth/webapp`). Expected: no new errors from this file.

- [ ] **Step 3: Run existing suite to confirm no regression.**

Run: `nvm use 23.6.0 && npm test`
Expected: 51 passed (unchanged).

- [ ] **Step 4: Commit.**

```bash
git add src/entities/auth-profile.ts
git commit -m "feat(auth): add jail fields to AuthProfile entity"
```

---

## Task 2: `altcha-gate.ts` — pure requirement math, cookie sign/verify, replay guard

This is the security core. Full TDD.

**Files:**
- Create: `src/lib/altcha-gate.ts`
- Test: `src/lib/altcha-gate.test.ts`

**Interfaces:**
- Consumes: `process.env.ALTCHA_HMAC_KEY`, `process.env.ALTCHA_OAUTH_ENFORCED`.
- Produces (imported by Tasks 3 & 4):
  - `challengeRequirement(profile, opts?): { count: number; difficulty: number }`
  - `signPayload(obj): string`, `verifyPayload<T>(value): T | null`
  - `makeAltchaOk(key): string`, `readAltchaOk(cookieValue, acceptableKeys): boolean`
  - `makeProgress(key, solved): string`, `readProgress(cookieValue, key): number`
  - `markSolutionUsed(payload): boolean`
  - `emailKey(email): string`, `clearGateCookieHeader(name): string`
  - constants: `ALTCHA_OK_COOKIE`, `ALTCHA_PROGRESS_COOKIE`, `BASE_MAXNUMBER`, `OK_TTL_MS`, `PROGRESS_TTL_MS`, `isBaselineEnforced()`

- [ ] **Step 1: Write the failing test.** Create `src/lib/altcha-gate.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ALTCHA_HMAC_KEY must be set BEFORE importing the module (it reads at import for signing).
// We set it here and import dynamically inside tests to control env.
const KEY = "test-hmac-key-1234567890";

async function load(env: Record<string, string | undefined> = {}) {
  vi.resetModules();
  vi.stubEnv("ALTCHA_HMAC_KEY", KEY);
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v ?? "");
  return await import("./altcha-gate");
}

afterEach(() => vi.unstubAllEnvs());

describe("challengeRequirement", () => {
  it("returns count 0 when not jailed and baseline disabled", async () => {
    const m = await load({ ALTCHA_OAUTH_ENFORCED: undefined });
    expect(m.challengeRequirement({})).toEqual({ count: 0, difficulty: 0 });
    expect(m.challengeRequirement(null)).toEqual({ count: 0, difficulty: 0 });
  });

  it("returns single baseline solve when baseline enabled and not jailed", async () => {
    const m = await load({ ALTCHA_OAUTH_ENFORCED: "true" });
    expect(m.challengeRequirement({})).toEqual({ count: 1, difficulty: m.BASE_MAXNUMBER });
  });

  it("escalates count and difficulty by jail level (jail overrides baseline-off)", async () => {
    const m = await load({ ALTCHA_OAUTH_ENFORCED: undefined });
    expect(m.challengeRequirement({ jailed: true, jailLevel: 3 })).toEqual({ count: 4, difficulty: 4_000_000 });
    expect(m.challengeRequirement({ jailed: true, jailLevel: 5 })).toEqual({ count: 8, difficulty: 8_000_000 });
  });

  it("treats jailed with missing/low level as level 1, clamps >5 to 5", async () => {
    const m = await load();
    expect(m.challengeRequirement({ jailed: true })).toEqual({ count: 2, difficulty: 2_000_000 });
    expect(m.challengeRequirement({ jailed: true, jailLevel: 99 })).toEqual({ count: 8, difficulty: 8_000_000 });
  });
});

describe("signPayload / verifyPayload", () => {
  it("round-trips a payload", async () => {
    const m = await load();
    const token = m.signPayload({ k: "sub-1", n: 2 });
    expect(m.verifyPayload<{ k: string; n: number }>(token)).toMatchObject({ k: "sub-1", n: 2 });
  });
  it("rejects a tampered body", async () => {
    const m = await load();
    const token = m.signPayload({ k: "sub-1" });
    const tampered = "x" + token.slice(1);
    expect(m.verifyPayload(tampered)).toBeNull();
  });
  it("rejects a wrong signature", async () => {
    const m = await load();
    const token = m.signPayload({ k: "sub-1" });
    const [body] = token.split(".");
    expect(m.verifyPayload(`${body}.deadbeef`)).toBeNull();
  });
  it("rejects an expired payload", async () => {
    const m = await load();
    const token = m.signPayload({ k: "sub-1", exp: Date.now() - 1000 });
    expect(m.verifyPayload(token)).toBeNull();
  });
  it("returns null on empty/garbage input", async () => {
    const m = await load();
    expect(m.verifyPayload(undefined)).toBeNull();
    expect(m.verifyPayload("")).toBeNull();
    expect(m.verifyPayload("no-dot")).toBeNull();
  });
});

describe("altcha_ok cookie", () => {
  it("accepts a cookie whose key is in the acceptable set", async () => {
    const m = await load();
    const c = m.makeAltchaOk("sub-1");
    expect(m.readAltchaOk(c, ["sub-1", "email:a@b.com"])).toBe(true);
  });
  it("rejects a cookie whose key is not acceptable (cross-user replay)", async () => {
    const m = await load();
    const c = m.makeAltchaOk("sub-1");
    expect(m.readAltchaOk(c, ["sub-2"])).toBe(false);
  });
  it("emailKey lowercases", async () => {
    const m = await load();
    expect(m.emailKey("Foo@Bar.COM")).toBe("email:foo@bar.com");
  });
});

describe("progress cookie", () => {
  it("returns solved count for matching key, 0 for mismatch", async () => {
    const m = await load();
    const c = m.makeProgress("sub-1", 2);
    expect(m.readProgress(c, "sub-1")).toBe(2);
    expect(m.readProgress(c, "sub-2")).toBe(0);
    expect(m.readProgress(undefined, "sub-1")).toBe(0);
  });
});

describe("markSolutionUsed replay guard", () => {
  it("accepts a solution once then rejects the replay", async () => {
    const m = await load();
    expect(m.markSolutionUsed("payload-abc")).toBe(true);
    expect(m.markSolutionUsed("payload-abc")).toBe(false);
    expect(m.markSolutionUsed("payload-def")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm it fails.**

Run: `nvm use 23.6.0 && npx vitest run src/lib/altcha-gate.test.ts`
Expected: FAIL — `Cannot find module './altcha-gate'`.

- [ ] **Step 3: Implement `src/lib/altcha-gate.ts`.**

```ts
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
```

- [ ] **Step 4: Run to confirm pass.**

Run: `nvm use 23.6.0 && npx vitest run src/lib/altcha-gate.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Full suite + typecheck.**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/altcha-gate.ts src/lib/altcha-gate.test.ts
git commit -m "feat(auth): altcha-gate lib (requirement math, signed cookies, replay guard)"
```

---

## Task 3: Session-aware challenge issuance + verify-login endpoint

**Files:**
- Modify: `src/app/api/captcha/challenge/route.ts`
- Create: `src/app/api/captcha/verify-login/route.ts`

**Interfaces:**
- Consumes: `challengeRequirement`, `markSolutionUsed`, `readProgress`, `makeProgress`, `makeAltchaOk`, cookie constants, `OK_TTL_MS`, `PROGRESS_TTL_MS`, `BASE_MAXNUMBER` from `@/lib/altcha-gate`; `getAuthProfile` from `@/entities/auth-profile`; `verifySolution` from `altcha-lib`; `getToken` from `next-auth/jwt`.
- Produces: `POST /api/captcha/verify-login` → JSON `{ done: boolean, solved: number, required: number }` and sets `altcha_ok` on `done`. `GET /api/captcha/challenge` now returns a challenge whose `maxNumber` is profile-derived when a `sess_auth` session is present (base `2_000_000` otherwise — unchanged for the anonymous email-login path).

- [ ] **Step 1: Make the challenge route session-aware.** Replace `src/app/api/captcha/challenge/route.ts` entirely with:

```ts
import { createChallenge } from 'altcha-lib';
import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getAuthProfile } from '@/entities/auth-profile';
import { challengeRequirement, BASE_MAXNUMBER } from '@/lib/altcha-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALTCHA_HMAC_KEY = process.env.ALTCHA_HMAC_KEY;

export async function GET(req: NextRequest) {
  if (!ALTCHA_HMAC_KEY) {
    console.error('ALTCHA_HMAC_KEY environment variable is not set');
    return NextResponse.json({ error: 'Captcha service not configured' }, { status: 500 });
  }

  // Anonymous callers (email login page, pre-auth) get the baseline difficulty.
  // Authenticated callers (the /challenge page) get a difficulty derived from their
  // profile — jailed users get a harder challenge. Difficulty is NEVER client-supplied.
  let maxNumber = BASE_MAXNUMBER;
  try {
    const token = await getToken({
      req: req as any,
      secret: process.env.AUTH_JWT_SECRET?.split(','),
      cookieName: 'sess_auth',
    });
    const sub = (token?.sub || token?.email) as string | undefined;
    if (sub) {
      const profile = await getAuthProfile(sub);
      const required = challengeRequirement(profile);
      if (required.difficulty > 0) maxNumber = required.difficulty;
    }
  } catch {
    // fall back to baseline difficulty
  }

  try {
    const challenge = await createChallenge({
      hmacKey: ALTCHA_HMAC_KEY,
      maxNumber,
      expires: new Date(Date.now() + 2 * 60 * 1000),
    });
    return NextResponse.json(challenge);
  } catch (error) {
    console.error('Failed to create Altcha challenge:', error);
    return NextResponse.json({ error: 'Failed to generate challenge' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create the verify-login route.** Create `src/app/api/captcha/verify-login/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { verifySolution } from 'altcha-lib';
import { getAuthProfile } from '@/entities/auth-profile';
import {
  challengeRequirement,
  markSolutionUsed,
  readProgress,
  makeProgress,
  makeAltchaOk,
  ALTCHA_OK_COOKIE,
  ALTCHA_PROGRESS_COOKIE,
  OK_TTL_MS,
  PROGRESS_TTL_MS,
} from '@/lib/altcha-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALTCHA_HMAC_KEY = process.env.ALTCHA_HMAC_KEY;
const isDev = process.env.NODE_ENV !== 'production';

/**
 * Verifies one Altcha solution for the authenticated user's pending login, tracks
 * progress across the required number of solves, and once satisfied sets the
 * short-lived `altcha_ok` cookie that clears the OIDC interaction gate.
 */
export async function POST(req: NextRequest) {
  if (!ALTCHA_HMAC_KEY) {
    return NextResponse.json({ error: 'Captcha service not configured' }, { status: 500 });
  }

  const token = await getToken({
    req: req as any,
    secret: process.env.AUTH_JWT_SECRET?.split(','),
    cookieName: 'sess_auth',
  });
  const sub = (token?.sub || token?.email) as string | undefined;
  if (!sub) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const data = await req.json().catch(() => null);
  const altcha = data?.altcha;
  if (!altcha || typeof altcha !== 'string') {
    return NextResponse.json({ error: 'Missing solution' }, { status: 400 });
  }

  const valid = await verifySolution(altcha, ALTCHA_HMAC_KEY, true);
  if (!valid) return NextResponse.json({ error: 'Invalid or expired solution' }, { status: 403 });
  if (!markSolutionUsed(altcha)) return NextResponse.json({ error: 'Solution already used' }, { status: 403 });

  const profile = await getAuthProfile(sub);
  const required = challengeRequirement(profile);
  const count = Math.max(required.count, 1); // if we got here the caller believes a challenge is due

  const prev = readProgress(req.cookies.get(ALTCHA_PROGRESS_COOKIE)?.value, sub);
  const solved = prev + 1;

  const cookieOpts = {
    httpOnly: true,
    secure: !isDev,
    sameSite: 'lax' as const,
    domain: process.env.AUTH_COOKIE_DOMAIN,
    path: '/',
  };

  if (solved >= count) {
    const res = NextResponse.json({ done: true, solved, required: count });
    res.cookies.set(ALTCHA_OK_COOKIE, makeAltchaOk(sub), { ...cookieOpts, maxAge: OK_TTL_MS / 1000 });
    res.cookies.set(ALTCHA_PROGRESS_COOKIE, '', { ...cookieOpts, maxAge: 0 });
    return res;
  }

  const res = NextResponse.json({ done: false, solved, required: count });
  res.cookies.set(ALTCHA_PROGRESS_COOKIE, makeProgress(sub, solved), {
    ...cookieOpts,
    maxAge: PROGRESS_TTL_MS / 1000,
  });
  return res;
}
```

- [ ] **Step 3: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no new errors. (Route handlers aren't unit-tested here — the security math is covered by Task 2; behavior is verified end-to-end in Task 5's manual check.)

- [ ] **Step 4: Commit.**

```bash
git add src/app/api/captcha/challenge/route.ts src/app/api/captcha/verify-login/route.ts
git commit -m "feat(auth): session-aware challenge difficulty + verify-login progress endpoint"
```

---

## Task 4: The gate at the OIDC interaction chokepoint + email reconciliation

**Files:**
- Modify: `src/pages/api/oidc/interaction/[uid].ts`
- Modify: `src/app/api/login/route.ts`

**Interfaces:**
- Consumes: `challengeRequirement`, `readAltchaOk`, `emailKey`, `makeAltchaOk`, `clearGateCookieHeader`, `ALTCHA_OK_COOKIE`, `OK_TTL_MS` from `@/lib/altcha-gate`; `getAuthProfile`, `getAuthProfileByEmail` from `@/entities/auth-profile`.
- Produces: the interaction route redirects to `/challenge?oidc={uid}` when a challenge is due and no valid `altcha_ok` cookie is present; `/api/login` sets `altcha_ok` (email-keyed) for non-jailed email users.

- [ ] **Step 1: Add imports to `[uid].ts`.** At the top of `src/pages/api/oidc/interaction/[uid].ts`, after the existing imports (line 3), add:

```ts
import { getAuthProfile } from "@/entities/auth-profile";
import {
  challengeRequirement,
  readAltchaOk,
  emailKey,
  clearGateCookieHeader,
  ALTCHA_OK_COOKIE,
} from "@/lib/altcha-gate";
```

- [ ] **Step 2: Add the `challengePath` constant.** After the `loginPath` const (line 9), add:

```ts
const challengePath = isDev ? "/challenge" : `/${REGION_SHORT}/challenge`;
```

- [ ] **Step 3: Inject the gate.** In the `try` block, the code currently reads (around lines 62-67):

```ts
    // Determine the account ID (prefer explicit ID from sub, fall back to email)
    const accountId = (token.sub || token.email) as string;

    // Check what the interaction needs
    const { prompt } = interactionDetails;
```

Immediately AFTER `const { prompt } = interactionDetails;`, insert the gate:

```ts
    // --- Altcha-on-OAuth gate ---------------------------------------------
    // Every real login funnels through this route. A warm prompt=none silent SSO is
    // auto-satisfied inside oidc-provider and normally never reaches here; as a safety
    // belt we never challenge a prompt=none request. Otherwise, if the subject owes a
    // challenge (baseline enforced, or jailed) and hasn't cleared it, bounce to /challenge.
    const requestedPrompt = (interactionDetails.params?.prompt as string | undefined) || "";
    if (requestedPrompt !== "none") {
      const gateProfile = await getAuthProfile(accountId);
      const required = challengeRequirement(gateProfile);
      if (required.count > 0) {
        const acceptableKeys = [accountId];
        if (token.email) acceptableKeys.push(emailKey(token.email as string));
        const okCookie = req.cookies?.[ALTCHA_OK_COOKIE];
        // Pass required.count as minCount: an altcha_ok minted for a lighter
        // requirement (e.g. baseline n=1) cannot clear a heavier jail requirement.
        if (readAltchaOk(okCookie, acceptableKeys, required.count)) {
          // One-shot: clear the cookie so it can't clear a second pending login.
          res.setHeader("Set-Cookie", clearGateCookieHeader(ALTCHA_OK_COOKIE));
        } else {
          res.redirect(`${challengePath}?oidc=${uid}`);
          return;
        }
      }
    }
    // --- end gate ---------------------------------------------------------
```

- [ ] **Step 4: Typecheck the interaction route.**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Reconcile email login.** In `src/app/api/login/route.ts`:

  (a) Add imports near the top (after the existing `verifySolution` import):

```ts
import { getAuthProfileByEmail } from "@/entities/auth-profile";
import { makeAltchaOk, emailKey, ALTCHA_OK_COOKIE, OK_TTL_MS } from "@/lib/altcha-gate";
```

  (b) Find the success path. After `markChallengeUsed(altcha)` passes (currently ~line 120) and after `signIn("nodemailer", …)` succeeds, locate the final success `return NextResponse.json(...)` (the "Success. Check your email." response). Replace that single return with:

```ts
    // Baseline reconciliation: a successful email Altcha satisfies the OAuth gate's
    // single-solve baseline, so the user isn't double-challenged at the OIDC interaction.
    // Jailed users are intentionally NOT pre-cleared — they must face the full escalated
    // challenge at /challenge after authenticating.
    let precleared = false;
    try {
      const existing = await getAuthProfileByEmail(email);
      precleared = !existing?.jailed;
    } catch {
      precleared = true; // fail-open to baseline: the email flow already solved an Altcha
    }

    const successRes = NextResponse.json({ message: "Success. Check your email." });
    if (precleared) {
      const isDev = process.env.NODE_ENV !== "production";
      successRes.cookies.set(ALTCHA_OK_COOKIE, makeAltchaOk(emailKey(email), 1), {
        httpOnly: true,
        secure: !isDev,
        sameSite: "lax",
        domain: process.env.AUTH_COOKIE_DOMAIN,
        path: "/",
        maxAge: OK_TTL_MS / 1000,
      });
    }
    return successRes;
```

  > **Executor note:** match the EXISTING success response's JSON shape and status. If the current success return uses a different key than `message` (e.g. a plain string or `{ success: true }`), preserve that exact shape — only wrap it so you can attach the cookie. Do not change the status code.

- [ ] **Step 6: Typecheck + full suite.**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all green (51 passing unchanged).

- [ ] **Step 7: Commit.**

```bash
git add src/pages/api/oidc/interaction/\[uid\].ts src/app/api/login/route.ts
git commit -m "feat(auth): inject altcha gate at OIDC interaction + email pre-clear reconciliation"
```

---

## Task 5: The `/challenge` page (multi-solve UI)

Placed at `src/app/challenge/` (its OWN route + layout), NOT under `(authlogin)`, to avoid the documented landmine where the `(authlogin)` group layout can redirect/de-style authenticated pages (the auth admin dashboard hit this — it needed its own root layout with `globals.css`). The `/challenge` page is reached by an already-authenticated user, so it must not be bounced by any "already signed in → go to run.human" logic in the login group.

**Files:**
- Create: `src/app/challenge/layout.tsx`
- Create: `src/app/challenge/page.tsx`

**Interfaces:**
- Consumes: `GET /api/captcha/challenge` (session-aware difficulty), `POST /api/captcha/verify-login` (`{ done, solved, required }`). On `done`, redirects to `${basePath}/api/oidc/interaction/{uid}` which now finds a valid `altcha_ok` and completes the login.

- [ ] **Step 1: Confirm the `altcha-widget` JSX typing works.** Grep for how the login page's `<altcha-widget>` compiles:

Run: `grep -rn "altcha-widget" src/ && grep -rn "IntrinsicElements" src/`
Expected: the login page uses `<altcha-widget>`. If there's an ambient declaration (a `.d.ts` with `IntrinsicElements['altcha-widget']`), reuse it. If the login page relies on a local `// @ts-expect-error` or a loose declaration, mirror the SAME mechanism in the new page. Do not invent a new global type if one exists.

- [ ] **Step 2: Create the layout.** Create `src/app/challenge/layout.tsx` (mirror `src/app/admin/layout.tsx` — read it first for the exact globals.css import path and root `<html>`/`<body>` structure it uses):

```tsx
import "../globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Verify — run.auth",
};

export default function ChallengeLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

  > **Executor note:** If `src/app/admin/layout.tsx` imports globals via a different relative path or wraps a provider (e.g. HeroUI), copy that structure exactly so the page is styled consistently.

- [ ] **Step 3: Create the page.** Create `src/app/challenge/page.tsx`:

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';

const basePath =
  process.env.NODE_ENV === 'production'
    ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}`
    : '';

export default function ChallengePage() {
  const [oidc, setOidc] = useState<string | null>(null);
  const [solved, setSolved] = useState(0);
  const [required, setRequired] = useState(1);
  const [widgetKey, setWidgetKey] = useState(0); // bump to remount the widget for the next solve
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOidc(params.get('oidc'));
    import('altcha').catch(console.error); // registers <altcha-widget>
  }, []);

  const finish = useCallback((uid: string) => {
    window.location.href = `${basePath}/api/oidc/interaction/${uid}`;
  }, []);

  const onStateChange = useCallback(
    async (ev: any) => {
      if (ev?.detail?.state !== 'verified' || !ev.detail.payload || busy || done) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`${basePath}/api/captcha/verify-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ altcha: ev.detail.payload }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body?.error || 'Verification failed. Try again.');
          setWidgetKey((k) => k + 1); // reset for a fresh attempt
          return;
        }
        setSolved(body.solved ?? solved + 1);
        setRequired(body.required ?? required);
        if (body.done) {
          setDone(true);
          if (oidc) finish(oidc);
          else setError('Missing login context. Please restart your login.');
        } else {
          setWidgetKey((k) => k + 1); // arm the next solve
        }
      } catch {
        setError('Network error. Try again.');
        setWidgetKey((k) => k + 1);
      } finally {
        setBusy(false);
      }
    },
    [busy, done, oidc, required, solved, finish]
  );

  return (
    <div style={{ maxWidth: 420, margin: '10vh auto', padding: 24, textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>One more step</h1>
      <p style={{ color: '#666', marginBottom: 20 }}>
        Complete the verification to finish signing in.
        {required > 1 && ` (${Math.min(solved, required)} of ${required} solved)`}
      </p>

      {done ? (
        <p style={{ color: '#16a34a', fontWeight: 600 }}>Verified — completing sign-in…</p>
      ) : (
        // key forces a full remount so the widget re-fetches a fresh challenge for each solve
        // @ts-expect-error — altcha-widget is a web component (mirror the login page's mechanism)
        <altcha-widget
          key={widgetKey}
          challengeurl={`${basePath}/api/captcha/challenge`}
          onstatechange={onStateChange}
          hidefooter
          hidelogo
        />
      )}

      {busy && <p style={{ color: '#666', marginTop: 12 }}>Checking…</p>}
      {error && <p style={{ color: '#dc2626', marginTop: 12 }}>{error}</p>}
    </div>
  );
}
```

  > **Executor note:** Line ~ the `<altcha-widget>` — replace the `@ts-expect-error` with whatever the login page uses if it has a proper ambient type (Step 1). Attaching `onstatechange` as a React prop works because the login page does the same (`handleAltchaStateChange`); if the login page instead attaches the listener imperatively via a ref, mirror THAT approach.

- [ ] **Step 4: Build to verify the new routes compile.**

Run: `npx tsc --noEmit` then `npm run build` (or at minimum `npx next build` up to type/lint of the new pages).
Expected: build succeeds; `/challenge` route is emitted.

- [ ] **Step 5: Manual end-to-end smoke (local).** Start the dev server and exercise the flow with baseline enforcement ON:

```bash
ALTCHA_OAUTH_ENFORCED=true PORT=3002 npm run dev
```

Verify by driving a real OAuth login (see the /verify skill or run.auth e2e harness):
  - Fresh GitHub login → after callback, browser lands on `/challenge`, solves once, redirects to `/api/oidc/interaction/{uid}`, login completes. ✅
  - With `ALTCHA_OAUTH_ENFORCED` unset → no `/challenge` detour (gate inert). ✅
  - Email login (baseline on) → NOT double-challenged (pre-clear cookie). ✅

  > If a full OAuth round-trip isn't feasible locally, at minimum: (1) hit `GET /api/captcha/challenge` with no session → 2M maxNumber; (2) confirm `/challenge` renders the widget; (3) unit coverage from Task 2 backs the requirement/cookie logic. Record what was and wasn't exercised.

- [ ] **Step 6: Commit.**

```bash
git add src/app/challenge/layout.tsx src/app/challenge/page.tsx
git commit -m "feat(auth): /challenge page — multi-solve altcha wall for gated logins"
```

---

## Task 6: Admin jail/release route

**Files:**
- Create: `src/app/api/admin/identities/[userId]/jail/route.ts`

**Interfaces:**
- Consumes: `auth`, `requireAdmin`, `revalidateAdmin`, `SessionLike`, `AuthProfile`, `getAuthProfile` (all already used by the sibling `lock/route.ts`).
- Produces: `POST /api/admin/identities/{userId}/jail` with body `{ jailed: boolean, level?: 1..5, reason?: string }` → sets/clears jail fields, bumps `sessionVersion`, returns `{ ok, jailed, jailLevel?, sessionVersion }`. 404 on non-admin (identical to lock).

- [ ] **Step 1: Create the route** (mirrors `identities/[userId]/lock/route.ts` exactly):

```ts
import { NextRequest } from "next/server";
import { auth } from "@/config/auth";
import { requireAdmin, revalidateAdmin, type SessionLike } from "@/lib/admin-gate";
import { AuthProfile, getAuthProfile } from "@/entities/auth-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response(null, { status: 404 });

async function gateOk(session: SessionLike): Promise<boolean> {
  const gate = requireAdmin(session);
  if (!gate.ok) return false;
  return revalidateAdmin(session?.user?.id);
}

/**
 * Jail/release a run.auth identity from the admin console. SESSION-gated, mirroring
 * the sibling lock route. Jail dials up Altcha friction at login (see altcha-gate).
 * Bumps sessionVersion for parity with lock (kicks consuming-service sessions); note
 * that a warm oidc _session can still silent-SSO past the gate until it lapses.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!(await gateOk(session))) return NOT_FOUND();

  const { userId } = await params;

  const body = await req.json().catch(() => null);
  const jailed = body?.jailed;
  const level = body?.level;
  const reason = body?.reason;
  if (typeof jailed !== "boolean") return new Response(null, { status: 400 });
  if (jailed && (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 5)) {
    return new Response(null, { status: 400 });
  }
  if (reason !== undefined && (typeof reason !== "string" || reason.length > 280)) {
    return new Response(null, { status: 400 });
  }

  const profile = await getAuthProfile(userId);
  if (!profile) return NOT_FOUND();
  const nextVersion = (profile.sessionVersion ?? 1) + 1;

  if (jailed) {
    await AuthProfile.update({ userId })
      .set({
        jailed: true,
        jailLevel: level,
        jailReason: reason || "Jailed by admin console",
        jailedAt: Date.now(),
        sessionVersion: nextVersion,
      })
      .go();
  } else {
    await AuthProfile.update({ userId })
      .set({ jailed: false, sessionVersion: nextVersion })
      .remove(["jailLevel", "jailReason", "jailedAt"])
      .go();
  }

  return Response.json({
    ok: true,
    jailed,
    jailLevel: jailed ? level : undefined,
    sessionVersion: nextVersion,
  });
}
```

- [ ] **Step 2: Typecheck.**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit.**

```bash
git add src/app/api/admin/identities/\[userId\]/jail/route.ts
git commit -m "feat(auth-admin): jail/release identity route (mirrors lock)"
```

---

## Task 7: Surface jail state in the identity report + list export

**Files:**
- Modify: `src/lib/identity-report.ts`
- Modify: `src/app/api/admin/identities/route.ts`
- Test: `src/lib/identity-report.test.ts` (extend)

**Interfaces:**
- Consumes: the `jailed`/`jailLevel` attributes from Task 1.
- Produces: `IdentityRow` gains `jailed: boolean` and `jailLevel: number | null`; `SummaryTiles` gains `jailed: number`; the CSV export gains `jailed`/`jailLevel` columns.

- [ ] **Step 1: Write the failing test.** In `src/lib/identity-report.test.ts`, add a case asserting `mergeIdentityRows` carries jail state. Model it on the existing `lockedOut` assertions (read the file first for the exact fixture shape):

```ts
it("carries jailed and jailLevel onto the row", () => {
  const rows = mergeIdentityRows([
    { userId: "u1", /* …existing required ProfileRow fields… */ lockedOut: false, jailed: true, jailLevel: 3 } as any,
  ], /* …other args mergeIdentityRows takes… */);
  expect(rows[0].jailed).toBe(true);
  expect(rows[0].jailLevel).toBe(3);
});
```

  > **Executor note:** `mergeIdentityRows` has a specific signature and `ProfileRow` has required fields — copy an existing passing test case in this file and add `jailed`/`jailLevel` to its input + assertions, rather than hand-rolling the fixture.

- [ ] **Step 2: Run to confirm it fails.**

Run: `npx vitest run src/lib/identity-report.test.ts`
Expected: FAIL — `rows[0].jailed` is `undefined`.

- [ ] **Step 3: Add jail to the types + merge.** In `src/lib/identity-report.ts`:

  (a) `ProfileRow` (~line 16) — add after `lockedOut`:
```ts
  jailed?: boolean;
  jailLevel?: number;
```
  (b) `IdentityRow` (~line 29) — add after `lockedOut: boolean;`:
```ts
  jailed: boolean;
  jailLevel: number | null;
```
  (c) `mergeIdentityRows` (~line 120, where `lockedOut: p.lockedOut` is set) — add:
```ts
    jailed: p.jailed === true,
    jailLevel: typeof p.jailLevel === "number" ? p.jailLevel : null,
```
  (d) `SummaryTiles` (~line 45) — add `jailed: number;`. In `summaryTiles` (~line 148, beside `locked`) — add:
```ts
    jailed: rows.filter((r) => r.jailed).length,
```

- [ ] **Step 4: Add the CSV columns.** In `src/app/api/admin/identities/route.ts` (~line 58, the column list that includes `{ key: "lockedOut", header: "lockedOut" }`) add:
```ts
    { key: "jailed", header: "jailed" },
    { key: "jailLevel", header: "jailLevel" },
```
Ensure the DynamoDB projection / scan that feeds these rows includes `jailed` and `jailLevel` (if the route explicitly lists attributes to project, add them; if it returns full items, no change needed — verify by reading the query).

- [ ] **Step 5: Run tests + typecheck.**

Run: `npx vitest run src/lib/identity-report.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/identity-report.ts src/lib/identity-report.test.ts src/app/api/admin/identities/route.ts
git commit -m "feat(auth-admin): surface jail state in identity report + CSV export"
```

---

## Task 8: Admin drawer — JailAction, badge, filter pill

**Files:**
- Modify: `src/app/admin/AdminActions.tsx`
- Modify: `src/app/admin/AdminConsole.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/identities/{userId}/jail` (Task 6); `IdentityRow.jailed`/`jailLevel` (Task 7).
- Produces: a `JailAction` control in the drawer footer, a `JAILED L{n}` badge in the table row + drawer header, and a `jailed` filter pill.

- [ ] **Step 1: Add `JailAction` to `AdminActions.tsx`.** Mirror the existing `LockAction` (lines 7-27), including its bare `/api/…` path (no `BASE` prefix) to match `LockAction`/`UnlinkAction`/`DeleteIdentityAction`. Add:

```tsx
export function JailAction({
  userId,
  jailed,
  jailLevel,
  onComplete,
}: {
  userId: string;
  jailed: boolean;
  jailLevel: number | null;
  onComplete?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [level, setLevel] = useState<number>(jailLevel ?? 1);

  async function go() {
    if (jailed) {
      if (!window.confirm("Release this identity from jail?")) return;
    } else {
      if (!window.confirm(`Jail this identity at level ${level}? They'll face escalated Altcha friction on their next interactive login.`)) return;
    }
    setBusy(true);
    setFailed(false);
    const res = await fetch(`/api/admin/identities/${encodeURIComponent(userId)}/jail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jailed ? { jailed: false } : { jailed: true, level }),
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
      onComplete?.();
    } else {
      setFailed(true);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {!jailed && (
        <select
          aria-label="Jail level"
          value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
          className="rounded border px-1 py-0.5 text-xs"
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>L{n}</option>
          ))}
        </select>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={go}
        className={dangerBtn + " border-warning text-warning"}
      >
        {busy ? "…" : jailed ? "Release" : "Jail"}
      </button>
      {failed && <span className="text-[10px] text-danger">failed</span>}
    </div>
  );
}
```

  > **Executor note:** Read `AdminActions.tsx` first — reuse its existing `dangerBtn` const, `useRouter`/`useState` imports, and styling tokens. Do not redefine them.

- [ ] **Step 2: Wire `JailAction` into the drawer footer in `AdminConsole.tsx`.** Beside the existing `<LockAction … />` (line ~426), add:

```tsx
              <JailAction
                userId={drawer.identity.userId}
                jailed={drawer.identity.jailed}
                jailLevel={drawer.identity.jailLevel}
                onComplete={() => openDrawer(drawer.identity.userId)}
              />
```

Add `jailed` and `jailLevel` to the drawer `Detail.identity` type (lines 23-26, alongside `lockedOut`), and ensure `JailAction` is imported from `./AdminActions`.

- [ ] **Step 3: Add the `JAILED L{n}` badge.** Mirror the `LOCKED` badge span. In the table row (line ~306, next to the LOCKED badge) and the drawer header (line ~364), add:

```tsx
{r.jailed && (
  <span className="rounded bg-danger/20 px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-wide text-danger">
    JAILED L{r.jailLevel ?? 1}
  </span>
)}
```

(In the drawer header use `drawer.identity.jailed` / `drawer.identity.jailLevel`.)

- [ ] **Step 4: Add the `jailed` filter pill.** In `AdminConsole.tsx`:
  - Extend the `pill` state union (line ~114): add `| "jailed"`.
  - Add the filter (near line ~134): `if (pill === "jailed") out = out.filter((r) => r.jailed);`
  - Add to the pill button array (line ~262): `["jailed", "jailed"]`.
  - (Optional) Add a hero stat card mirroring "Locked" using `tiles.jailed`.

- [ ] **Step 5: Build + typecheck.**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual visual check.** With an admin session, open `/admin`, open a user drawer, jail at L3, confirm `JAILED L3` badge + `jailed` pill filter work, then release. (Signed-in visual verify — the admin console is client-gated; curl-grep is blind.)

- [ ] **Step 7: Commit.**

```bash
git add src/app/admin/AdminActions.tsx src/app/admin/AdminConsole.tsx
git commit -m "feat(auth-admin): jail action + JAILED badge + jailed filter pill in identity drawer"
```

---

## Task 9: Docs, env, and follow-up todo

**Files:**
- Modify: repo-root `architecture.md`
- Add: a GSD follow-up todo (or a note in the plan's "Out of scope") for instant jail invalidation

- [ ] **Step 1: Document the env var + limitation.** In `architecture.md`, near the existing `ALTCHA_HMAC_KEY` mention (line ~28), add:

```md
- `ALTCHA_OAUTH_ENFORCED` (run.auth) — when `"true"`, every OAuth/OIDC login must
  solve one Altcha at the interaction chokepoint (`/challenge`). Unset/anything-else =
  jail-only enforcement (no baseline friction). `ALTCHA_HMAC_KEY` also signs the
  short-lived `altcha_ok` / `altcha_progress` gate cookies.
```

- [ ] **Step 2: Record the v1 limitation + follow-ups.** Append to the design spec (`docs/superpowers/specs/2026-07-12-altcha-oauth-jail-design.md`) a short "v1 Implementation Notes" section:

```md
## v1 Implementation Notes (delivered)

- Enforcement is **gate-only**: the `[uid].ts` interaction route does a live
  `getAuthProfile` read and challenges when due. Jail bumps `sessionVersion` for
  parity with lock (kicks consuming-service sessions) but does NOT instantly
  invalidate a warm run.auth session — a jailed user on a warm oidc `_session`
  silent-SSOs past the gate until it lapses or they re-login. Accepted for v1.
- Difficulty levels ship as: baseline 1×2M; jail L1 2×2M, L2 3×3M, L3 4×4M,
  L4 6×6M, L5 8×8M. Tunable in `src/lib/altcha-gate.ts`.
- Replay guard is per-instance in-memory (not shared across ECS tasks).

### Follow-ups (not in v1)
- Instant jail bite: add `sessionVersion` compare in the `jwt` callback +
  destroy the user's oidc-provider `_session` on jail.
- Distributed replay protection (DynamoDB-backed used-solution tracking).
- Gate the rare direct, non-SSO run.auth page logins (middleware).
```

- [ ] **Step 3: Bump the version.** Update `apps/run.auth/webapp/package.json` version `0.0.30` → `0.0.31` (confirm current value first). This is what the release workflow tags.

- [ ] **Step 4: Full suite + build one more time.**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all green.

- [ ] **Step 5: Commit.**

```bash
git add architecture.md docs/superpowers/specs/2026-07-12-altcha-oauth-jail-design.md apps/run.auth/webapp/package.json
git commit -m "docs(auth): document ALTCHA_OAUTH_ENFORCED + jail v1 limitations; bump run.auth 0.0.31"
```

---

## Deploy (after merge approval)

Do NOT deploy without explicit user approval. Recipe (from prior run.auth releases):
1. PR `gsd/altcha-oauth-jail` → main; get review + approval.
2. Merge → `buildpub` workflow (skip_region drops cac1/apse1) builds + pushes ECR image, opens auto-merged version bump PR.
3. `deploy.yml` for `us-east-1` (PR: `skip`) rolls the ECS service. Watch `aws ecs …` rolloutState; version-meta lags the ECR tag by ~1; ~90s deploy lag after workflow success.
4. Keep `ALTCHA_OAUTH_ENFORCED` **unset** initially (ships inert). Verify a normal login still works end-to-end. Then, separately, flip `ALTCHA_OAUTH_ENFORCED=true` (put-parameter + force-new-deployment) when ready to enable baseline friction.
5. Logs: `aws logs tail /ecs/run-auth-app-run-auth-use1-dc34 --profile dc34-application`.

---

## Self-Review

- **Spec coverage:** altcha_ok gate at interaction ✅(T4); /challenge + verify-login + difficulty issuance ✅(T3,T5); `challengeRequirement` + tables ✅(T2); jail fields ✅(T1); jail route + drawer + badge + pill ✅(T6,T8); `ALTCHA_OAUTH_ENFORCED` ✅(T2,T9); email double-challenge reconciliation ✅(T4); silent-SSO exempt ✅(T4 prompt=none belt); out-of-scope items documented ✅(T9). The spec's `sessionVersion`-"bites now" claim is corrected to gate-only per approved decision, documented in T9.
- **Placeholders:** none — every code step carries real code. Executor notes flag the two places (login success-response shape, altcha-widget JSX typing) where the executor must match existing code exactly rather than guess.
- **Type consistency:** `challengeRequirement` returns `{count,difficulty}` everywhere; `IdentityRow.jailLevel` is `number | null` in report + `JailAction` prop + drawer type; cookie names come only from `altcha-gate` constants; `emailKey` lowercases on both the set (T4 login) and read (T4 gate) sides.
