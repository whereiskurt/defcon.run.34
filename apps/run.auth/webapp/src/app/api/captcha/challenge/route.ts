import { createChallenge } from 'altcha-lib';
import { NextResponse } from 'next/server';

const ALTCHA_HMAC_KEY = process.env.ALTCHA_HMAC_KEY;

export async function GET() {
  if (!ALTCHA_HMAC_KEY) {
    console.error('ALTCHA_HMAC_KEY environment variable is not set');
    return NextResponse.json(
      { error: 'Captcha service not configured' },
      { status: 500 }
    );
  }

  try {
    const challenge = await createChallenge({
      hmacKey: ALTCHA_HMAC_KEY,
      maxNumber: 2000000, // ~40-60 seconds on average device, faster on M3 (20x difficulty)
      expires: new Date(Date.now() + 2 * 60 * 1000), // 2 minute TTL
    });

    return NextResponse.json(challenge);
  } catch (error) {
    console.error('Failed to create Altcha challenge:', error);
    return NextResponse.json(
      { error: 'Failed to generate challenge' },
      { status: 500 }
    );
  }
}
