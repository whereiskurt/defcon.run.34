import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { conLocalDate } from "@/lib/con-days";
import { syncNowRemaining, isSyncNowCapped } from "@/lib/sync-now-limit";
import { GpxSyncNow } from "@/entities/gpx-sync-now";
import {
  fetchSingleUserStravaToken,
  refreshStripCache,
  syncUserUntagged,
} from "@/lib/strava-sync";
import { logEvent } from "@/lib/log-event";

/**
 * POST /api/gpx/strava/sync-now (Task 2, scheduled-Strava-sync milestone).
 *
 * SESSION-authenticated per-user "Sync now" button. Unlike the con-day-tagged
 * "Sync my Strava" button (@/app/api/gpx/strava/sync/route.ts), this imports
 * the runner's last 7 days of activity UNTAGGED — no con-day, no per-con-day
 * budget, no lifetime gpx_upload quota (see syncUserUntagged) — capped instead
 * by a flat SYNC_NOW_PER_DAY (2) counter keyed on the con-local calendar date
 * (GpxSyncNow). Admins bypass the counter entirely.
 *
 * The counter is incremented BEFORE the sync call; a burned slot on a missing
 * token (409) or a failed sync (500) is NOT restored — a fixed 2/day cap
 * accepts an occasional wasted slot in exchange for not needing a restore path.
 *
 * Returns: { ok, imported, skipped, remainingToday }.
 */
export async function POST(request: Request) {
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
      { error: "Strava not linked", message: "Link Strava to sync your runs" },
      { status: 400 }
    );
  }

  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  const userId = session.user.id;
  const isAdmin = services.includes("admin");

  let remainingToday: number;

  if (isAdmin) {
    remainingToday = 99;
  } else {
    const today = conLocalDate(Date.now());
    const row = await GpxSyncNow.get({ userId, date: today }).go();
    const count = row.data?.count ?? 0;

    if (isSyncNowCapped(count)) {
      return NextResponse.json(
        {
          error: "Sync limit reached",
          message:
            "You've used both of today's syncs — the background sync runs at 10 AM and 10 PM anyway",
          remainingToday: 0,
        },
        { status: 429 }
      );
    }

    // Increment BEFORE syncing (see file header: no restore on later failure).
    await GpxSyncNow.upsert({ userId, date: today }).add({ count: 1 }).go();
    remainingToday = syncNowRemaining(count + 1);
  }

  try {
    const token = await fetchSingleUserStravaToken(userId);
    if (!token) {
      return NextResponse.json(
        { error: "No Strava token", message: "Could not reach your Strava link" },
        { status: 409 }
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const result = await syncUserUntagged(token, now - 7 * 24 * 3600);

    // Rewrite the strip cache while we hold the token, so the strip's
    // follow-up list fetch is both fresh AND free (no strava_sync quota).
    // Best-effort: a cache failure must never fail the sync itself.
    try {
      await refreshStripCache(userId, token.accessToken, now, {
        skipEmptyWrite: true,
      });
    } catch (e) {
      console.warn(`[sync-now] strip cache refresh failed for ${userId}`, e);
    }

    logEvent("gpx.strava.syncnow", {
      headers: request.headers,
      userId,
      email: session.user.email ?? undefined,
      meta: { imported: result.imported, skipped: result.skipped },
    });

    return NextResponse.json({
      ok: true,
      imported: result.imported,
      skipped: result.skipped,
      remainingToday,
    });
  } catch (error) {
    console.error("Strava sync-now failed:", error);
    return NextResponse.json({ error: "Strava sync-now failed" }, { status: 500 });
  }
}

// One athlete's untagged 7-day band, same shape as the con-day sync button.
export const maxDuration = 120;
