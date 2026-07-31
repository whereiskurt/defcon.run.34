import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { buildDc34Heatmap } from "@/lib/heatmap-build";

/**
 * POST /api/gpx/internal/heatmap-build — Internal, service-to-service only
 * (Phase 71, HEAT-02).
 *
 * Triggered on an EventBridge schedule via an invoker Lambda. Rebuilds the DC34
 * heat-map artifact and writes it to `uploads/HEATMAP/dc34.json`. Guarded by the
 * shared internal secret header checked below.
 *
 * NETWORK POSTURE — measured, not assumed (CR-01). An earlier version of this
 * comment asserted that the path was private to the VPC, that no CDN behaviour
 * mapped it, and that the secret below was merely an additional layer of
 * defence. Every one of those claims was false in this deployment, and a live
 * probe falsified them: an unauthenticated POST from the open internet came back
 * carrying this handler's OWN response body, so the request traversed the CDN
 * and the load balancer and reached the Next.js process. The region-wildcard
 * ordered cache behaviour on the gpx distribution forwards `/{region}/*` — POST
 * included — to the ALB, and the run.gpx ALB listener rule carries no path
 * patterns at all, so every path on that host is forwarded. See
 * 71-VERIFICATION.md truth #24.
 *
 * Therefore, TODAY, the guard in this file is the SOLE control on this endpoint.
 * Plan 71-13 adds a dedicated CloudFront ordered cache behaviour ahead of that
 * wildcard which answers a fixed 404 for the whole `/{region}/api/gpx/internal/*`
 * family — that behaviour is where the network layer actually lives, and it also
 * covers the `strava-sync` sibling, which carries the same inherited false claim
 * and is equally reachable.
 *
 * Do NOT restate an unverified network claim here. A comment is not a control.
 * If you believe a layer exists, prove it with a probe first: 71-13's probe
 * assertion distinguishes an edge rejection from an application rejection by
 * requiring a response this handler could not have produced. A non-2xx alone
 * cannot tell the two apart — which is exactly how the original claim survived
 * review, since the guard's own denial satisfied the probe identically to an
 * unreachable path.
 *
 * No request body is read — a DC34 rebuild takes no parameters (unlike
 * strava-sync's `afterDays`). Deliberately no knob without a caller.
 */

/**
 * Bare 404 on every denial, never 403 — the repo's non-disclosure convention
 * (see run.human's `api/admin/users/[userId]/recalculate/route.ts`). A 403
 * confirms the path exists and is merely guarded, which is free reconnaissance
 * on an endpoint reachable from the open internet until 71-13 lands.
 */
const NOT_FOUND = () => new NextResponse(null, { status: 404 });

/**
 * Constant-time secret comparison.
 *
 * The length check is deliberate and is NOT itself the leak worth defending
 * against here — `timingSafeEqual` throws unless both buffers are the same size,
 * so an explicit early return is the only way to run the primitive at all. What
 * it protects is the byte-by-byte comparison of two equal-length candidates,
 * which is precisely where a short-circuiting `!==` leaks a matching prefix.
 */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  // 2026-07-21 pattern (carried forward from strava-sync/route.ts:17-21): the
  // Lambda invoker sends the shared secret as `INTERNAL_SYNC_SECRET`, but the
  // deployed tasks only carry `AUTH_INTERNAL_SECRET` — fall back to it so the
  // guard doesn't reject a legitimately-secreted request.
  //
  // `||`, NOT `??` (IN-04): the nullish operator falls back only on
  // null/undefined, so an empty-string `INTERNAL_SYNC_SECRET` — a trivially easy
  // SSM/Terraform mistake — used to skip the working fallback and pin this
  // endpoint to a permanent rejection. The heat map then silently stopped
  // updating, with nothing logged and nothing paging.
  const secret =
    process.env.INTERNAL_SYNC_SECRET || process.env.AUTH_INTERNAL_SECRET;
  if (!secret) {
    // Fail closed, but LOUDLY. This branch means the build endpoint is disabled
    // and the artifact is going stale; it must not be indistinguishable in the
    // logs from a routine unauthenticated probe.
    console.error(
      "[heatmap] no internal secret configured (INTERNAL_SYNC_SECRET / AUTH_INTERNAL_SECRET) — dc34 build endpoint is disabled"
    );
    return NOT_FOUND();
  }
  if (!secretMatches(request.headers.get("x-internal-secret"), secret)) {
    return NOT_FOUND();
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

// NO `maxDuration` EXPORT — deliberately removed (WR-03). `next.config.ts` sets
// `output: "standalone"` and this app runs on ECS Fargate, so that export is a
// serverless deployment hint the standalone Node server does not enforce. It
// bounded nothing, yet a Terraform variable's description was written to satisfy
// a "CONTRACT" with the fictional number — worse than having no number at all,
// because it reads as settled.
//
// THE REAL BOUND is `BUILD_BUDGET_MS` in `lib/heatmap-build.ts` — 240000 ms
// (240 s) — enforced inside the builder's own chunk loop, which aborts WITHOUT
// publishing. That is the one number to code against. It is the innermost link
// of a strictly increasing chain: builder 240 s < invoker fetch abort 300 s <
// Lambda `lambda_timeout` 420 s. Plan 71-14 sets the outer two; changing 240000
// means changing them too.
