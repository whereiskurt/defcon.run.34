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
