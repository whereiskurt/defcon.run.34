import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { buildDc34Heatmap } from "@/lib/heatmap-build";
import { logEvent } from "@/lib/log-event";
import { isGpxAdmin } from "@/lib/gpx-admin";

/**
 * POST /api/gpx/admin/heatmap/rebuild — regenerate the public heat-map artifact
 * on demand. Non-admins get 404 (non-disclosure).
 *
 * Moderation actions (hide / delete) deliberately do NOT rebuild. An admin
 * clearing up ten abusive shapes should pay one rebuild, not ten — the build
 * scans the whole table and fetches every run's geometry from S3, so it is the
 * expensive half of the operation by a wide margin. This is the "done, publish
 * it" button.
 *
 * Same builder the EventBridge schedule calls, so a manual rebuild and a
 * scheduled one cannot diverge.
 */
export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!isGpxAdmin(services)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  try {
    const result = await buildDc34Heatmap();

    logEvent("gpx.heatmap.admin_rebuild", {
      headers: request.headers,
      userId: session.user.id,
      email: session.user.email ?? undefined,
      meta: { runCount: result.runCount, scanned: result.scanned },
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error rebuilding heat map:", error);
    return NextResponse.json({ error: "Rebuild failed" }, { status: 500 });
  }
}
