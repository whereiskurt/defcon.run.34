import { NextRequest, NextResponse } from "next/server";
import { dynamodbClient, DYNAMODB_TABLE } from "@/entities/client";
import { getRunUser } from "@/entities/run-user";
import {
  getMeshRadio,
  upsertMeshRadio,
  patchMeshRadio,
  transferMeshRadioOwner,
  type MeshRadioItem,
} from "@/entities/mesh-radio";
import {
  normalizeNodeId,
  nodeNumFromNodeId,
  publicKeyBase64ToHex,
} from "@/lib/mesh-radio-canonical";
import { enqueueWelcome } from "@/entities/mesh-welcome-pending";
import { consumeQuota } from "@/lib/quota-client";
import { getUserTier } from "@/lib/quota-middleware";
import { config } from "@/config";

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
 * - Re-flashing a radio owned by ANOTHER user is an explicit, audited ownership
 *   transfer (see transferMeshRadioOwner) — never a silent key overwrite
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

    // ── MeshRadio authoritative write prep (Phase 66, MRAD-02 / MRAD-04) ─────
    // Canonicalize nodeId to pad-8 lowercase (L2) and derive the explicit uint32
    // nodeNum, so meshtk composes fmt.Sprintf("!%08x", nodeNum) → a byte-identical
    // DynamoDB pk. MeshRadio is now the SINGLE source of truth — the embedded
    // RunUser radios list is retired (hard-switch, plan 66-03).
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

    // Strip the verificationCode secret from any radio row we echo back.
    const safeRadio = (radio: MeshRadioItem) => {
      const { verificationCode, ...rest } = radio;
      return rest;
    };

    // Post-flash welcome DM: every successful registration (create AND
    // re-flash) queues one — the meshtk poller PKI-DMs it from the map node.
    // Best-effort: a queue write failure must never fail the registration.
    const queueWelcome = async () => {
      const who = (user as { displayName?: string }).displayName || "runner";
      try {
        await enqueueWelcome({
          nodeId: canonicalNodeId,
          nodeNum: canonicalNodeNum,
          message: `Welcome to defcon.run, ${who}! Your radio is configured and on the mesh. Reply hi to any rabbit 🐇 or visit run.defcon.run`,
          userId: adapterUserId,
        });
      } catch (e) {
        console.error("[run.human] welcome enqueue failed (registration unaffected):", e);
      }
    };

    // A radio joining this account -- whether brand new or transferred in from
    // another owner -- costs the requesting user one radio slot. Without this on
    // the transfer path, re-flashing someone else's radio is a quota bypass.
    const consumeRadioQuota = async () => {
      const services = ["run"]; // Internal API, default tier
      const tier = getUserTier(services);
      const result = await consumeQuota(adapterUserId, "meshtastic_radio", 1, tier);
      return result.success;
    };

    // Check for an existing authoritative MeshRadio row with this nodeId.
    const existing = await getMeshRadio(canonicalNodeId);

    if (existing && existing.userId !== adapterUserId) {
      // TRANSFER: this radio is registered to a DIFFERENT account. Meshtastic
      // derives myNodeNum from the ESP32 MAC, so a re-flashed radio keeps its
      // "!id" -- a radio that changed hands lands here. Handle it EXPLICITLY:
      // flashing proves physical USB possession (stronger than the manual-add
      // OTP), so move ownership and audit it. This branch previously fell into
      // the UPDATE patch below, which overwrote the other user's keys, flipped
      // verified, and left `userId` behind -- so MeshRadio (the authoritative
      // meshtk decrypt source) attributed the new radio's traffic to the old
      // account, and the caller still saw a plain 200 {updated:true}.
      if (!(await consumeRadioQuota())) {
        return NextResponse.json(
          { error: "Radio quota exceeded" },
          { status: 403 }
        );
      }

      const transferred = await transferMeshRadioOwner(existing, adapterUserId, {
        ...(publicKeyHex ? { publicKey: publicKeyHex } : {}),
        privateKey,
      });

      // Audit the reassignment. Ids only -- never key material.
      console.log(
        `[run.human] Transferred radio ${canonicalNodeId} from user ${existing.userId} to user ${adapterUserId}`
      );
      await queueWelcome();

      // `transferred` (not `updated`) so the caller can tell a reassignment from
      // an ordinary re-flash. `previousUserId` is an opaque id for internal
      // server-to-server audit only -- the run.flash proxy strips it before the
      // response reaches a browser.
      return NextResponse.json(
        {
          radio: transferred ? safeRadio(transferred) : undefined,
          transferred: true,
          previousUserId: existing.userId,
        },
        { status: 200 }
      );
    }

    if (existing) {
      // UPDATE: Re-flash by the SAME owner -- update keys, keep verified;
      // preserve createdAt / showOnMap / impersonate via a partial patch (not a
      // full-item replace). No quota charge: the slot is already spent.
      const updated = await patchMeshRadio(canonicalNodeId, {
        ...(publicKeyHex ? { publicKey: publicKeyHex } : {}),
        privateKey,
        verified: true,
      });

      console.log(`[run.human] Updated radio ${canonicalNodeId} for user ${adapterUserId}`);
      await queueWelcome();

      return NextResponse.json(
        { radio: updated ? safeRadio(updated) : undefined, updated: true },
        { status: 200 }
      );
    }

    // CREATE: New radio -- consume quota (auto-initializes on first use)
    if (!(await consumeRadioQuota())) {
      return NextResponse.json(
        { error: "Radio quota exceeded" },
        { status: 403 }
      );
    }

    // Create the authoritative MeshRadio row (Phase 66, MRAD-02). New flash
    // radios are auto-verified + impersonating. Never log key material.
    const created = await upsertMeshRadio({
      nodeId: canonicalNodeId,
      nodeNum: canonicalNodeNum,
      userId: adapterUserId,
      ...(publicKeyHex ? { publicKey: publicKeyHex } : {}),
      privateKey: privateKey || "",
      verified: true,
      verifiedAt: Date.now(),
      source: "flash",
      impersonate: true,
    });

    console.log(`[run.human] Registered new radio ${canonicalNodeId} for user ${adapterUserId}`);
    await queueWelcome();

    return NextResponse.json(
      { radio: safeRadio(created as MeshRadioItem), updated: false },
      { status: 201 }
    );
  } catch (error) {
    console.error("[run.human] /api/internal/meshtastic-radios error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
