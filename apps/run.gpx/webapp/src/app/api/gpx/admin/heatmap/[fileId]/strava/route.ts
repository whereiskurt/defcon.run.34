import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { GpxFile } from "@/entities/gpx-file";
import { readStripCache } from "@/lib/strava-sync";
import { isGpxAdmin } from "@/lib/gpx-admin";

interface RouteParams {
  params: Promise<{ fileId: string }>;
}

/**
 * GET /api/gpx/admin/heatmap/[fileId]/strava?userId=… — the raw Strava activity
 * behind a `source:"strava"` run. Non-admins get 404 (non-disclosure).
 *
 * CACHE-ONLY, BY DESIGN. This reads the runner's existing `GpxStravaCache`
 * snapshot and joins on `stravaActivityId`. It never calls Strava: doing so
 * would spend the runner's API quota and act with their OAuth token to satisfy
 * an admin's curiosity, which is a materially different thing from reading data
 * we already hold.
 *
 * A MISS IS NOT AN ABSENCE. `trimActivitiesForCache` bounds the snapshot at
 * ~320 KB by dropping the OLDEST activities, so an older run's activity is
 * routinely not in it. The `reason` field exists so the UI can say "not in this
 * runner's cached snapshot" rather than implying the activity never existed —
 * an admin reading the latter as "fabricated run" would be a real harm.
 *
 * `userId` comes from the roster, not the session: GpxFile's pk is
 * (userId, fileId), and an admin inspecting someone else's run must name them.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = (session.user as { services?: string[] }).services ?? [];
  if (!isGpxAdmin(services)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { fileId } = await params;
  const userId = new URL(request.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const file = await GpxFile.get({ userId, fileId }).go();
    if (!file.data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const activityId = file.data.stravaActivityId;
    if (!activityId) {
      return NextResponse.json({ found: false, reason: "not-strava" });
    }

    const cache = await readStripCache(userId);
    if (!cache) {
      return NextResponse.json({ found: false, reason: "no-cache", activityId });
    }

    const activity = cache.activities.find((a) => String(a.id) === activityId);
    if (!activity) {
      return NextResponse.json({
        found: false,
        reason: "not-in-snapshot",
        activityId,
        fetchedAt: cache.fetchedAt,
        snapshotSize: cache.activities.length,
      });
    }

    return NextResponse.json({
      found: true,
      activityId,
      fetchedAt: cache.fetchedAt,
      activity,
    });
  } catch (error) {
    console.error("Error reading Strava payload for admin:", error);
    return NextResponse.json({ error: "Failed to load payload" }, { status: 500 });
  }
}
