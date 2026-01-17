import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { checkQuota } from "@/services/quota";
import { isValidQuotaId, type QuotaId } from "@/lib/quota-definitions";
import { getAuthProfile } from "@/entities/auth-profile";

/**
 * POST /api/quota/[quotaId]/check
 *
 * Check if user has sufficient quota (read-only, no consumption).
 * Requires session authentication.
 *
 * Body: { amount?: number } (default 1)
 */
export async function POST(
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

    // Parse body
    let amount = 1;
    try {
      const body = await request.json();
      if (typeof body.amount === "number" && body.amount > 0) {
        amount = body.amount;
      }
    } catch {
      // Use default amount if body is empty or invalid
    }

    // Get user's quota tier
    const profile = await getAuthProfile(userId);
    const quotaTier = (profile?.quotaTier as "zero" | "upload" | "admin") || "upload";

    // Check quota
    const result = await checkQuota(userId, quotaId as QuotaId, amount, quotaTier);

    return NextResponse.json({
      allowed: result.allowed,
      remaining: result.remaining,
      requested: result.requested,
      quotaId: result.quotaId,
      wouldExceed: result.wouldExceed,
    });
  } catch (error) {
    console.error("[POST /api/quota/[quotaId]/check] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
