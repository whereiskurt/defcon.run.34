import { NextRequest, NextResponse } from "next/server";
import { listAllProfileServices } from "@/services/auth-profile";

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
 * GET /api/internal/auth-profiles/services
 *
 * List every user's authorized services in ONE table scan (service-to-service).
 * Requires X-Internal-Secret header. Read-only.
 *
 * Returns the bare array so the run.human client consumes it directly:
 *   Array<{ sub, services }>
 *
 * The admin session gate lives in run.human; this route is internal-only.
 */
export async function GET(request: NextRequest) {
  try {
    if (!verifyInternalSecret(request)) {
      return NextResponse.json(
        { error: "Unauthorized", code: "INVALID_INTERNAL_SECRET" },
        { status: 401 }
      );
    }

    const rows = await listAllProfileServices();

    return NextResponse.json(rows);
  } catch (error) {
    console.error("[GET /api/internal/auth-profiles/services] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
