import { NextRequest, NextResponse } from "next/server";
import { consumeQuota } from "@/services/quota";
import { isValidQuotaId, type QuotaId, type QuotaTier } from "@/lib/quota-definitions";
import { getAuthProfile } from "@/entities/auth-profile";

const INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET;

/**
 * Verify X-Internal-Secret header
 */
function verifyInternalSecret(request: NextRequest): boolean {
  if (!INTERNAL_SECRET) {
    console.error("[Internal API] AUTH_INTERNAL_SECRET not configured");
    return false;
  }
  const providedSecret = request.headers.get("X-Internal-Secret");
  return providedSecret === INTERNAL_SECRET;
}

/**
 * POST /api/internal/quota/[userId]/[quotaId]/consume
 *
 * Consume quota for a specific user (service-to-service).
 * Requires X-Internal-Secret header.
 *
 * Body: { amount?: number, tier?: QuotaTier }
 *
 * Returns:
 * - 200: Success with remaining count
 * - 429: Quota exceeded
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; quotaId: string }> }
) {
  try {
    if (!verifyInternalSecret(request)) {
      return NextResponse.json(
        { error: "Unauthorized", code: "INVALID_INTERNAL_SECRET" },
        { status: 401 }
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

    // Parse body
    let amount = 1;
    let tier: QuotaTier | undefined;
    try {
      const body = await request.json();
      if (typeof body.amount === "number" && body.amount > 0) {
        amount = body.amount;
      }
      if (body.tier && ["zero", "upload", "admin"].includes(body.tier)) {
        tier = body.tier as QuotaTier;
      }
    } catch {
      // Use defaults if body is empty or invalid
    }

    // Get user's quota tier if not provided
    if (!tier) {
      const profile = await getAuthProfile(userId);
      tier = (profile?.quotaTier as QuotaTier) || "upload";
    }

    // Consume quota
    const result = await consumeQuota(userId, quotaId as QuotaId, amount, tier);

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
      userId,
      quotaId: result.quotaId,
      consumed: result.consumed,
      remaining: result.remaining,
    });
  } catch (error) {
    console.error("[POST /api/internal/quota/.../consume] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
