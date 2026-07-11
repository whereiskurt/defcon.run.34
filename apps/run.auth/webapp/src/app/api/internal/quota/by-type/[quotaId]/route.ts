import { NextRequest, NextResponse } from "next/server";
import { listQuotaByType } from "@/services/quota";

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
 * GET /api/internal/quota/by-type/[quotaId]
 *
 * List every user's consumption for a single quota type in ONE GSI query
 * (service-to-service). Requires X-Internal-Secret header. Read-only.
 *
 * Returns the bare array so the run.human client consumes it directly:
 *   Array<{ userId, consumptionCount, remaining, updatedAt }>
 *
 * The admin session gate lives in run.human; this route is internal-only.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ quotaId: string }> }
) {
  try {
    if (!verifyInternalSecret(request)) {
      return NextResponse.json(
        { error: "Unauthorized", code: "INVALID_INTERNAL_SECRET" },
        { status: 401 }
      );
    }

    const { quotaId } = await params;

    if (!quotaId) {
      return NextResponse.json(
        { error: "Quota ID required", code: "MISSING_QUOTA_ID" },
        { status: 400 }
      );
    }

    const rows = await listQuotaByType(quotaId);

    return NextResponse.json(rows);
  } catch (error) {
    console.error("[GET /api/internal/quota/by-type/[quotaId]] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
