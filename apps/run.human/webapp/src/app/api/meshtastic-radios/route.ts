import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@auth';
import { getRunUser, updateMeshtasticRadios, sanitizeRadio, type MeshtasticRadio } from '@/entities/run-user';
import { checkQuota, consumeQuota, restoreQuota } from '@/lib/quota-client';
import { getUserTier } from '@/lib/quota-middleware';
import crypto from 'crypto';

/**
 * Derive X25519 public key from a base64-encoded private key.
 * Meshtastic uses Curve25519 for key exchange.
 */
function derivePublicKey(privateKeyBase64: string): string {
  try {
    const privateKeyBytes = Buffer.from(privateKeyBase64, 'base64');
    if (privateKeyBytes.length !== 32) return '';
    const keyObject = crypto.createPrivateKey({
      key: Buffer.concat([
        // X25519 PKCS#8 prefix (16 bytes) + 32-byte raw key
        Buffer.from('302e020100300506032b656e04220420', 'hex'),
        privateKeyBytes,
      ]),
      format: 'der',
      type: 'pkcs8',
    });
    const publicKeyDer = crypto.createPublicKey(keyObject).export({ format: 'der', type: 'spki' });
    // X25519 SPKI is 44 bytes: 12-byte header + 32-byte raw key
    return publicKeyDer.subarray(12).toString('base64');
  } catch {
    return '';
  }
}

function validateAndFormatNodeId(nodeId: string): { isValid: boolean; formatted: string } {
  if (!nodeId.trim()) return { isValid: false, formatted: nodeId };

  if (nodeId.startsWith('!')) {
    // Hex format validation
    const hexPart = nodeId.slice(1);
    if (!/^[0-9a-fA-F]+$/.test(hexPart)) return { isValid: false, formatted: nodeId };
    if (hexPart.length === 0 || hexPart.length > 8) return { isValid: false, formatted: nodeId };
    return { isValid: true, formatted: nodeId.toLowerCase() };
  } else {
    // Integer format validation and conversion
    const intValue = parseInt(nodeId, 10);
    if (isNaN(intValue) || intValue < 0 || intValue > 0xFFFFFFFF) return { isValid: false, formatted: nodeId };
    const hexValue = intValue.toString(16);
    return { isValid: true, formatted: `!${hexValue}` };
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await getRunUser(session.user.id);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get quota from quota service
    const services = session.user.services || ['run'];
    const tier = getUserTier(services);
    const quotaCheck = await checkQuota(session.user.id, 'meshtastic_radio', 1, tier);

    return NextResponse.json({
      radios: user.meshtasticRadios || [],
      quota: {
        remaining: quotaCheck.remaining,
        initial: 5 // Default initial, could be tier-based
      }
    });
  } catch (error) {
    console.error('Error fetching radios:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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

    const { nodeId, privateKey, publicKey, impersonate } = await req.json();

    if (!nodeId) {
      return NextResponse.json({ error: 'Node ID is required' }, { status: 400 });
    }

    const nodeIdValidation = validateAndFormatNodeId(nodeId);
    if (!nodeIdValidation.isValid) {
      return NextResponse.json({ error: 'Invalid NodeID. Must be hex (!1234abcd) or integer (≤32-bit)' }, { status: 400 });
    }

    if (impersonate && (!privateKey || !privateKey.trim())) {
      return NextResponse.json({ error: 'Private key is required when impersonation is enabled' }, { status: 400 });
    }

    // Check and consume quota
    const services = session.user.services || ['run'];
    const tier = getUserTier(services);
    const consumeResult = await consumeQuota(session.user.id, 'meshtastic_radio', 1, tier);

    if (!consumeResult.success) {
      return NextResponse.json({ error: 'Radio quota exceeded' }, { status: 403 });
    }

    // Sanitize all radios from the database to handle any malformed data
    const currentRadios = ((user.meshtasticRadios || []) as MeshtasticRadio[]).map(sanitizeRadio);

    // Use the formatted NodeID for storage and duplicate checking
    const formattedNodeId = nodeIdValidation.formatted;
    const existingRadio = currentRadios.find((r) => r.nodeId === formattedNodeId);
    if (existingRadio) {
      // Restore quota since we didn't actually add the radio
      await restoreQuota(session.user.id, 'meshtastic_radio', 1);
      return NextResponse.json({ error: 'Radio with this Node ID already exists' }, { status: 409 });
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Log verification code for testing
    console.log(`[Meshtastic] New radio ${formattedNodeId} verification code: ${verificationCode}`);

    const newRadio: MeshtasticRadio = {
      id: crypto.randomUUID(),
      nodeId: formattedNodeId,
      privateKey: privateKey || '',
      publicKey: publicKey || (privateKey ? derivePublicKey(privateKey) : ''),
      impersonate: impersonate || false,
      verificationCode,
      verified: false,
      createdAt: Date.now(),
      verificationAttempts: 0,
      resendAttempts: 0,
    };

    const updatedRadios = [...currentRadios, newRadio];

    await updateMeshtasticRadios(session.user.id, updatedRadios);

    // Return radio without verification code for security
    const { verificationCode: _, ...safeRadio } = newRadio;

    return NextResponse.json({
      radio: safeRadio,
      quota: { remaining: consumeResult.remaining }
    });
  } catch (error) {
    console.error('Error adding radio:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await getRunUser(session.user.id);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { radioId, verificationCode, privateKey, publicKey, impersonate } = await req.json();

    if (!radioId) {
      return NextResponse.json({ error: 'Radio ID is required' }, { status: 400 });
    }

    // Sanitize all radios from the database to handle any malformed data
    const currentRadios = ((user.meshtasticRadios || []) as MeshtasticRadio[]).map(sanitizeRadio);
    const radioIndex = currentRadios.findIndex((r) => r.id === radioId);

    if (radioIndex === -1) {
      return NextResponse.json({ error: 'Radio not found' }, { status: 404 });
    }

    const radio: MeshtasticRadio = { ...currentRadios[radioIndex] };

    if (verificationCode !== undefined) {
      // Check verification attempts limit
      const verificationAttempts = radio.verificationAttempts || 0;
      if (verificationAttempts >= 5) {
        return NextResponse.json({ error: 'Maximum verification attempts exceeded (5)' }, { status: 429 });
      }

      // Increment verification attempts
      radio.verificationAttempts = verificationAttempts + 1;

      if (radio.verificationCode === verificationCode) {
        radio.verified = true;
        radio.verifiedAt = Date.now();
      } else {
        // Save the failed attempt count
        currentRadios[radioIndex] = radio;
        await updateMeshtasticRadios(session.user.id, currentRadios);
        return NextResponse.json({
          error: 'Invalid verification code',
          attemptsRemaining: 5 - radio.verificationAttempts
        }, { status: 400 });
      }
    }

    if (privateKey !== undefined) {
      radio.privateKey = privateKey;
      // Re-derive public key if not explicitly provided
      if (publicKey === undefined && privateKey) {
        radio.publicKey = derivePublicKey(privateKey);
      }
    }

    if (publicKey !== undefined) {
      radio.publicKey = publicKey;
    }

    if (impersonate !== undefined) {
      radio.impersonate = impersonate;
    }

    currentRadios[radioIndex] = radio;

    await updateMeshtasticRadios(session.user.id, currentRadios);

    // Return radio without verification code
    const { verificationCode: _, ...safeRadio } = radio;

    return NextResponse.json({ radio: safeRadio });
  } catch (error) {
    console.error('Error updating radio:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const radioId = searchParams.get('radioId');

    if (!radioId) {
      return NextResponse.json({ error: 'Radio ID is required' }, { status: 400 });
    }

    const user = await getRunUser(session.user.id);

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Sanitize all radios from the database to handle any malformed data
    const currentRadios = ((user.meshtasticRadios || []) as MeshtasticRadio[]).map(sanitizeRadio);
    const radioToDelete = currentRadios.find((r) => r.id === radioId);

    if (!radioToDelete) {
      return NextResponse.json({ error: 'Radio not found' }, { status: 404 });
    }

    const updatedRadios = currentRadios.filter((r) => r.id !== radioId);

    await updateMeshtasticRadios(session.user.id, updatedRadios);

    // Note: Quota is NOT restored when radio is deleted
    // This prevents gaming the system by adding/removing radios
    // Admins can manually reset quota if needed

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting radio:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
