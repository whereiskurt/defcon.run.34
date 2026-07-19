import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@auth';
import { getMeshRadio, patchMeshRadio } from '@/entities/mesh-radio';
import { normalizeNodeId } from '@/lib/mesh-radio-canonical';
import { assertNotLockedLive } from '@/lib/live-lockout';

/**
 * Resend a Meshtastic verification code (Phase 66, MRAD-04 hard-switch).
 * Operates on the authoritative MeshRadio row keyed by nodeId — no key change.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (await assertNotLockedLive(session.user.authUserId)) {
      return NextResponse.json({ error: 'Account locked out' }, { status: 403 });
    }

    const { nodeId } = await req.json();

    if (!nodeId) {
      return NextResponse.json({ error: 'Node ID is required' }, { status: 400 });
    }

    const canonicalNodeId = normalizeNodeId(nodeId);
    const radio = await getMeshRadio(canonicalNodeId);

    if (!radio || radio.userId !== session.user.id) {
      return NextResponse.json({ error: 'Radio not found' }, { status: 404 });
    }

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
    const nextResendAttempts = resendAttempts + 1;

    // Log verification code for testing (never log key material)
    console.log(`[Meshtastic] Resend for radio ${radio.nodeId} new verification code: ${newVerificationCode}`);

    await patchMeshRadio(canonicalNodeId, {
      verificationCode: newVerificationCode,
      resendAttempts: nextResendAttempts,
    });

    // Return success with resend count (don't expose the new code)
    return NextResponse.json({
      success: true,
      resendsRemaining: 3 - nextResendAttempts
    });
  } catch (error) {
    console.error('Error resending verification code:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
