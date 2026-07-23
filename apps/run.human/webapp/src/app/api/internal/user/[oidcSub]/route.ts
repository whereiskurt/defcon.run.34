import { NextRequest, NextResponse } from "next/server";
import { dynamodbClient, DYNAMODB_TABLE } from "@/entities/client";
import { getRunUser, updateRunUserProfile } from "@/entities/run-user";
import { getAdapterUserIdBySub } from "@/entities/auth-user";
import { ensureRunnerToken } from "@/entities/runner-token";
import {
  isDisplayNameLocked,
  normalizeSyncedName,
} from "@/lib/rabbit-name-sync";
import { ensureRunHumanIdentity } from "@/lib/ensure-identity";
import { getAuthEmailBySub } from "@/lib/auth-email";
import { config } from "@/config";

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
    const adapterUserId = await getAdapterUserIdBySub(oidcSub);
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

    // Short social-QR token (first 16 of hash). Lazily ensure the
    // RunnerToken mapping row exists before any QR leaves the building
    // (bib PDFs build their QR from this). Best-effort: omit on failure.
    let shortToken: string | null = null;
    if (user.hash) {
      try {
        shortToken = await ensureRunnerToken(user.userId, user.hash);
      } catch (e) {
        console.error("[run.human] /api/internal/user ensureRunnerToken:", e);
      }
    }

    // Return safe subset needed by flash + bib.
    // `hash` is the SHA256 QR-lookup value already surfaced in public /r?h= URLs;
    // it is NOT a secret (and `shortToken` is a prefix of it). Never expose the
    // random QR seed or the RSA key-pair hashes here — those are regeneration
    // secrets that must stay run.human-internal.
    return NextResponse.json({
      userId: user.userId,
      displayName: user.displayName,
      mqttUsername: user.mqttUsername,
      mqttPassword: user.mqttPassword,
      mqttUsertype: user.mqttUsertype,
      ringtone: user.ringtone,
      hash: user.hash,
      shortToken,
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
 * Internal API: overwrite a runner's rabbit name (displayName) from run.bib, and
 * provision a run.human identity for a bib-only runner who has none yet.
 *
 * Secret-gated, server-to-server only. Fires when the runner saves their bib
 * name. Refuses to overwrite a manually-claimed name (see isDisplayNameLocked)
 * and never consumes the displayname_change quota — this is an internal sync,
 * not a user-initiated change. Idempotent and safe to call on every bib save.
 *
 * Provisioning (Kurt 2026-07-18): a runner who only ever used bib.defcon.run has
 * no run.human Auth.js account/RunUser, so previously this 404'd and they had no
 * social QR. Now, when no account is found, we mint one via the SAME Auth.js
 * adapter run.human's sign-in uses (ensure-identity.ts) — email pulled from
 * run.auth — so they get a real rabbit profile + QR, and a later real SSO
 * sign-in links to this exact account (no duplicate). This makes every future
 * bib runner self-provision on their first bib save; the one-off backfill script
 * replays this same endpoint for existing bibs.
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
  // May be null for a too-short/empty name — we still ensure the IDENTITY below
  // (so a bib runner always gets a profile + QR); only the name write is skipped.
  const name = normalizeSyncedName(rawName);

  try {
    let adapterUserId = await getAdapterUserIdBySub(oidcSub);
    let provisioned = false;

    if (!adapterUserId) {
      // Bib-only runner — never signed into run.human. Mint the identity so they
      // get a rabbit profile + social QR. Email is authoritative from run.auth;
      // without it we can't create the Auth.js user, so skip (the backfill or the
      // next bib save retries) rather than fail the caller's bib save.
      const email = await getAuthEmailBySub(oidcSub);
      if (!email) {
        return NextResponse.json({
          synced: false,
          reason: "no_identity_no_email",
        });
      }
      const { userId } = await ensureRunHumanIdentity(oidcSub, email, name);
      adapterUserId = userId;
      provisioned = true;
    }

    if (!name) {
      // Identity is ensured (freshly provisioned or pre-existing); a too-short /
      // empty name has nothing to sync — leave the rabbit name as-is.
      return NextResponse.json({ synced: false, reason: "too_short", provisioned });
    }

    const user = await getRunUser(adapterUserId);
    if (!user) {
      return NextResponse.json({ error: "RunUser not found" }, { status: 404 });
    }

    if (
      isDisplayNameLocked(user.displayName, user.displayNameManual, adapterUserId)
    ) {
      return NextResponse.json({ synced: false, reason: "manual", provisioned });
    }

    // Accepted TOCTOU: the read above and the write below are not atomic, so a
    // pencil edit landing in the gap could be clobbered by this sync. The window
    // is sub-second and the field is a cosmetic display name, so we accept it
    // rather than add a conditional write.

    await updateRunUserProfile(adapterUserId, {
      displayName: name,
      displayNameManual: false,
    });
    return NextResponse.json({ synced: true, displayName: name, provisioned });
  } catch (error) {
    console.error("[run.human] PATCH /api/internal/user error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
