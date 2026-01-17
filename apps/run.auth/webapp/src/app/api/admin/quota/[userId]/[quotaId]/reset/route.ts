import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { resetQuota } from "@/services/quota";
import { isValidQuotaId, type QuotaId } from "@/lib/quota-definitions";
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
 * POST /api/admin/quota/[userId]/[quotaId]/reset
 *
 * Reset quota to initial amount (admin operation).
 * Requires admin session or X-Internal-Secret.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; quotaId: string }> }
) {
  try {
    if (!(await isAuthorized(request))) {
      return NextResponse.json(
        { error: "Unauthorized", code: "NOT_ADMIN" },
        { status: 403 }
      );
    }

    const { userId, quotaId } = await params;

    if (!userId) {
      return NextResponse.json(
        { error: "User ID required", code: "MISSING_USER_ID" },
        { status: 400 }
      );
    }

    if (!isValidQuotaId(quotaId)) {
      return NextResponse.json(
        { error: "Invalid quota ID", code: "INVALID_QUOTA_ID" },
        { status: 400 }
      );
    }

    // Reset quota
    const result = await resetQuota(userId, quotaId as QuotaId);

    return NextResponse.json({
      success: result.success,
      userId,
      quotaId,
      remaining: result.remaining,
      action: "reset",
    });
  } catch (error) {
    console.error("[POST /api/admin/quota/.../reset] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
