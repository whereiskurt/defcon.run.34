import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@auth';
import { getRunUser, updateMeshtasticRadios, sanitizeRadio, type MeshtasticRadio } from '@/entities/run-user';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await getRunUser(session.user.id);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { radioId } = await req.json();

    if (!radioId) {
      return NextResponse.json({ error: 'Radio ID is required' }, { status: 400 });
    }

    // Sanitize all radios from the database to handle any malformed data
    const currentRadios = ((user.meshtasticRadios || []) as MeshtasticRadio[]).map(sanitizeRadio);
    const radioIndex = currentRadios.findIndex((r) => r.id === radioId);

    if (radioIndex === -1) {
      return NextResponse.json({ error: 'Radio not found' }, { status: 404 });
    }

    const radio = { ...currentRadios[radioIndex] };

    // Check if radio is already verified
    if (radio.verified) {
      return NextResponse.json({ error: 'Radio is already verified' }, { status: 400 });
    }

    // Check verification attempts limit
    const verificationAttempts = radio.verificationAttempts || 0;
    if (verificationAttempts >= 5) {
      return NextResponse.json({ error: 'Maximum verification attempts exceeded (5). Cannot resend code.' }, { status: 429 });
    }

    // Check resend attempts limit
    const resendAttempts = radio.resendAttempts || 0;
    if (resendAttempts >= 3) {
      return NextResponse.json({ error: 'Maximum resend attempts exceeded (3)' }, { status: 429 });
    }

    // Generate new verification code
    const newVerificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Log verification code for testing
    console.log(`[Meshtastic] Resend for radio ${radio.nodeId} new verification code: ${newVerificationCode}`);

    // Update radio with new code and increment resend attempts
    radio.verificationCode = newVerificationCode;
    radio.resendAttempts = resendAttempts + 1;

    currentRadios[radioIndex] = radio;

    await updateMeshtasticRadios(session.user.id, currentRadios);

    // Return success with resend count (don't expose the new code)
    return NextResponse.json({
      success: true,
      resendsRemaining: 3 - radio.resendAttempts
    });
  } catch (error) {
    console.error('Error resending verification code:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
