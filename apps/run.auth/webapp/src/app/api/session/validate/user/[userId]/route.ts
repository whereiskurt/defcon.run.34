import { NextRequest, NextResponse } from "next/server";
import { getAuthProfile, getAuthProfileByEmail } from "@/entities/auth-profile";

/**
 * Internal Session Validation Endpoint (Server-to-Server)
 *
 * This endpoint allows other defcon.run services to fetch user claims
 * directly by userId or email without needing the user's session cookie.
 *
 * This is protected by a shared secret (X-Internal-Secret header).
 *
 * Usage:
 *   GET https://auth.defcon.run/use1/api/session/validate/user/{userId}
 *   GET https://auth.defcon.run/use1/api/session/validate/user/{email}
 *   Headers: X-Internal-Secret: <shared-secret>
 *
 * The endpoint auto-detects whether the parameter is a userId or email:
 * - If it contains '@', it's treated as an email
 * - Otherwise, it's treated as a userId
 *
 * Response:
 *   {
 *     "valid": true,
 *     "user": {
 *       "id": "user-id",
 *       "services": ["auth", "run", "gpx"],
 *       "linkedProviders": ["discord", "strava"]
 *     }
 *   }
 */

export type InternalValidateResponse =
  | {
      valid: true;
      user: {
        id: string;
        services: string[];
        linkedProviders: string[];
        sessionVersion: number;
        lockedOut: boolean;
        // The runner's primary login email (AuthProfile.email). null when the
        // profile has none. Additive field consumed by the run.bib admin
        // print-names CSV enrichment (bib has no email of its own — run.auth is
        // the authoritative source keyed by the OIDC subject).
        email: string | null;
      };
    }
  | {
      valid: false;
      error: "unauthorized" | "user_not_found" | "user_locked";
    };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  // Verify internal secret
  const internalSecret = request.headers.get("X-Internal-Secret");
  const expectedSecret = process.env.AUTH_INTERNAL_SECRET;

  if (!expectedSecret || internalSecret !== expectedSecret) {
    return NextResponse.json(
      { valid: false, error: "unauthorized" } as InternalValidateResponse,
      { status: 401 }
    );
  }

  const { userId: userIdOrEmail } = await params;

  if (!userIdOrEmail) {
    return NextResponse.json(
      { valid: false, error: "user_not_found" } as InternalValidateResponse,
      { status: 404 }
    );
  }

  try {
    // Auto-detect if the parameter is an email (contains '@') or userId
    const isEmail = userIdOrEmail.includes('@');
    const profile = isEmail
      ? await getAuthProfileByEmail(decodeURIComponent(userIdOrEmail))
      : await getAuthProfile(userIdOrEmail);

    if (!profile) {
      return NextResponse.json(
        { valid: false, error: "user_not_found" } as InternalValidateResponse,
        { status: 404 }
      );
    }

    // Build linked providers list
    const linkedProviders: string[] = [];
    if (profile.discord?.id) linkedProviders.push("discord");
    if (profile.github?.id) linkedProviders.push("github");
    if (profile.strava?.id) linkedProviders.push("strava");

    const lockedOut = profile.lockedOut ?? false;
    const sessionVersion = profile.sessionVersion ?? 1;

    return NextResponse.json({
      valid: true,
      user: {
        id: profile.userId,
        services: profile.services || [],
        linkedProviders,
        sessionVersion,
        lockedOut,
        email: profile.email ?? null,
      },
    } as InternalValidateResponse);
  } catch (error) {
    console.error("Internal session validation error:", error);
    return NextResponse.json(
      { valid: false, error: "user_not_found" } as InternalValidateResponse,
      { status: 500 }
    );
  }
}
