import { NextResponse } from "next/server";
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
 * Response: { checkIns: [{ lat, lon, displayName, timestamp, checkInType }] }
 */

const CACHE_SECONDS = 120;
// Cap on points returned to the map.
const MAX_PUBLIC = 200;
// Cap on rows paged through the byGlobalRecent GSI while hunting for public
// ones — most check-ins are private, so bound the scan rather than the walk.
const MAX_SCANNED = 1000;
const PAGE_SIZE = 100;

export async function GET() {
  try {
    const publicCheckIns = [];
    let cursor: string | undefined;
    let scanned = 0;
    do {
      const page = await getRecentCheckIns(PAGE_SIZE, cursor);
      scanned += page.data.length;
      for (const c of page.data) {
        if (c.isPrivate === false) publicCheckIns.push(c);
      }
      cursor = page.cursor ?? undefined;
    } while (cursor && publicCheckIns.length < MAX_PUBLIC && scanned < MAX_SCANNED);

    const visible = publicCheckIns.slice(0, MAX_PUBLIC);

    // Batch-join display names (unique users only; a failed lookup just
    // falls back to the anonymous label rather than dropping the point).
    const userIds = [...new Set(visible.map((c) => c.userId))];
    const names = new Map<string, string | undefined>();
    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const user = await getRunUser(userId);
          names.set(userId, user?.displayName);
        } catch {
          // leave unset — falls back below
        }
      })
    );

    const checkIns = visible.map((c) => ({
      lat: c.averageCoordinates.latitude,
      lon: c.averageCoordinates.longitude,
      displayName: names.get(c.userId) || "a rabbit",
      timestamp: c.timestamp,
      checkInType: c.checkInType,
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
