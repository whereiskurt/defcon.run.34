import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/config/auth";
import {
  getUserQuotas,
  resetQuota,
  resetQuotaToTier,
  setUserQuotaLimit,
  upgradeUserToTier,
  cleanupStaleUploads,
  getUserTier,
  type QuotaId,
  type QuotaTier,
} from "@/services/quota";
import { isValidQuotaId, getAllQuotaIds } from "@/lib/quota-definitions";

/**
 * Check if the current user is an admin
 */
function isAdmin(session: { user?: { services?: string[] } } | null): boolean {
  if (!session?.user?.services) return false;
  return session.user.services.includes("admin");
}

interface AdminQuotaRequest {
  action: "get" | "reset" | "reset_to_tier" | "set_limit" | "upgrade_tier" | "cleanup_stale";
  targetUserId?: string;
  quotaId?: string;
  tier?: QuotaTier;
  amount?: number;
  maxAgeHours?: number;
  limit?: number;
}

interface AdminQuotaResponse {
  success: boolean;
  message?: string;
  data?: unknown;
}

/**
 * POST /api/admin/quota
 *
 * Admin endpoint for managing user quotas.
 * Requires admin service in user's services array.
 *
 * Actions:
 *   - get: Get all quotas for a user
 *   - reset: Reset a specific quota to user's stored initial amount
 *   - reset_to_tier: Reset quota to a specific tier's amount
 *   - set_limit: Set a custom limit for a quota
 *   - upgrade_tier: Upgrade all quotas to a new tier
 *   - cleanup_stale: Clean up stale pending uploads and restore quotas
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<AdminQuotaResponse>> {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!isAdmin(session)) {
      return NextResponse.json(
        { success: false, message: "Forbidden: Admin access required" },
        { status: 403 }
      );
    }

    const body: AdminQuotaRequest = await request.json();
    const { action, targetUserId, quotaId, tier, amount, maxAgeHours, limit } = body;

    // cleanup_stale doesn't require targetUserId
    if (action !== "cleanup_stale" && !targetUserId) {
      return NextResponse.json(
        { success: false, message: "targetUserId is required" },
        { status: 400 }
      );
    }

    switch (action) {
      case "get": {
        const quotas = await getUserQuotas(targetUserId!);
        return NextResponse.json({
          success: true,
          data: {
            userId: targetUserId,
            quotas,
            tier: getUserTier([]), // Would need user's services to determine actual tier
          },
        });
      }

      case "reset": {
        if (!quotaId || !isValidQuotaId(quotaId)) {
          return NextResponse.json(
            {
              success: false,
              message: `Invalid quotaId. Must be one of: ${getAllQuotaIds().join(", ")}`,
            },
            { status: 400 }
          );
        }
        const result = await resetQuota(targetUserId!, quotaId as QuotaId);
        return NextResponse.json({
          success: true,
          message: `Reset ${quotaId} for user ${targetUserId}`,
          data: { remaining: result.remaining },
        });
      }

      case "reset_to_tier": {
        if (!quotaId || !isValidQuotaId(quotaId)) {
          return NextResponse.json(
            {
              success: false,
              message: `Invalid quotaId. Must be one of: ${getAllQuotaIds().join(", ")}`,
            },
            { status: 400 }
          );
        }
        if (!tier || !["zero", "upload", "admin"].includes(tier)) {
          return NextResponse.json(
            { success: false, message: "Invalid tier. Must be: zero, upload, or admin" },
            { status: 400 }
          );
        }
        const result = await resetQuotaToTier(targetUserId!, quotaId as QuotaId, tier);
        return NextResponse.json({
          success: true,
          message: `Reset ${quotaId} to ${tier} tier for user ${targetUserId}`,
          data: { remaining: result.remaining },
        });
      }

      case "set_limit": {
        if (!quotaId || !isValidQuotaId(quotaId)) {
          return NextResponse.json(
            {
              success: false,
              message: `Invalid quotaId. Must be one of: ${getAllQuotaIds().join(", ")}`,
            },
            { status: 400 }
          );
        }
        if (typeof amount !== "number" || amount < 0) {
          return NextResponse.json(
            { success: false, message: "amount must be a non-negative number" },
            { status: 400 }
          );
        }
        await setUserQuotaLimit(targetUserId!, quotaId as QuotaId, amount);
        return NextResponse.json({
          success: true,
          message: `Set ${quotaId} limit to ${amount} for user ${targetUserId}`,
          data: { newLimit: amount },
        });
      }

      case "upgrade_tier": {
        if (!tier || !["zero", "upload", "admin"].includes(tier)) {
          return NextResponse.json(
            { success: false, message: "Invalid tier. Must be: zero, upload, or admin" },
            { status: 400 }
          );
        }
        await upgradeUserToTier(targetUserId!, tier);
        return NextResponse.json({
          success: true,
          message: `Upgraded all quotas to ${tier} tier for user ${targetUserId}`,
        });
      }

      case "cleanup_stale": {
        // Clean up stale pending uploads and restore quotas
        const maxAgeMs = (maxAgeHours ?? 2) * 60 * 60 * 1000;
        const cleanupLimit = limit ?? 100;
        const cleanupResult = await cleanupStaleUploads(maxAgeMs, cleanupLimit);
        return NextResponse.json({
          success: true,
          message: `Processed ${cleanupResult.processed} stale uploads, restored ${cleanupResult.restored} quotas`,
          data: cleanupResult,
        });
      }

      default:
        return NextResponse.json(
          {
            success: false,
            message: `Invalid action. Must be: get, reset, reset_to_tier, set_limit, upgrade_tier, or cleanup_stale`,
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("[admin/quota] Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
