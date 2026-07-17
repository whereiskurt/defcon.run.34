import { NextResponse } from "next/server";
import { listStravaUserTokens, getStravaUserToken } from "@/lib/strava-tokens";

/**
 * GET /api/internal/strava-tokens - Internal, service-to-service only.
 *
 * Two modes, both guarded by the shared secret in `x-internal-secret`
 * (INTERNAL_SYNC_SECRET) — NOT a user-facing endpoint, never exposed via CloudFront:
 *   - no query      → all linked users' fresh tokens for the batch ingestion worker
 *                     (v1.7 Phase 31b).
 *   - ?userId=<id>  → a SINGLE runner's fresh token for the per-user "Sync my Strava"
 *                     button (Phase 61). run.gpx passes the SESSION user's own id.
 *
 * Both modes return the same `{ tokens: StravaUserToken[] }` shape (single-user mode
 * returns 0 or 1), so the existing batch caller is unaffected.
 */
export async function GET(request: Request) {
  const secret = process.env.INTERNAL_SYNC_SECRET;
  if (!secret || request.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = new URL(request.url).searchParams.get("userId");

  try {
    if (userId) {
      const token = await getStravaUserToken(userId);
      return NextResponse.json({ tokens: token ? [token] : [] });
    }
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
