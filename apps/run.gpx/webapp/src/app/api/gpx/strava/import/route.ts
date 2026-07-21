import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { assertNotLockedLive } from "@/lib/live-lockout";
import { isConDay, isValidDateString } from "@/lib/con-days";
import { countConDayRuns } from "@/lib/con-day-usage";
import { conDayLimit, conDayRemaining, isConDayCapped } from "@/lib/con-day-quota";
import {
  consumeQuota,
  restoreQuota,
  type QuotaTier,
} from "@/lib/quota-client";
import {
  fetchSingleUserStravaToken,
  fetchActivityById,
  importActivityForConDay,
  getExistingStravaIds,
} from "@/lib/strava-sync";
import { logEvent } from "@/lib/log-event";

/**
 * POST /api/gpx/strava/import — tap-to-import one Strava activity (strip spec
 * 2026-07-21). Body: { activityId: number, conDay: "YYYY-MM-DD" }.
 *
 * Unlike /strava/sync (all fresh activities), this imports EXACTLY ONE chosen
 * activity. Con-day rule: any of the six CON_DAYS is accepted at any time (the
 * no-future isSelectableConDay gate is deliberately NOT applied — decision
 * 2026-07-21); admins may use any valid date. Costs one lifetime gpx_upload
 * (refunded on failure); bounded by the shared per-con-day cap.
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
      { error: "Strava not linked", message: "Link Strava to import your runs" },
      { status: 400 }
    );
  }

  if (await assertNotLockedLive(session.user.id)) {
    return NextResponse.json({ error: "Account locked out" }, { status: 403 });
  }

  let activityId: unknown;
  let conDay: unknown;
  try {
    ({ activityId, conDay } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (typeof activityId !== "number" || !Number.isInteger(activityId) || activityId <= 0) {
    return NextResponse.json(
      { error: "Invalid activityId", message: "activityId must be a positive integer" },
      { status: 400 }
    );
  }

  const isAdmin = services.includes("admin");
  if (typeof conDay !== "string") {
    return NextResponse.json(
      { error: "Invalid conDay", message: "conDay must be a date string" },
      { status: 400 }
    );
  }
  if (isAdmin ? !isValidDateString(conDay) : !isConDay(conDay)) {
    return NextResponse.json(
      { error: "Invalid conDay", message: "conDay must be a DEF CON run day" },
      { status: 400 }
    );
  }

  const quotaTier: QuotaTier = isAdmin ? "admin" : "upload";

  try {
    // Dedupe before any quota spend: re-importing is a no-op, not a 500.
    const imported = await getExistingStravaIds(session.user.id);
    if (imported.has(String(activityId))) {
      return NextResponse.json(
        { error: "Already imported", message: "This activity is already in your maps" },
        { status: 409 }
      );
    }

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

    // Lifetime ceiling — the atomic hard wall, consumed before S3/Dynamo writes.
    const q = await consumeQuota(session.user.id, "gpx_upload", 1, quotaTier);
    if (!q.success) {
      return NextResponse.json(
        {
          error: "Quota exceeded",
          message: "You have reached your upload limit",
          remaining: q.remaining,
          quotaId: "gpx_upload",
        },
        { status: 429 }
      );
    }

    try {
      const token = await fetchSingleUserStravaToken(session.user.id);
      if (!token) {
        await restoreQuota(session.user.id, "gpx_upload", 1);
        return NextResponse.json(
          { error: "No Strava token", message: "Could not reach your Strava link" },
          { status: 409 }
        );
      }

      const activity = await fetchActivityById(token.accessToken, activityId);
      if (!activity) {
        await restoreQuota(session.user.id, "gpx_upload", 1);
        return NextResponse.json(
          { error: "Activity not found", message: "Strava did not return this activity" },
          { status: 404 }
        );
      }

      const file = await importActivityForConDay(token, activity, conDay);
      if (!file) {
        // No GPS streams (e.g. treadmill) — refund the lifetime unit.
        await restoreQuota(session.user.id, "gpx_upload", 1);
        return NextResponse.json(
          { error: "No GPS", message: "This activity has no GPS track to import" },
          { status: 422 }
        );
      }

      logEvent("gpx.strava.import", {
        headers: request.headers,
        userId: session.user.id,
        email: session.user.email ?? undefined,
        meta: { fileId: file.fileId, activityId, conDay },
      });

      return NextResponse.json({
        ok: true,
        file,
        conDayRemaining: conDayRemaining(conDayCountBefore + 1, quotaTier),
        quotaRemaining: q.remaining,
      });
    } catch (inner) {
      await restoreQuota(session.user.id, "gpx_upload", 1);
      throw inner;
    }
  } catch (error) {
    console.error("Strava single import failed:", error);
    return NextResponse.json({ error: "Strava import failed" }, { status: 500 });
  }
}

// Streams fetch + S3 + Dynamo for one activity.
export const maxDuration = 60;
