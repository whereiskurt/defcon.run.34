import { NextResponse } from "next/server";
import { buildDc34Heatmap } from "@/lib/heatmap-build";

/**
 * POST /api/gpx/internal/heatmap-build — Internal, service-to-service only
 * (Phase 71, HEAT-02).
 *
 * Triggered on an EventBridge schedule via an invoker Lambda. Rebuilds the DC34
 * heat-map artifact and writes it to `uploads/HEATMAP/dc34.json`. Guarded by the
 * shared internal secret header checked below.
 *
 * NETWORK POSTURE — same as the `strava-sync` sibling: this route is reachable
 * only at the VPC-private Cloud Map name, never through CloudFront. The ALB
 * accepts 443 solely from the CloudFront managed prefix list, and no CloudFront
 * behaviour maps `/api/gpx/internal/*`. The shared-secret guard below is the
 * second layer, not the only one; 71-08 probes the public host for this path and
 * requires a non-2xx (T-71-05).
 *
 * No request body is read — a DC34 rebuild takes no parameters (unlike
 * strava-sync's `afterDays`). Deliberately no knob without a caller.
 */
export async function POST(request: Request) {
  // 2026-07-21 pattern (carried forward from strava-sync/route.ts:17-21): the
  // Lambda invoker sends the shared secret as `INTERNAL_SYNC_SECRET`, but the
  // deployed tasks only carry `AUTH_INTERNAL_SECRET` — fall back to it so the
  // guard doesn't reject a legitimately-secreted request.
  const secret = process.env.INTERNAL_SYNC_SECRET ?? process.env.AUTH_INTERNAL_SECRET;
  if (!secret || request.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await buildDc34Heatmap();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    // Log the detail to CloudWatch; return a generic message so the caller never
    // sees an exception string (T-71-08).
    console.error("[heatmap] dc34 build failed:", error);
    return NextResponse.json({ error: "Heatmap build failed" }, { status: 500 });
  }
}

// The build fans out over every con-day run's GPX object in S3; give it room
// beyond the default.
//
// CONTRACT WITH 71-07: the invoker Lambda's Terraform `lambda_timeout` must be
// >= this number. If the invoker times out first, the scheduler retries while
// the build is still running and the next run overlaps it — the same landmine
// already recorded in the strava-sync terragrunt unit's inputs block.
export const maxDuration = 300;
