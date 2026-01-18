import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getAuthProfile } from "@/entities/auth-profile";

const INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET;

/**
 * Check if request is from admin (session or internal secret)
 */
async function isAuthorized(request: NextRequest): Promise<boolean> {
  // Check internal secret first
  const providedSecret = request.headers.get("X-Internal-Secret");
  if (providedSecret === INTERNAL_SECRET && INTERNAL_SECRET) {
    return true;
  }

  // Check session
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_JWT_SECRET?.split(",")[0],
    cookieName: "sess_auth",
  });

  if (!token?.sub) {
    return false;
  }

  // Check if user is admin
  const profile = await getAuthProfile(token.sub);
  return profile?.services?.includes("admin") ?? false;
}

/**
 * POST /api/admin/quota/cleanup-stale
 *
 * Cleanup stale pending quotas.
 * This is a placeholder - actual cleanup logic depends on how pending
 * uploads are tracked. In run.human, this would clean up UserUpload records.
 *
 * For the centralized quota service, this endpoint allows services to
 * call for cleanup coordination.
 *
 * Body: { maxAgeHours?: number, limit?: number }
 */
export async function POST(request: NextRequest) {
  try {
    if (!(await isAuthorized(request))) {
      return NextResponse.json(
        { error: "Unauthorized", code: "NOT_ADMIN" },
        { status: 403 }
      );
    }

    // Parse body
    let maxAgeHours = 2;
    let limit = 100;

    try {
      const body = await request.json();
      if (typeof body.maxAgeHours === "number" && body.maxAgeHours > 0) {
        maxAgeHours = body.maxAgeHours;
      }
      if (typeof body.limit === "number" && body.limit > 0) {
        limit = Math.min(body.limit, 1000); // Cap at 1000
      }
    } catch {
      // Use defaults if body is empty or invalid
    }

    // Note: The actual cleanup of pending uploads is handled by each service
    // (e.g., run.human has cleanupStaleUploads for UserUpload records).
    // This endpoint is for coordination and could be extended to:
    // 1. Notify services to run cleanup
    // 2. Track cleanup statistics across services
    // 3. Run cleanup on quota records that are orphaned

    return NextResponse.json({
      success: true,
      message: "Cleanup coordination endpoint. Services should implement their own cleanup logic.",
      parameters: {
        maxAgeHours,
        limit,
      },
      note: "Each service (run.human, run.gpx) handles cleanup of their pending upload records.",
    });
  } catch (error) {
    console.error("[POST /api/admin/quota/cleanup-stale] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
