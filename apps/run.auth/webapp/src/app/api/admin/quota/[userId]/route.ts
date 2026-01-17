import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getUserQuotas } from "@/services/quota";
import { getAuthProfile } from "@/entities/auth-profile";

const INTERNAL_SECRET = process.env.AUTH_INTERNAL_SECRET;

/**
 * Check if request is from admin (session or internal secret)
 */
async function isAuthorized(request: NextRequest): Promise<{
  authorized: boolean;
  isAdmin: boolean;
  userId?: string;
}> {
  // Check internal secret first
  const providedSecret = request.headers.get("X-Internal-Secret");
  if (providedSecret === INTERNAL_SECRET && INTERNAL_SECRET) {
    return { authorized: true, isAdmin: true };
  }

  // Check session
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_JWT_SECRET?.split(",")[0],
    cookieName: "sess_auth",
  });

  if (!token?.sub) {
    return { authorized: false, isAdmin: false };
  }

  // Check if user is admin
  const profile = await getAuthProfile(token.sub);
  const isAdmin = profile?.services?.includes("admin") ?? false;

  return { authorized: isAdmin, isAdmin, userId: token.sub };
}

/**
 * GET /api/admin/quota/[userId]
 *
 * List all quotas for a specific user (admin view).
 * Requires admin session or X-Internal-Secret.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const auth = await isAuthorized(request);
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized", code: "NOT_ADMIN" },
        { status: 403 }
      );
    }

    const { userId } = await params;

    if (!userId) {
      return NextResponse.json(
        { error: "User ID required", code: "MISSING_USER_ID" },
        { status: 400 }
      );
    }

    // Get target user's profile
    const profile = await getAuthProfile(userId);
    const quotaTier = (profile?.quotaTier as "zero" | "upload" | "admin") || "upload";

    // Get all quotas
    const quotas = await getUserQuotas(userId);

    return NextResponse.json({
      userId,
      quotaTier,
      services: profile?.services ?? [],
      quotas: quotas.map((q) => ({
        quotaId: q.quotaId,
        remaining: q.remaining,
        initialAmount: q.initialAmount,
        totalConsumed: q.totalConsumed ?? 0,
        consumptionCount: q.consumptionCount ?? 0,
        lastResetAt: q.lastResetAt,
        nextResetAt: q.nextResetAt,
        createdAt: q.createdAt,
        updatedAt: q.updatedAt,
      })),
    });
  } catch (error) {
    console.error("[GET /api/admin/quota/[userId]] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
