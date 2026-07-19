import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@auth';
import { assertNotLockedLive } from '@/lib/live-lockout';
import { getRunUser } from '@/entities/run-user';
import {
  getMeshRadio,
  getMeshRadiosByUser,
  upsertMeshRadio,
  patchMeshRadio,
  deleteMeshRadio,
  type MeshRadioItem,
  type PatchMeshRadioInput,
} from '@/entities/mesh-radio';
import {
  normalizeNodeId,
  nodeNumFromNodeId,
  publicKeyBase64ToHex,
} from '@/lib/mesh-radio-canonical';
import { checkQuota, consumeQuota, restoreQuota } from '@/lib/quota-client';
import { getUserTier } from '@/lib/quota-middleware';
import crypto from 'crypto';

/**
 * User-facing Meshtastic radio CRUD (Phase 66, MRAD-04 — LOCKED hard-switch).
 *
 * Every reader/writer here targets the first-class `MeshRadio` entity — the
 * single source of truth — NOT the retired embedded RunUser radios list.
 * The client keys each radio on its canonical `nodeId` (not the old uuid `id`),
 * PATCH/DELETE/resend send `nodeId`, and every write funnels through the
 * upsert/patch/delete helpers so the pk/sk contract lives in one place.
 */

/**
 * Derive X25519 public key from a base64-encoded private key.
 * Meshtastic uses Curve25519 for key exchange. Returns BASE64 (converted to
 * 0x-hex at the MeshRadio write boundary via publicKeyBase64ToHex).
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

/**
 * Project a MeshRadio row to the presentation-safe shape the client consumes:
 * strip the verificationCode secret; keep the fields MeshtasticRadios.tsx reads
 * (incl. the user's own privateKey, which the profile UI displays).
 */
function toClientRadio(radio: MeshRadioItem) {
  const { verificationCode, ...safe } = radio;
  return safe;
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

    // List radios from the authoritative MeshRadio entity (byUser), not the
    // retired embedded list.
    const radios = await getMeshRadiosByUser(session.user.id);

    // Get quota from quota service
    const services = session.user.services || ['run'];
    const tier = getUserTier(services);
    const quotaCheck = await checkQuota(session.user.id, 'meshtastic_radio', 1, tier);

    return NextResponse.json({
      radios: radios.map(toClientRadio),
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
    if (await assertNotLockedLive(session.user.authUserId)) {
      return NextResponse.json({ error: 'Account locked out' }, { status: 403 });
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

    // Canonicalize nodeId to pad-8 lowercase (L2) and derive the explicit uint32
    // nodeNum, so meshtk composes a byte-identical pk. Fixes the historically
    // unpadded manual-add path.
    const canonicalNodeId = normalizeNodeId(nodeIdValidation.formatted);
    const canonicalNodeNum = nodeNumFromNodeId(canonicalNodeId);

    // Derive/convert the pubkey to 0x hex BEFORE consuming quota so a malformed
    // key never costs the user a quota unit (L3). derivePublicKey returns base64.
    const publicKeyBase64 = publicKey || (privateKey ? derivePublicKey(privateKey) : '');
    let publicKeyHex: string | undefined;
    if (publicKeyBase64) {
      try {
        publicKeyHex = publicKeyBase64ToHex(publicKeyBase64);
      } catch {
        return NextResponse.json({ error: 'publicKey must decode to exactly 32 bytes' }, { status: 400 });
      }
    }

    // Check and consume quota
    const services = session.user.services || ['run'];
    const tier = getUserTier(services);
    const consumeResult = await consumeQuota(session.user.id, 'meshtastic_radio', 1, tier);

    if (!consumeResult.success) {
      return NextResponse.json({ error: 'Radio quota exceeded' }, { status: 403 });
    }

    // Duplicate check against the authoritative MeshRadio row.
    const existingRadio = await getMeshRadio(canonicalNodeId);
    if (existingRadio) {
      // Restore quota since we didn't actually add the radio
      await restoreQuota(session.user.id, 'meshtastic_radio', 1);
      return NextResponse.json({ error: 'Radio with this Node ID already exists' }, { status: 409 });
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Log verification code for testing (never log key material)
    console.log(`[Meshtastic] New radio ${canonicalNodeId} verification code: ${verificationCode}`);

    const created = await upsertMeshRadio({
      nodeId: canonicalNodeId,
      nodeNum: canonicalNodeNum,
      userId: session.user.id,
      ...(publicKeyHex ? { publicKey: publicKeyHex } : {}),
      privateKey: privateKey || '',
      impersonate: impersonate || false,
      verificationCode,
      verified: false,
      verificationAttempts: 0,
      resendAttempts: 0,
      source: 'manual',
    });

    // Return radio without verification code for security
    const safeRadio = toClientRadio(created as MeshRadioItem);

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
    if (await assertNotLockedLive(session.user.authUserId)) {
      return NextResponse.json({ error: 'Account locked out' }, { status: 403 });
    }

    const { nodeId, verificationCode, privateKey, publicKey, impersonate, showOnMap } = await req.json();

    if (!nodeId) {
      return NextResponse.json({ error: 'Node ID is required' }, { status: 400 });
    }

    const canonicalNodeId = normalizeNodeId(nodeId);
    const radio = await getMeshRadio(canonicalNodeId);

    // Scope to the caller's own radio (source of truth is a global-by-nodeId row).
    if (!radio || radio.userId !== session.user.id) {
      return NextResponse.json({ error: 'Radio not found' }, { status: 404 });
    }

    const fields: PatchMeshRadioInput = {};

    if (verificationCode !== undefined) {
      // Check verification attempts limit
      const verificationAttempts = radio.verificationAttempts || 0;
      if (verificationAttempts >= 5) {
        return NextResponse.json({ error: 'Maximum verification attempts exceeded (5)' }, { status: 429 });
      }

      const nextAttempts = verificationAttempts + 1;

      if (radio.verificationCode === verificationCode) {
        fields.verified = true;
        fields.verifiedAt = Date.now();
        fields.verificationAttempts = nextAttempts;
      } else {
        // Save the failed attempt count
        await patchMeshRadio(canonicalNodeId, { verificationAttempts: nextAttempts });
        return NextResponse.json({
          error: 'Invalid verification code',
          attemptsRemaining: 5 - nextAttempts
        }, { status: 400 });
      }
    }

    if (privateKey !== undefined) {
      fields.privateKey = privateKey;
      // Re-derive public key if not explicitly provided
      if (publicKey === undefined && privateKey) {
        const derivedBase64 = derivePublicKey(privateKey);
        if (derivedBase64) {
          try {
            fields.publicKey = publicKeyBase64ToHex(derivedBase64);
          } catch {
            // Non-32-byte derived key — leave publicKey unchanged rather than 400
          }
        }
      }
    }

    if (publicKey !== undefined && publicKey) {
      // Provided as base64 → store as 0x hex to match the MeshRadio contract.
      try {
        fields.publicKey = publicKeyBase64ToHex(publicKey);
      } catch {
        return NextResponse.json({ error: 'publicKey must decode to exactly 32 bytes' }, { status: 400 });
      }
    }

    if (impersonate !== undefined) {
      fields.impersonate = impersonate;
    }

    if (showOnMap !== undefined) {
      fields.showOnMap = showOnMap;
    }

    const updated = await patchMeshRadio(canonicalNodeId, fields);

    // Return radio without verification code
    const safeRadio = updated ? toClientRadio(updated) : undefined;

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
    if (await assertNotLockedLive(session.user.authUserId)) {
      return NextResponse.json({ error: 'Account locked out' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const nodeId = searchParams.get('nodeId');

    if (!nodeId) {
      return NextResponse.json({ error: 'Node ID is required' }, { status: 400 });
    }

    const canonicalNodeId = normalizeNodeId(nodeId);
    const radio = await getMeshRadio(canonicalNodeId);

    if (!radio || radio.userId !== session.user.id) {
      return NextResponse.json({ error: 'Radio not found' }, { status: 404 });
    }

    await deleteMeshRadio(canonicalNodeId);

    // Note: Quota is NOT restored when radio is deleted
    // This prevents gaming the system by adding/removing radios
    // Admins can manually reset quota if needed

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting radio:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
