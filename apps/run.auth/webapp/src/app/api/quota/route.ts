import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getUserQuotas } from "@/services/quota";
import { getAuthProfile } from "@/entities/auth-profile";

/**
 * GET /api/quota
 *
 * List all quotas for the authenticated user.
 * Requires session authentication.
 */
export async function GET(request: NextRequest) {
  try {
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

    const userId = token.sub;

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
    console.error("[GET /api/quota] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
