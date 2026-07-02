import { NextResponse } from "next/server";
import { listStravaUserTokens } from "@/lib/strava-tokens";

/**
 * GET /api/internal/strava-tokens - Internal, service-to-service only (v1.7 Phase 31b).
 *
 * Returns a fresh Strava access token per linked user for the run.gpx ingestion worker
 * (cross-service option 3). Guarded by a shared secret in `x-internal-secret`
 * (INTERNAL_SYNC_SECRET) — NOT a user-facing endpoint, never exposed via CloudFront.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_SYNC_SECRET;
  if (!secret || request.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const tokens = await listStravaUserTokens();
    return NextResponse.json({ tokens });
  } catch (error) {
    console.error("Error listing Strava tokens:", error);
    return NextResponse.json(
      { error: "Failed to list Strava tokens" },
      { status: 500 }
    );
  }
}
