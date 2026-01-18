import { NextRequest, NextResponse } from "next/server";
import { getUserQuotas } from "@/services/quota";
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
 * GET /api/internal/quota/[userId]
 *
 * List all quotas for a specific user (service-to-service).
 * Requires X-Internal-Secret header.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    if (!verifyInternalSecret(request)) {
      return NextResponse.json(
        { error: "Unauthorized", code: "INVALID_INTERNAL_SECRET" },
        { status: 401 }
      );
    }

    const { userId } = await params;

    if (!userId) {
      return NextResponse.json(
        { error: "User ID required", code: "MISSING_USER_ID" },
        { status: 400 }
      );
    }

    // Get user's quota tier for context
    const profile = await getAuthProfile(userId);
    const quotaTier = (profile?.quotaTier as "zero" | "upload" | "admin") || "upload";

    // Get all initialized quotas
    const quotas = await getUserQuotas(userId);

    return NextResponse.json({
      userId,
      quotaTier,
      quotas: quotas.map((q) => ({
        quotaId: q.quotaId,
        remaining: q.remaining,
        initialAmount: q.initialAmount,
        totalConsumed: q.totalConsumed ?? 0,
        consumptionCount: q.consumptionCount ?? 0,
        lastResetAt: q.lastResetAt,
        nextResetAt: q.nextResetAt,
      })),
    });
  } catch (error) {
    console.error("[GET /api/internal/quota/[userId]] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
