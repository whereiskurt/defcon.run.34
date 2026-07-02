import { NextResponse } from "next/server";
import { runStravaSync } from "@/lib/strava-sync";

/**
 * POST /api/gpx/internal/strava-sync - Internal, service-to-service only (v1.7 Phase 31b).
 *
 * Triggered on an EventBridge schedule (via an invoker). Pulls each linked user's
 * in-window Strava activities into their PRIVATE routes. Guarded by INTERNAL_SYNC_SECRET
 * in `x-internal-secret` — never exposed via CloudFront.
 */
export async function POST(request: Request) {
  const secret = process.env.INTERNAL_SYNC_SECRET;
  if (!secret || request.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await runStravaSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Strava sync failed:", error);
    return NextResponse.json({ error: "Strava sync failed" }, { status: 500 });
  }
}

// The sync fans out to the Strava API + S3/Dynamo; give it room beyond the default.
export const maxDuration = 300;
