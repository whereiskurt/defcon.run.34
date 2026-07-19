import { NextRequest, NextResponse } from "next/server";
import { dynamodbClient, DYNAMODB_TABLE } from "@/entities/client";
import { getRunUser, updateMeshtasticRadios, sanitizeRadio, type MeshtasticRadio } from "@/entities/run-user";
import { upsertMeshRadio } from "@/entities/mesh-radio";
import {
  normalizeNodeId,
  nodeNumFromNodeId,
  publicKeyBase64ToHex,
} from "@/lib/mesh-radio-canonical";
import { checkQuota, consumeQuota } from "@/lib/quota-client";
import { getUserTier } from "@/lib/quota-middleware";
import { config } from "@/config";
import crypto from "crypto";

const OIDC_PROVIDER = "run.defcon.run";

/**
 * Internal API: Register or update a Meshtastic radio by OIDC subject.
 *
 * Protected by AUTH_INTERNAL_SECRET (server-to-server only).
 * Called by run.flash after a successful flash+configure to auto-register
 * the radio in the user's run.human profile.
 *
 * - New radios are created as verified + impersonate enabled (no verification needed)
 * - Re-flashing the same radio updates the private key (idempotent)
 */
export async function POST(req: NextRequest) {
  // Verify internal secret
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { oidcSub, nodeId, privateKey, publicKey } = body;

    if (!oidcSub || !nodeId || privateKey === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: oidcSub, nodeId, privateKey" },
        { status: 400 }
      );
    }

    // Resolve OIDC sub to adapter userId via authjs accounts table
    const accountResult = await dynamodbClient.query({
      TableName: DYNAMODB_TABLE,
      IndexName: "GSI1",
      KeyConditionExpression: "#gsi1pk = :gsi1pk AND #gsi1sk = :gsi1sk",
      ExpressionAttributeNames: {
        "#gsi1pk": "GSI1PK",
        "#gsi1sk": "GSI1SK",
      },
      ExpressionAttributeValues: {
        ":gsi1pk": `ACCOUNT#${OIDC_PROVIDER}`,
        ":gsi1sk": `ACCOUNT#${oidcSub}`,
      },
    });

    const account = accountResult.Items?.[0];
    if (!account) {
      return NextResponse.json(
        { error: "No account found for OIDC subject" },
        { status: 404 }
      );
    }

    const adapterUserId = account.userId as string;
    if (!adapterUserId) {
      return NextResponse.json(
        { error: "Account missing userId" },
        { status: 500 }
      );
    }

    // Get RunUser profile
    const user = await getRunUser(adapterUserId);
    if (!user) {
      return NextResponse.json(
        { error: "RunUser not found" },
        { status: 404 }
      );
    }

    const currentRadios = ((user.meshtasticRadios || []) as MeshtasticRadio[]).map(sanitizeRadio);
    const formattedNodeId = nodeId.toLowerCase();

    // ── MeshRadio authoritative write prep (Phase 66, MRAD-02) ───────────────
    // Canonicalize nodeId to pad-8 lowercase (L2) and derive the explicit uint32
    // nodeNum, so meshtk composes fmt.Sprintf("!%08x", nodeNum) → a byte-identical
    // DynamoDB pk. The embedded-list write below still uses `formattedNodeId`.
    const canonicalNodeId = normalizeNodeId(nodeId);
    const canonicalNodeNum = nodeNumFromNodeId(canonicalNodeId);

    // ⚠️ base64 → 0x hex CONVERSION BOUNDARY (MRAD-02, L3). The device's X25519
    // pubkey arrives base64 but meshtk's ParseHexKey needs 0x hex — convert ONCE
    // here. Absent pubkey → skip the hex field (stay resilient); a present key
    // that does not decode to exactly 32 bytes → 400 (V5 input validation).
    // NEVER log the key value.
    let publicKeyHex: string | undefined;
    if (publicKey) {
      try {
        publicKeyHex = publicKeyBase64ToHex(publicKey);
      } catch {
        return NextResponse.json(
          { error: "publicKey must decode to exactly 32 bytes" },
          { status: 400 }
        );
      }
    }

    // Check for existing radio with same nodeId
    const existingIndex = currentRadios.findIndex(
      (r) => r.nodeId === formattedNodeId
    );

    if (existingIndex !== -1) {
      // UPDATE: Re-flash -- update keys, keep everything else
      const updated = { ...currentRadios[existingIndex], privateKey, publicKey: publicKey || "" };
      const updatedRadios = [...currentRadios];
      updatedRadios[existingIndex] = updated;

      await updateMeshtasticRadios(adapterUserId, updatedRadios);

      // Mirror the re-flash onto the authoritative MeshRadio row (Phase 66,
      // MRAD-02). Transitional dual-write — the embedded list retires in plan
      // 66-03, so keeping both here is intentional. Never log key material.
      await upsertMeshRadio({
        nodeId: canonicalNodeId,
        nodeNum: canonicalNodeNum,
        userId: adapterUserId,
        ...(publicKeyHex ? { publicKey: publicKeyHex } : {}),
        privateKey,
        verified: true,
        source: "flash",
        impersonate: currentRadios[existingIndex].impersonate ?? true,
      });

      console.log(`[run.human] Updated radio ${formattedNodeId} for user ${adapterUserId}`);

      return NextResponse.json({ radio: updated, updated: true }, { status: 200 });
    }

    // CREATE: New radio -- consume quota (auto-initializes on first use)
    const services = ["run"]; // Internal API, default tier
    const tier = getUserTier(services);
    const consumeResult = await consumeQuota(adapterUserId, "meshtastic_radio", 1, tier);
    if (!consumeResult.success) {
      return NextResponse.json(
        { error: "Radio quota exceeded" },
        { status: 403 }
      );
    }

    const newRadio: MeshtasticRadio = {
      id: crypto.randomUUID(),
      nodeId: formattedNodeId,
      privateKey: privateKey || "",
      publicKey: publicKey || "",
      impersonate: true,
      verificationCode: "", // Not needed -- auto-verified from flash
      verified: true,
      createdAt: Date.now(),
      verifiedAt: Date.now(),
      verificationAttempts: 0,
      resendAttempts: 0,
    };

    const updatedRadios = [...currentRadios, newRadio];
    await updateMeshtasticRadios(adapterUserId, updatedRadios);

    // Create the authoritative MeshRadio row (Phase 66, MRAD-02). New flash
    // radios are auto-verified + impersonating. Transitional dual-write — the
    // embedded list retires in plan 66-03. Never log key material.
    await upsertMeshRadio({
      nodeId: canonicalNodeId,
      nodeNum: canonicalNodeNum,
      userId: adapterUserId,
      ...(publicKeyHex ? { publicKey: publicKeyHex } : {}),
      privateKey: privateKey || "",
      verified: true,
      source: "flash",
      impersonate: true,
    });

    console.log(`[run.human] Registered new radio ${formattedNodeId} for user ${adapterUserId}`);

    return NextResponse.json({ radio: newRadio, updated: false }, { status: 201 });
  } catch (error) {
    console.error("[run.human] /api/internal/meshtastic-radios error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
