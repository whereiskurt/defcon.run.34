import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { assertNotLockedLive } from "@/lib/live-lockout";
import {
  consumeQuota,
  restoreQuota,
  type QuotaTier,
} from "@/lib/quota-client";
import {
  fetchSingleUserStravaToken,
  listStripActivitiesBackfill,
  toStripActivities,
  getExistingStravaIds,
} from "@/lib/strava-sync";
import { logEvent } from "@/lib/log-event";

/**
 * GET /api/gpx/strava/activities — the Strava strip's list call (2026-07-21 spec).
 *
 * SESSION-authenticated. Returns the signed-in runner's recent Strava
 * activities (anything with GPS) with an `imported` flag per activity so the
 * strip can dim already-imported cards. The window starts at the last 7 days
 * and backfills whole weeks server-side until the ribbon has enough activities
 * (see listStripActivitiesBackfill — the client cannot influence the window).
 * Costs one strava_sync burst unit per refresh (same wall the bulk sync uses)
 * since it hits the Strava API.
 */
export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!services.includes("gpxstudio")) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  if (!(session.user as { hasStrava?: boolean }).hasStrava) {
    return NextResponse.json(
      { error: "Strava not linked", message: "Link Strava to see your runs" },
      { status: 400 }
    );
  }

  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  const quotaTier: QuotaTier = services.includes("admin") ? "admin" : "upload";

  const burst = await consumeQuota(session.user.id, "strava_sync", 1, quotaTier);
  if (!burst.success) {
    return NextResponse.json(
      {
        error: "Strava sync limit reached",
        message: "You've used all your Strava refreshes",
        remaining: burst.remaining,
        quotaId: "strava_sync",
      },
      { status: 429 }
    );
  }

  try {
    const token = await fetchSingleUserStravaToken(session.user.id);
    if (!token) {
      await restoreQuota(session.user.id, "strava_sync", 1);
      return NextResponse.json(
        { error: "No Strava token", message: "Could not reach your Strava link" },
        { status: 409 }
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const [{ activities, weeks }, imported] = await Promise.all([
      listStripActivitiesBackfill(token.accessToken, now),
      getExistingStravaIds(session.user.id),
    ]);

    const strip = toStripActivities(activities, imported);

    logEvent("gpx.strava.list", {
      headers: request.headers,
      userId: session.user.id,
      email: session.user.email ?? undefined,
      meta: { count: strip.length, weeks },
    });

    return NextResponse.json({ ok: true, activities: strip, weeks });
  } catch (error) {
    console.error("Strava activities list failed:", error);
    await restoreQuota(session.user.id, "strava_sync", 1);
    return NextResponse.json({ error: "Strava list failed" }, { status: 500 });
  }
}

// One athlete/activities page fan-out; modest headroom.
export const maxDuration = 60;
