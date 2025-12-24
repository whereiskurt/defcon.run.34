import { NextRequest, NextResponse } from "next/server";
import { AuthProfile, getAuthProfile, getAuthProfileByEmail } from "@/entities/auth-profile";

/**
 * Invalidate All User Sessions Endpoint (Server-to-Server)
 *
 * This endpoint allows services to invalidate all existing sessions for a user
 * without locking them out. The user can still log in again immediately.
 *
 * Use cases:
 * - User requests "sign out everywhere"
 * - Password change
 * - Security concern that doesn't require full lockout
 *
 * Protected by X-Internal-Secret header.
 *
 * The {userId} parameter can be either:
 * - A user ID (e.g., "abc123")
 * - An email address (e.g., "user@example.com")
 *
 * Usage:
 *   POST https://auth.defcon.run/api/admin/user/{userId}/invalidate-sessions
 *   POST https://auth.defcon.run/api/admin/user/{email}/invalidate-sessions
 *   Headers: X-Internal-Secret: <shared-secret>
 *
 * Response:
 *   {
 *     "success": true,
 *     "userId": "resolved-user-id",
 *     "sessionVersion": 3
 *   }
 */

export type InvalidateSessionsResponse =
  | {
      success: true;
      userId: string;
      sessionVersion: number;
    }
  | {
      success: false;
      error: "unauthorized" | "user_not_found";
    };

/**
 * Helper to resolve a user by ID or email
 * Returns the profile and resolved userId, or null if not found
 */
async function resolveUser(identifier: string) {
  // Check if identifier looks like an email (contains @)
  if (identifier.includes("@")) {
    const profile = await getAuthProfileByEmail(identifier);
    if (profile) {
      return { profile, userId: profile.userId };
    }
    return null;
  }

  // Otherwise treat as userId
  const profile = await getAuthProfile(identifier);
  if (profile) {
    return { profile, userId: identifier };
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  // Verify internal secret
  const internalSecret = request.headers.get("X-Internal-Secret");
  const expectedSecret = process.env.AUTH_INTERNAL_SECRET;

  if (!expectedSecret || internalSecret !== expectedSecret) {
    return NextResponse.json(
      { success: false, error: "unauthorized" } as InvalidateSessionsResponse,
      { status: 401 }
    );
  }

  const { userId: identifier } = await params;

  if (!identifier) {
    return NextResponse.json(
      { success: false, error: "user_not_found" } as InvalidateSessionsResponse,
      { status: 404 }
    );
  }

  try {
    // Resolve user by ID or email
    const resolved = await resolveUser(identifier);
    if (!resolved) {
      return NextResponse.json(
        { success: false, error: "user_not_found" } as InvalidateSessionsResponse,
        { status: 404 }
      );
    }

    const { profile, userId } = resolved;
    const currentVersion = profile.sessionVersion ?? 1;
    const newVersion = currentVersion + 1;

    // Increment session version to invalidate all existing sessions
    await AuthProfile.update({ userId })
      .set({ sessionVersion: newVersion })
      .go();

    return NextResponse.json({
      success: true,
      userId,
      sessionVersion: newVersion,
    } as InvalidateSessionsResponse);
  } catch (error) {
    console.error("Invalidate sessions error:", error);
    return NextResponse.json(
      { success: false, error: "user_not_found" } as InvalidateSessionsResponse,
      { status: 500 }
    );
  }
}
