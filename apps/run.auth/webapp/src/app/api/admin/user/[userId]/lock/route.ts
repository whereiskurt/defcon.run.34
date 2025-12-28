import { NextRequest, NextResponse } from "next/server";
import { AuthProfile, getAuthProfile, getAuthProfileByEmail } from "@/entities/auth-profile";

/**
 * Admin User Lock/Unlock Endpoint (Server-to-Server)
 *
 * This endpoint allows admin services to lock or unlock user accounts.
 * When a user is locked:
 * - Their sessionVersion is incremented (invalidates existing sessions)
 * - lockedOut is set to true (prevents new logins)
 *
 * Protected by X-Internal-Secret header.
 *
 * The {userId} parameter can be either:
 * - A user ID (e.g., "abc123")
 * - An email address (e.g., "user@example.com")
 *
 * Usage:
 *   POST https://auth.defcon.run/api/admin/user/{userId}/lock
 *   POST https://auth.defcon.run/api/admin/user/{email}/lock
 *   Headers: X-Internal-Secret: <shared-secret>
 *   Body: { "locked": true, "reason": "Suspicious activity" }
 *
 *   POST https://auth.defcon.run/api/admin/user/{userId}/lock
 *   Headers: X-Internal-Secret: <shared-secret>
 *   Body: { "locked": false }
 *
 * Response:
 *   {
 *     "success": true,
 *     "user": {
 *       "id": "user-id",
 *       "lockedOut": true,
 *       "sessionVersion": 2,
 *       "lockoutReason": "Suspicious activity"
 *     }
 *   }
 */

export type AdminLockResponse =
  | {
      success: true;
      user: {
        id: string;
        lockedOut: boolean;
        sessionVersion: number;
        lockoutReason?: string;
      };
    }
  | {
      success: false;
      error: "unauthorized" | "user_not_found" | "invalid_request";
      message?: string;
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
      { success: false, error: "unauthorized" } as AdminLockResponse,
      { status: 401 }
    );
  }

  const { userId: identifier } = await params;

  if (!identifier) {
    return NextResponse.json(
      { success: false, error: "user_not_found" } as AdminLockResponse,
      { status: 404 }
    );
  }

  try {
    // Parse request body
    const body = await request.json();
    const { locked, reason } = body as { locked?: boolean; reason?: string };

    if (typeof locked !== "boolean") {
      return NextResponse.json(
        {
          success: false,
          error: "invalid_request",
          message: "Request body must include 'locked' boolean field",
        } as AdminLockResponse,
        { status: 400 }
      );
    }

    // Resolve user by ID or email
    const resolved = await resolveUser(identifier);
    if (!resolved) {
      return NextResponse.json(
        { success: false, error: "user_not_found" } as AdminLockResponse,
        { status: 404 }
      );
    }

    const { profile, userId } = resolved;
    const currentVersion = profile.sessionVersion ?? 1;
    const now = Date.now();

    if (locked) {
      // Lock the user: increment session version and set lockedOut
      await AuthProfile.update({ userId })
        .set({
          lockedOut: true,
          sessionVersion: currentVersion + 1,
          lockoutReason: reason || "Locked by admin",
          lockedAt: now,
        })
        .go();

      return NextResponse.json({
        success: true,
        user: {
          id: userId,
          lockedOut: true,
          sessionVersion: currentVersion + 1,
          lockoutReason: reason || "Locked by admin",
        },
      } as AdminLockResponse);
    } else {
      // Unlock the user: clear lockedOut but keep sessionVersion incremented
      // (so any old sessions before unlock are still invalid)
      await AuthProfile.update({ userId })
        .set({
          lockedOut: false,
          sessionVersion: currentVersion + 1,
        })
        .remove(["lockoutReason", "lockedAt"])
        .go();

      return NextResponse.json({
        success: true,
        user: {
          id: userId,
          lockedOut: false,
          sessionVersion: currentVersion + 1,
        },
      } as AdminLockResponse);
    }
  } catch (error) {
    console.error("Admin lock error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "invalid_request",
        message: "Failed to update user",
      } as AdminLockResponse,
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check current lock status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  // Verify internal secret
  const internalSecret = request.headers.get("X-Internal-Secret");
  const expectedSecret = process.env.AUTH_INTERNAL_SECRET;

  if (!expectedSecret || internalSecret !== expectedSecret) {
    return NextResponse.json(
      { success: false, error: "unauthorized" } as AdminLockResponse,
      { status: 401 }
    );
  }

  const { userId: identifier } = await params;

  if (!identifier) {
    return NextResponse.json(
      { success: false, error: "user_not_found" } as AdminLockResponse,
      { status: 404 }
    );
  }

  try {
    // Resolve user by ID or email
    const resolved = await resolveUser(identifier);
    if (!resolved) {
      return NextResponse.json(
        { success: false, error: "user_not_found" } as AdminLockResponse,
        { status: 404 }
      );
    }

    const { profile, userId } = resolved;

    return NextResponse.json({
      success: true,
      user: {
        id: userId,
        lockedOut: profile.lockedOut ?? false,
        sessionVersion: profile.sessionVersion ?? 1,
        lockoutReason: profile.lockoutReason,
      },
    } as AdminLockResponse);
  } catch (error) {
    console.error("Admin lock status error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "invalid_request",
        message: "Failed to get user status",
      } as AdminLockResponse,
      { status: 500 }
    );
  }
}
