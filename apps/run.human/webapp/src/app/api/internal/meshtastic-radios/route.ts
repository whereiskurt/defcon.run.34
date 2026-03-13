import { NextRequest, NextResponse } from "next/server";
import { dynamodbClient, DYNAMODB_TABLE } from "@/entities/client";
import { getRunUser, updateMeshtasticRadios, type MeshtasticRadio } from "@/entities/run-user";
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
    const { oidcSub, nodeId, privateKey } = body;

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

    const currentRadios = (user.meshtasticRadios || []) as MeshtasticRadio[];
    const formattedNodeId = nodeId.toLowerCase();

    // Check for existing radio with same nodeId
    const existingIndex = currentRadios.findIndex(
      (r) => r.nodeId === formattedNodeId
    );

    if (existingIndex !== -1) {
      // UPDATE: Re-flash -- update private key, keep everything else
      const updated = { ...currentRadios[existingIndex], privateKey };
      const updatedRadios = [...currentRadios];
      updatedRadios[existingIndex] = updated;

      await updateMeshtasticRadios(adapterUserId, updatedRadios);
      console.log(`[run.human] Updated radio ${formattedNodeId} for user ${adapterUserId}`);

      return NextResponse.json({ radio: updated, updated: true }, { status: 200 });
    }

    // CREATE: New radio -- check quota first
    const services = ["run"]; // Internal API, default tier
    const tier = getUserTier(services);
    const quotaCheck = await checkQuota(adapterUserId, "meshtastic_radio", 1, tier);

    if (quotaCheck.remaining <= 0) {
      return NextResponse.json(
        { error: "Radio quota exceeded" },
        { status: 403 }
      );
    }

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
