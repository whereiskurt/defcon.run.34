import { NextRequest, NextResponse } from "next/server";
import { restoreQuota } from "@/services/quota";
import { isValidQuotaId, type QuotaId } from "@/lib/quota-definitions";

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
 * POST /api/internal/quota/[userId]/[quotaId]/restore
 *
 * Restore quota for a specific user (service-to-service).
 * Requires X-Internal-Secret header.
 *
 * Body: { amount?: number }
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
    try {
      const body = await request.json();
      if (typeof body.amount === "number" && body.amount > 0) {
        amount = body.amount;
      }
    } catch {
      // Use default amount if body is empty or invalid
    }

    // Restore quota
    const result = await restoreQuota(userId, quotaId as QuotaId, amount);

    return NextResponse.json({
      success: result.success,
      userId,
      quotaId,
      restored: amount,
      remaining: result.remaining,
    });
  } catch (error) {
    console.error("[POST /api/internal/quota/.../restore] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
