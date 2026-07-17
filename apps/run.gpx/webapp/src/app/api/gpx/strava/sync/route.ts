import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { isConDay, isSelectableConDay } from "@/lib/con-days";
import { countConDayRuns } from "@/lib/con-day-usage";
import { conDayLimit, isConDayCapped } from "@/lib/con-day-quota";
import {
  consumeQuota,
  restoreQuota,
  type QuotaTier,
} from "@/lib/quota-client";
import {
  fetchSingleUserStravaToken,
  syncUserToConDay,
} from "@/lib/strava-sync";
import { logEvent } from "@/lib/log-event";

/**
 * POST /api/gpx/strava/sync (Phase 61) — the per-user "Sync my Strava" button.
 *
 * SESSION-authenticated (NOT the secret/all-users batch path). Imports the CURRENT
 * signed-in runner's recent Strava activities into their folder, tagged to the
 * chosen con-day. Security: it only ever syncs THAT session user — the runner's id
 * comes from the server session, never the request body, so a client can't sync
 * someone else. run.gpx (server) is the only caller of run.auth's secret-guarded
 * single-user token endpoint.
 *
 * Body: { conDay: "YYYY-MM-DD" } — must be a real, non-future con day.
 * Returns: { ok, imported, skipped, conDayRemaining, quotaRemaining, files[] }.
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

  // Only runners who have linked Strava can use this door.
  if (!(session.user as { hasStrava?: boolean }).hasStrava) {
    return NextResponse.json(
      { error: "Strava not linked", message: "Link Strava to sync your runs" },
      { status: 400 }
    );
  }

  // Live lock-out check at the write boundary (same guard as manual upload).
  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  let conDay: unknown;
  try {
    ({ conDay } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Con-day must be a real DEF CON run day and not in the future.
  if (typeof conDay !== "string" || !isConDay(conDay)) {
    return NextResponse.json(
      { error: "Invalid conDay", message: "conDay must be a DEF CON run day" },
      { status: 400 }
    );
  }
  if (!isSelectableConDay(conDay, Date.now())) {
    return NextResponse.json(
      {
        error: "conDay in the future",
        message: "You can't log a run for a day that hasn't happened yet",
      },
      { status: 400 }
    );
  }

  const quotaTier: QuotaTier = services.includes("admin") ? "admin" : "upload";

  // Fast fail if the con-day is already full — don't burn the burst guard.
  const conDayCountBefore = await countConDayRuns(session.user.id, conDay);
  if (isConDayCapped(conDayCountBefore, quotaTier)) {
    return NextResponse.json(
      {
        error: "Con-day limit reached",
        message: `You've logged all ${conDayLimit(quotaTier)} runs for this day`,
        conDay,
        remaining: 0,
        limit: conDayLimit(quotaTier),
      },
      { status: 429 }
    );
  }

  // Burst guard (§8 layer ③): each sync-button press consumes one atomic
  // strava_sync unit (16/user, 100/admin). Blocks a flood of syncs; the con-day
  // cap + dedupe bound how much a single press can import.
  const burst = await consumeQuota(
    session.user.id,
    "strava_sync",
    1,
    quotaTier
  );
  if (!burst.success) {
    return NextResponse.json(
      {
        error: "Strava sync limit reached",
        message: "You've used all your Strava syncs",
        remaining: burst.remaining,
        quotaId: "strava_sync",
      },
      { status: 429 }
    );
  }

  try {
    const token = await fetchSingleUserStravaToken(session.user.id);
    if (!token) {
      // Refund the burst unit — nothing was synced.
      await restoreQuota(session.user.id, "strava_sync", 1);
      return NextResponse.json(
        { error: "No Strava token", message: "Could not reach your Strava link" },
        { status: 409 }
      );
    }

    const result = await syncUserToConDay(token, conDay, quotaTier);

    logEvent("gpx.strava.sync", {
      headers: request.headers,
      userId: session.user.id,
      email: session.user.email ?? undefined,
      meta: { imported: result.imported, skipped: result.skipped, conDay },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("User Strava sync failed:", error);
    // Refund the burst unit on hard failure so a transient error isn't punitive.
    await restoreQuota(session.user.id, "strava_sync", 1);
    return NextResponse.json(
      { error: "Strava sync failed" },
      { status: 500 }
    );
  }
}

// Fans out to the Strava API + S3/Dynamo per activity; give it headroom.
export const maxDuration = 120;
