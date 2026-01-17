import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getOrInitQuota } from "@/services/quota";
import { isValidQuotaId, type QuotaId } from "@/lib/quota-definitions";
import { getAuthProfile } from "@/entities/auth-profile";

/**
 * GET /api/quota/[quotaId]
 *
 * Get specific quota for the authenticated user.
 * Auto-initializes quota if not exists.
 * Requires session authentication.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ quotaId: string }> }
) {
  try {
    const { quotaId } = await params;

    const token = await getToken({
      req: request,
      secret: process.env.AUTH_JWT_SECRET?.split(",")[0],
      cookieName: "sess_auth",
    });

    if (!token?.sub) {
      return NextResponse.json(
        { error: "Unauthorized", code: "NO_SESSION" },
        { status: 401 }
      );
    }

    if (!isValidQuotaId(quotaId)) {
      return NextResponse.json(
        { error: "Invalid quota ID", code: "INVALID_QUOTA_ID" },
        { status: 400 }
      );
    }

    const userId = token.sub;

    // Get user's quota tier
    const profile = await getAuthProfile(userId);
    const quotaTier = (profile?.quotaTier as "zero" | "upload" | "admin") || "upload";

    // Get or initialize quota
    const quota = await getOrInitQuota(userId, quotaId as QuotaId, quotaTier);

    return NextResponse.json({
      userId,
      quotaId: quota.quotaId,
      remaining: quota.remaining,
      initialAmount: quota.initialAmount,
      totalConsumed: quota.totalConsumed ?? 0,
      consumptionCount: quota.consumptionCount ?? 0,
      lastResetAt: quota.lastResetAt,
      nextResetAt: quota.nextResetAt,
      quotaTier,
    });
  } catch (error) {
    console.error("[GET /api/quota/[quotaId]] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
