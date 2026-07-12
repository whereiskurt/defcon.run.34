import { NextRequest, NextResponse } from "next/server";
import { dynamodbClient, DYNAMODB_TABLE } from "@/entities/client";
import { getRunUser, updateRunUserProfile } from "@/entities/run-user";
import {
  isDisplayNameLocked,
  normalizeSyncedName,
} from "@/lib/rabbit-name-sync";
import { config } from "@/config";

const OIDC_PROVIDER = "run.defcon.run";

/**
 * Resolve an OIDC subject to its Auth.js adapter userId via the accounts GSI1.
 * Returns null when no account maps to the subject.
 */
async function resolveAdapterUserId(oidcSub: string): Promise<string | null> {
  const accountResult = await dynamodbClient.query({
    TableName: DYNAMODB_TABLE,
    IndexName: "GSI1",
    KeyConditionExpression: "#gsi1pk = :gsi1pk AND #gsi1sk = :gsi1sk",
    ExpressionAttributeNames: { "#gsi1pk": "GSI1PK", "#gsi1sk": "GSI1SK" },
    ExpressionAttributeValues: {
      ":gsi1pk": `ACCOUNT#${OIDC_PROVIDER}`,
      ":gsi1sk": `ACCOUNT#${oidcSub}`,
    },
  });
  const account = accountResult.Items?.[0];
  const adapterUserId = account?.userId as string | undefined;
  return adapterUserId ?? null;
}

/**
 * Internal API: Get RunUser profile by OIDC subject.
 *
 * Protected by AUTH_INTERNAL_SECRET (server-to-server only).
 * Resolves OIDC sub → adapter userId via authjs accounts table,
 * then returns the RunUser profile from ElectroDB.
 *
 * Used by run.flash to get MQTT credentials and display name.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ oidcSub: string }> }
) {
  // Verify internal secret
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { oidcSub } = await params;
  if (!oidcSub) {
    return NextResponse.json({ error: "Missing oidcSub" }, { status: 400 });
  }

  try {
    // Resolve the OIDC subject to its Auth.js adapter userId.
    const adapterUserId = await resolveAdapterUserId(oidcSub);
    if (!adapterUserId) {
      return NextResponse.json(
        { error: "No account found for OIDC subject" },
        { status: 404 }
      );
    }

    // Look up the RunUser profile by adapter userId
    const user = await getRunUser(adapterUserId);
    if (!user) {
      return NextResponse.json(
        { error: "RunUser not found" },
        { status: 404 }
      );
    }

    // Least-privilege summary for the run.auth admin dashboard tie-back:
    // only the run.human id + display name cross the wire, never mqtt secrets.
    const url = new URL(req.url);
    if (url.searchParams.get("summary") === "1") {
      return NextResponse.json({
        found: true,
        runUserId: user.userId,
        displayName: user.displayName,
      });
    }

    // The runner's email lives on the authjs adapter USER record (not on
    // RunUser). Best-effort: a lookup miss returns null email rather than
    // failing the whole endpoint — the bib CSV enrichment treats null as blank.
    let email: string | null = null;
    try {
      const userRec = await dynamodbClient.get({
        TableName: DYNAMODB_TABLE,
        Key: { pk: `USER#${adapterUserId}`, sk: `USER#${adapterUserId}` },
      });
      const raw = userRec.Item?.email;
      email = typeof raw === "string" && raw ? raw : null;
    } catch (e) {
      console.error("[run.human] /api/internal/user email lookup:", e);
    }

    // Return safe subset needed by flash + bib.
    // `hash` is the SHA256 QR-lookup value already surfaced in public /r?h= URLs;
    // it is NOT a secret. Never expose the random QR seed or the RSA key-pair
    // hashes here — those are regeneration secrets that must stay run.human-internal.
    return NextResponse.json({
      userId: user.userId,
      displayName: user.displayName,
      mqttUsername: user.mqttUsername,
      mqttPassword: user.mqttPassword,
      mqttUsertype: user.mqttUsertype,
      hash: user.hash,
      email,
    });
  } catch (error) {
    console.error("[run.human] /api/internal/user error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Internal API: overwrite a runner's rabbit name (displayName) from run.bib.
 *
 * Secret-gated, server-to-server only. Fires when the runner saves their bib
 * name. Refuses to overwrite a manually-claimed name (see isDisplayNameLocked)
 * and never consumes the displayname_change quota — this is an internal sync,
 * not a user-initiated change. Idempotent and safe to call on every bib save.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ oidcSub: string }> }
) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== config.auth.internalSecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { oidcSub } = await params;
  if (!oidcSub) {
    return NextResponse.json({ error: "Missing oidcSub" }, { status: 400 });
  }

  let body: { displayName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const rawName = typeof body.displayName === "string" ? body.displayName : "";
  const name = normalizeSyncedName(rawName);
  if (!name) {
    // Too short / empty — nothing to sync, leave the rabbit name as-is.
    return NextResponse.json({ synced: false, reason: "too_short" });
  }

  try {
    const adapterUserId = await resolveAdapterUserId(oidcSub);
    if (!adapterUserId) {
      return NextResponse.json(
        { error: "No account found for OIDC subject" },
        { status: 404 }
      );
    }

    const user = await getRunUser(adapterUserId);
    if (!user) {
      return NextResponse.json({ error: "RunUser not found" }, { status: 404 });
    }

    if (
      isDisplayNameLocked(user.displayName, user.displayNameManual, adapterUserId)
    ) {
      return NextResponse.json({ synced: false, reason: "manual" });
    }

    // Accepted TOCTOU: the read above and the write below are not atomic, so a
    // pencil edit landing in the gap could be clobbered by this sync. The window
    // is sub-second and the field is a cosmetic display name, so we accept it
    // rather than add a conditional write.

    await updateRunUserProfile(adapterUserId, {
      displayName: name,
      displayNameManual: false,
    });
    return NextResponse.json({ synced: true, displayName: name });
  } catch (error) {
    console.error("[run.human] PATCH /api/internal/user error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
