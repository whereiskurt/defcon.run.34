import { NextRequest, NextResponse } from "next/server";
import { getRecentCheckIns } from "@/entities/checkin";
import { getRunUser } from "@/entities/run-user";

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
 * Response: { checkIns: [{ lat, lon, displayName, timestamp, checkInType,
 * pinIcon?, pinColor? }] }
 */

const CACHE_SECONDS = 120;
// Rolling mode (no `since`): most-recent window.
const MAX_PUBLIC = 200;
const MAX_SCANNED = 1000;
// Windowed mode (`since=`): sized for a full event's worth of rows.
const MAX_PUBLIC_WINDOWED = 2000;
const MAX_SCANNED_WINDOWED = 5000;
const PAGE_SIZE = 100;
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

    const visible = publicCheckIns.slice(0, maxPublic);

    // Batch-join display names (unique users only; a failed lookup just
    // falls back to the anonymous label rather than dropping the point).
    const userIds = [...new Set(visible.map((c) => c.userId))];
    const users = new Map<
      string,
      { displayName?: string; userType?: string }
    >();
    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const user = await getRunUser(userId);
          // userType (mqttUsertype: rabbit/admin/wildhare/og) lets the map
          // filter/highlight check-ins by user type (Kurt 2026-07-11).
          users.set(userId, {
            displayName: user?.displayName,
            userType: user?.mqttUsertype,
          });
        } catch {
          // leave unset — falls back below
        }
      })
    );

    const checkIns = visible.map((c) => ({
      lat: c.averageCoordinates.latitude,
      lon: c.averageCoordinates.longitude,
      displayName: users.get(c.userId)?.displayName || "a rabbit",
      userType: users.get(c.userId)?.userType,
      timestamp: c.timestamp,
      checkInType: c.checkInType,
      pinIcon: c.pinIcon,
      pinColor: c.pinColor,
    }));

    return NextResponse.json(
      { checkIns },
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
