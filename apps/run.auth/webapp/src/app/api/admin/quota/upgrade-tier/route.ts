import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { upgradeUserToTier } from "@/services/quota";
import { isValidQuotaId, type QuotaId, type QuotaTier } from "@/lib/quota-definitions";
import { getAuthProfile, AuthProfile } from "@/entities/auth-profile";

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
 * POST /api/admin/quota/upgrade-tier
 *
 * Upgrade a user to a new quota tier.
 * Requires admin session or X-Internal-Secret.
 *
 * Body: { userId: string, newTier: QuotaTier, quotaIds?: QuotaId[] }
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
    let userId: string;
    let newTier: QuotaTier;
    let quotaIds: QuotaId[] | undefined;

    try {
      const body = await request.json();

      if (!body.userId || typeof body.userId !== "string") {
        return NextResponse.json(
          { error: "userId is required", code: "MISSING_USER_ID" },
          { status: 400 }
        );
      }
      userId = body.userId;

      if (!body.newTier || !["zero", "upload", "admin"].includes(body.newTier)) {
        return NextResponse.json(
          { error: "newTier must be 'zero', 'upload', or 'admin'", code: "INVALID_TIER" },
          { status: 400 }
        );
      }
      newTier = body.newTier as QuotaTier;

      if (body.quotaIds) {
        if (!Array.isArray(body.quotaIds)) {
          return NextResponse.json(
            { error: "quotaIds must be an array", code: "INVALID_QUOTA_IDS" },
            { status: 400 }
          );
        }
        // Validate each quota ID
        for (const qid of body.quotaIds) {
          if (!isValidQuotaId(qid)) {
            return NextResponse.json(
              { error: `Invalid quota ID: ${qid}`, code: "INVALID_QUOTA_ID" },
              { status: 400 }
            );
          }
        }
        quotaIds = body.quotaIds as QuotaId[];
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid request body", code: "INVALID_BODY" },
        { status: 400 }
      );
    }

    // Update AuthProfile.quotaTier
    await AuthProfile.patch({ userId })
      .set({ quotaTier: newTier })
      .go();

    // Upgrade quotas to new tier
    await upgradeUserToTier(userId, newTier, quotaIds);

    return NextResponse.json({
      success: true,
      userId,
      newTier,
      quotaIds: quotaIds ?? "all",
      action: "upgrade_tier",
    });
  } catch (error) {
    console.error("[POST /api/admin/quota/upgrade-tier] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
