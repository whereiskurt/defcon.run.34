import { NextRequest, NextResponse } from "next/server";
import { dynamodbClient, DYNAMODB_TABLE } from "@/entities/client";
import { getRunUser } from "@/entities/run-user";
import { config } from "@/config";

const OIDC_PROVIDER = "run.defcon.run";

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
    // Look up the adapter userId from the authjs accounts table
    // The adapter stores: gsi1pk=ACCOUNT#provider, gsi1sk=ACCOUNT#providerAccountId
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

    // The account record has a 'userId' field linking to the adapter user
    const adapterUserId = account.userId as string;
    if (!adapterUserId) {
      return NextResponse.json(
        { error: "Account missing userId" },
        { status: 500 }
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
