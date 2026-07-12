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
    if (required.count === 0) {
      // Nothing is actually owed (not jailed + baseline off) — don't mint a standing
      // bypass token when no challenge was required in the first place.
      return NextResponse.json({ done: true, solved, required: 0 });
    }
    const res = NextResponse.json({ done: true, solved, required: count });
    res.cookies.set(ALTCHA_OK_COOKIE, makeAltchaOk(sub, count), { ...cookieOpts, maxAge: OK_TTL_MS / 1000 });
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
