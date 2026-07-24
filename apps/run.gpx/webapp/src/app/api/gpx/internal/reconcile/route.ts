import { NextResponse } from "next/server";
import { reconcileAccomplishments } from "@/lib/gpx-reconcile";

/**
 * POST /api/gpx/internal/reconcile - Internal, service-to-service only (Task 4,
 * leaderboard<->runs sync milestone).
 *
 * Triggers a full-recalc reconcile of one runner's con-day-tagged run set
 * against run.human's Accomplishment rows. Guarded by `x-internal-secret` —
 * never exposed via CloudFront.
 *
 * 2026-07-21 pattern (matches api/gpx/internal/strava-sync/route.ts): the
 * Lambda invoker sends the shared secret as `INTERNAL_SYNC_SECRET`, but the
 * deployed tasks only carry `AUTH_INTERNAL_SECRET` — fall back to it so the
 * guard doesn't reject a legitimately-secreted request.
 *
 * Body: `{ sub: string }` — the OIDC sub (== GpxFile.userId) to reconcile.
 */
export async function POST(request: Request) {
  const secret = process.env.INTERNAL_SYNC_SECRET ?? process.env.AUTH_INTERNAL_SECRET;
  if (!secret || request.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let sub: unknown;
  try {
    ({ sub } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (typeof sub !== "string" || !sub) {
    return NextResponse.json(
      { error: "Invalid sub", message: "sub must be a non-empty string" },
      { status: 400 }
    );
  }

  try {
    const result = await reconcileAccomplishments(sub);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Reconcile failed:", error);
    return NextResponse.json({ error: "Reconcile failed" }, { status: 500 });
  }
}
