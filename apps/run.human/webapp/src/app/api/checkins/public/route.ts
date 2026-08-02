import { NextRequest, NextResponse } from "next/server";
import * as crypto from "crypto";
import { getRecentCheckIns } from "@/entities/checkin";
import { RunUser } from "@/entities/run-user";
import { getClusterConfig } from "@/lib/cluster-config-store";

/**
 * GET /api/checkins/public - Public, UNAUTHENTICATED list of recent check-ins
 * that users explicitly made public (`isPrivate === false`).
 *
 * Feeds the "User Check-ins" overlay on the public GPX map (v1.8 Phase 3).
 * Privacy surface: check-ins default to private on creation (`isPrivate ?? true`),
 * so everything returned here is opt-out by the user. Kurt OK'd exposing
 * displayName + coordinates for public check-ins (2026-07-03).
 *
 * `?since=<epoch-ms>` (v1.8 Phase 4) switches from the rolling-recent window
 * to a time-window query (the byGlobalRecent sort key is the timestamp), with
 * higher caps sized for the whole event (~4k check-ins over the con).
 *
 * Response: { checkIns: [{ lat, lon, rid, displayName, timestamp, checkInType,
 * pinIcon?, pinColor? }], clusterConfig, truncated }
 *
 * `rid` is an OPAQUE, stable per-runner grouping key (a truncated hash of the
 * userId). The map needs to know which check-ins belong to the same runner in
 * order to cluster them — counting distinct RUNNERS, not distinct pins. It
 * cannot use `displayName` for that, because every runner without a custom name
 * falls back to the same "a rabbit" literal and would collapse into one person.
 * `rid` discloses nothing `displayName` does not already: it is not reversible
 * and is only a grouping token.
 *
 * `clusterConfig` rides along so the map clusters with the SAME knobs the
 * scoreboard uses — retuning the radius in /admin/clusters moves the map too,
 * with no second copy of the numbers to drift.
 */

const CACHE_SECONDS = 120;
// Rolling mode (no `since`): most-recent window.
const MAX_PUBLIC = 200;
const MAX_SCANNED = 1000;
// Windowed mode (`since=`): sized for a full event's worth of rows. The scan
// bound exists to cap worst-case cost, but it used to silently drop the OLDEST
// data (the feed pages newest-first), so by the end of a busy con the first
// day's check-ins would quietly vanish from the map. Raised well past a
// realistic event, and any early stop is now REPORTED via `truncated` rather
// than looking like a complete answer.
const MAX_PUBLIC_WINDOWED = 5000;
const MAX_SCANNED_WINDOWED = 20000;
const PAGE_SIZE = 100;
/** DynamoDB BatchGetItem hard limit. */
const BATCH_GET_SIZE = 100;

/** Opaque, stable per-runner grouping key. Not reversible; not an identifier. */
function runnerKey(userId: string): string {
  return crypto.createHash("sha256").update(userId).digest("hex").slice(0, 12);
}
// Reject windows older than ~60 days — bounds worst-case scan depth.
const MAX_WINDOW_MS = 60 * 24 * 3600_000;

export async function GET(req: NextRequest) {
  try {
    const sinceParam = req.nextUrl.searchParams.get("since");
    let since: number | undefined;
    if (sinceParam) {
      const parsed = Number(sinceParam);
      if (Number.isFinite(parsed) && parsed > Date.now() - MAX_WINDOW_MS) {
        since = parsed;
      }
    }
    const maxPublic = since ? MAX_PUBLIC_WINDOWED : MAX_PUBLIC;
    const maxScanned = since ? MAX_SCANNED_WINDOWED : MAX_SCANNED;

    const publicCheckIns = [];
    let cursor: string | undefined;
    let scanned = 0;
    do {
      const page = await getRecentCheckIns(PAGE_SIZE, cursor, since);
      scanned += page.data.length;
      for (const c of page.data) {
        if (c.isPrivate === false) publicCheckIns.push(c);
      }
      cursor = page.cursor ?? undefined;
    } while (cursor && publicCheckIns.length < maxPublic && scanned < maxScanned);

    // Stopped early = there is more data we did not return. Say so rather than
    // presenting a truncated list as the whole picture.
    const truncated = Boolean(cursor) && publicCheckIns.length >= maxPublic;
    const visible = publicCheckIns.slice(0, maxPublic);

    // Join display names with BATCH gets. This used to be one DynamoDB get per
    // distinct user issued concurrently — at event scale (hundreds of runners)
    // that was hundreds of simultaneous round-trips on every cold cache miss.
    // A failed lookup still just falls back to the anonymous label rather than
    // dropping the point.
    const userIds = [...new Set(visible.map((c) => c.userId))];
    const users = new Map<
      string,
      { displayName?: string; userType?: string }
    >();
    for (let i = 0; i < userIds.length; i += BATCH_GET_SIZE) {
      const chunk = userIds.slice(i, i + BATCH_GET_SIZE);
      try {
        const batch = await RunUser.get(chunk.map((userId) => ({ userId }))).go();
        for (const user of batch.data) {
          if (!user?.userId) continue;
          // userType (mqttUsertype: rabbit/admin/wildhare/og) lets the map
          // filter/highlight check-ins by user type (Kurt 2026-07-11).
          users.set(user.userId, {
            displayName: user.displayName,
            userType: user.mqttUsertype,
          });
        }
      } catch {
        // leave the chunk unset — those points fall back to the label below
      }
    }

    const checkIns = visible.map((c) => ({
      lat: c.averageCoordinates.latitude,
      lon: c.averageCoordinates.longitude,
      // Opaque grouping key so the map can count distinct RUNNERS. Never the
      // raw userId — see the header note.
      rid: runnerKey(c.userId),
      displayName: users.get(c.userId)?.displayName || "a rabbit",
      userType: users.get(c.userId)?.userType,
      timestamp: c.timestamp,
      checkInType: c.checkInType,
      pinIcon: c.pinIcon,
      pinColor: c.pinColor,
    }));

    // The live scoring knobs, so the map's clusters match the scoreboard's
    // shape. Only the geometry knobs — point tiers are deliberately NOT sent:
    // the map clusters PUBLIC check-ins only, so its counts are a subset of the
    // scoring cluster's and an award value shown against them would be wrong.
    const cfg = await getClusterConfig();

    return NextResponse.json(
      {
        checkIns,
        truncated,
        clusterConfig: {
          enabled: cfg.enabled,
          radiusMeters: cfg.radiusMeters,
          windowMinutes: cfg.windowMinutes,
          minRunners: cfg.minRunners,
        },
      },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`,
        },
      }
    );
  } catch (error) {
    console.error("Error listing public check-ins:", error);
    return NextResponse.json(
      { error: "Failed to list public check-ins" },
      { status: 500 }
    );
  }
}
