import { NextRequest, NextResponse } from "next/server";
import { getAuthProfile } from "@/entities/auth-profile";

/**
 * Internal Session Validation Endpoint (Server-to-Server)
 *
 * This endpoint allows other defcon.run services to fetch user claims
 * directly by userId without needing the user's session cookie.
 *
 * This is protected by a shared secret (X-Internal-Secret header).
 *
 * Usage:
 *   GET https://auth.defcon.run/api/session/validate/user/{userId}
 *   Headers: X-Internal-Secret: <shared-secret>
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
      };
    }
  | {
      valid: false;
      error: "unauthorized" | "user_not_found";
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

  const { userId } = await params;

  if (!userId) {
    return NextResponse.json(
      { valid: false, error: "user_not_found" } as InternalValidateResponse,
      { status: 404 }
    );
  }

  try {
    const profile = await getAuthProfile(userId);

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

    return NextResponse.json({
      valid: true,
      user: {
        id: userId,
        services: profile.services || [],
        linkedProviders,
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
