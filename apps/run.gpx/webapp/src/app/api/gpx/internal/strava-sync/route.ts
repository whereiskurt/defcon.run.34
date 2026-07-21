import { NextResponse } from "next/server";
import { runStravaSync } from "@/lib/strava-sync";

const MIN_AFTER_DAYS = 1;
const MAX_AFTER_DAYS = 60;

/**
 * POST /api/gpx/internal/strava-sync - Internal, service-to-service only (v1.7 Phase 31b).
 *
 * Triggered on an EventBridge schedule (via an invoker). Pulls each linked user's
 * in-window Strava activities into their PRIVATE routes. Guarded by
 * `x-internal-secret` — never exposed via CloudFront.
 *
 * Optional JSON body `{ afterDays?: number }` (integer 1-60) overrides the rolling
 * window's look-back; absent/invalid falls back to `runStravaSync`'s default (7).
 */
export async function POST(request: Request) {
  // 2026-07-21 pattern (matches the outbound calls in strava-sync.ts): the Lambda
  // invoker sends the shared secret as `INTERNAL_SYNC_SECRET`, but the deployed
  // tasks only carry `AUTH_INTERNAL_SECRET` — fall back to it so the guard doesn't
  // reject a legitimately-secreted request.
  const secret = process.env.INTERNAL_SYNC_SECRET ?? process.env.AUTH_INTERNAL_SECRET;
  if (!secret || request.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let afterDays: number | undefined;
  try {
    const body = (await request.json()) as { afterDays?: unknown } | null;
    const candidate = body?.afterDays;
    if (
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= MIN_AFTER_DAYS &&
      candidate <= MAX_AFTER_DAYS
    ) {
      afterDays = candidate;
    }
  } catch {
    // Absent/unparseable body — fall back to the default window.
  }

  try {
    const result = await runStravaSync(afterDays);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Strava sync failed:", error);
    return NextResponse.json({ error: "Strava sync failed" }, { status: 500 });
  }
}

// The sync fans out to the Strava API + S3/Dynamo; give it room beyond the default.
export const maxDuration = 300;
