import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { config } from "@/config";
import { cleanupStaleUploads } from "@/services/quota";
import type { QuotaTier } from "@/lib/quota-client";

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
 * Make request to central quota admin API
 */
async function proxyToQuotaService(
  endpoint: string,
  method: string = "GET",
  body?: unknown
): Promise<Response> {
  const url = `${config.urls.privateAuthServer}${endpoint}`;

  return fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": config.auth.internalSecret,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

/**
 * POST /api/admin/quota
 *
 * Admin endpoint for managing user quotas.
 * Proxies most operations to the central quota service in run.auth.
 * Keeps cleanup_stale local as it uses run.human's UserUpload entity.
 *
 * Actions:
 *   - get: Get all quotas for a user
 *   - reset: Reset a specific quota to user's stored initial amount
 *   - reset_to_tier: Reset quota to a specific tier's amount (via upgrade_tier)
 *   - set_limit: Set a custom limit for a quota
 *   - upgrade_tier: Upgrade all quotas to a new tier
 *   - cleanup_stale: Clean up stale pending uploads and restore quotas (local)
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

    // cleanup_stale doesn't require targetUserId and is handled locally
    if (action !== "cleanup_stale" && !targetUserId) {
      return NextResponse.json(
        { success: false, message: "targetUserId is required" },
        { status: 400 }
      );
    }

    switch (action) {
      case "get": {
        const response = await proxyToQuotaService(`/api/admin/quota/${targetUserId}`);
        const data = await response.json();

        if (!response.ok) {
          return NextResponse.json(
            { success: false, message: data.error || "Failed to get quotas" },
            { status: response.status }
          );
        }

        return NextResponse.json({
          success: true,
          data,
        });
      }

      case "reset": {
        if (!quotaId) {
          return NextResponse.json(
            { success: false, message: "quotaId is required" },
            { status: 400 }
          );
        }

        const response = await proxyToQuotaService(
          `/api/admin/quota/${targetUserId}/${quotaId}/reset`,
          "POST"
        );
        const data = await response.json();

        if (!response.ok) {
          return NextResponse.json(
            { success: false, message: data.error || "Failed to reset quota" },
            { status: response.status }
          );
        }

        return NextResponse.json({
          success: true,
          message: `Reset ${quotaId} for user ${targetUserId}`,
          data,
        });
      }

      case "reset_to_tier": {
        // Use upgrade_tier with specific quotaId to reset to tier
        if (!quotaId || !tier) {
          return NextResponse.json(
            { success: false, message: "quotaId and tier are required" },
            { status: 400 }
          );
        }

        const response = await proxyToQuotaService(
          `/api/admin/quota/upgrade-tier`,
          "POST",
          { userId: targetUserId, newTier: tier, quotaIds: [quotaId] }
        );
        const data = await response.json();

        if (!response.ok) {
          return NextResponse.json(
            { success: false, message: data.error || "Failed to reset to tier" },
            { status: response.status }
          );
        }

        return NextResponse.json({
          success: true,
          message: `Reset ${quotaId} to ${tier} tier for user ${targetUserId}`,
          data,
        });
      }

      case "set_limit": {
        if (!quotaId || typeof amount !== "number") {
          return NextResponse.json(
            { success: false, message: "quotaId and amount are required" },
            { status: 400 }
          );
        }

        const response = await proxyToQuotaService(
          `/api/admin/quota/${targetUserId}/${quotaId}/set`,
          "POST",
          { newLimit: amount, resetToNewLimit: true }
        );
        const data = await response.json();

        if (!response.ok) {
          return NextResponse.json(
            { success: false, message: data.error || "Failed to set limit" },
            { status: response.status }
          );
        }

        return NextResponse.json({
          success: true,
          message: `Set ${quotaId} limit to ${amount} for user ${targetUserId}`,
          data,
        });
      }

      case "upgrade_tier": {
        if (!tier) {
          return NextResponse.json(
            { success: false, message: "tier is required" },
            { status: 400 }
          );
        }

        const response = await proxyToQuotaService(
          `/api/admin/quota/upgrade-tier`,
          "POST",
          { userId: targetUserId, newTier: tier }
        );
        const data = await response.json();

        if (!response.ok) {
          return NextResponse.json(
            { success: false, message: data.error || "Failed to upgrade tier" },
            { status: response.status }
          );
        }

        return NextResponse.json({
          success: true,
          message: `Upgraded all quotas to ${tier} tier for user ${targetUserId}`,
          data,
        });
      }

      case "cleanup_stale": {
        // This remains local as it uses run.human's UserUpload entity
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
