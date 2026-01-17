import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { consumeQuota } from "@/services/quota";
import { isValidQuotaId, type QuotaId } from "@/lib/quota-definitions";
import { getAuthProfile } from "@/entities/auth-profile";

/**
 * POST /api/quota/[quotaId]/consume
 *
 * Consume quota atomically.
 * Requires session authentication.
 *
 * Body: { amount?: number } (default 1)
 *
 * Returns:
 * - 200: Success with remaining count
 * - 429: Quota exceeded
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

    // Consume quota
    const result = await consumeQuota(userId, quotaId as QuotaId, amount, quotaTier);

    if (!result.success) {
      return NextResponse.json(
        {
          error: "Quota exceeded",
          code: "QUOTA_EXCEEDED",
          details: {
            quotaId: result.quotaId,
            remaining: result.remaining,
            requested: amount,
            reason: result.error,
          },
        },
        { status: 429 }
      );
    }

    return NextResponse.json({
      success: true,
      quotaId: result.quotaId,
      consumed: result.consumed,
      remaining: result.remaining,
    });
  } catch (error) {
    console.error("[POST /api/quota/[quotaId]/consume] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
