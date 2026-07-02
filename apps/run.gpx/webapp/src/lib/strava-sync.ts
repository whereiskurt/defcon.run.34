import { PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { GpxFile } from "@/entities/gpx-file";
import { s3Client, BUCKET, getUserPrefix } from "@/lib/s3-client";

/**
 * Strava date-banded ingestion worker (v1.7 Phase 31b).
 *
 * Pulls each linked user's in-window activities from Strava and stores them as PRIVATE
 * routes (`source:"strava"`, `publicShareEligible:false`) — deduped by `stravaActivityId`.
 * They become public only via Convert-to-public (Phase 31a). Tokens come from run.auth's
 * internal endpoint (cross-service option 3); the date band + secrets come from env.
 *
 * Invoked only by the secret-guarded internal route, on an EventBridge schedule.
 */

type StravaUserToken = { userId: string; athleteId: string; accessToken: string };
type StravaActivity = {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  distance: number;
  total_elevation_gain: number;
};
type StreamSet = {
  latlng?: { data: [number, number][] };
  altitude?: { data: number[] };
  time?: { data: number[] };
};

function bandBounds(): { after?: number; before?: number } {
  const after = process.env.STRAVA_SYNC_AFTER;
  const before = process.env.STRAVA_SYNC_BEFORE;
  return {
    after: after ? parseInt(after, 10) : undefined,
    before: before ? parseInt(before, 10) : undefined,
  };
}

async function stravaGet<T>(path: string, token: string): Promise<T | null> {
  const res = await fetch(`https://www.strava.com/api/v3${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 429) {
    console.warn("[strava-sync] rate limited; will retry next cycle");
    return null;
  }
  if (!res.ok) {
    console.error(`[strava-sync] GET ${path} -> ${res.status}`);
    return null;
  }
  return (await res.json()) as T;
}

/** Minimal, valid GPX from lat/lng(+ele/time) streams. */
function buildGpx(name: string, latlng: [number, number][], altitude?: number[], time?: number[]): string {
  const pts = latlng
    .map(([lat, lon], i) => {
      const ele = altitude?.[i];
      const t = time?.[i];
      const eleTag = ele !== undefined ? `<ele>${ele}</ele>` : "";
      const timeTag =
        t !== undefined ? `<time>${new Date(t * 1000).toISOString()}</time>` : "";
      return `<trkpt lat="${lat}" lon="${lon}">${eleTag}${timeTag}</trkpt>`;
    })
    .join("");
  const safeName = name.replace(/[<>&]/g, "");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="run.defcon.run" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${safeName}</name><trkseg>${pts}</trkseg></trk></gpx>`;
}

function bounds(latlng: [number, number][]) {
  const lats = latlng.map((p) => p[0]);
  const lons = latlng.map((p) => p[1]);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLon: Math.min(...lons),
    maxLon: Math.max(...lons),
  };
}

async function existingStravaIds(userId: string): Promise<Set<string>> {
  const res = await GpxFile.query.byCreatedAt({ userId }).go({ pages: "all" });
  return new Set(
    res.data
      .map((f) => f.stravaActivityId)
      .filter((id): id is string => typeof id === "string")
  );
}

async function importActivity(
  user: StravaUserToken,
  activity: StravaActivity
): Promise<boolean> {
  const streams = await stravaGet<StreamSet>(
    `/activities/${activity.id}/streams?keys=latlng,altitude,time&key_by_type=true`,
    user.accessToken
  );
  const latlng = streams?.latlng?.data;
  if (!latlng || latlng.length === 0) return false; // no GPS (e.g. treadmill)

  const gpx = buildGpx(activity.name, latlng, streams?.altitude?.data, streams?.time?.data);
  const fileId = uuidv4();
  const key = `${getUserPrefix(user.userId)}${fileId}.gpx`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: gpx,
      ContentType: "application/gpx+xml",
    })
  );

  await GpxFile.create({
    userId: user.userId,
    fileId,
    fileName: `${activity.name}.gpx`,
    bucket: BUCKET,
    key,
    fileSize: Buffer.byteLength(gpx),
    trackCount: 1,
    waypointCount: 0,
    totalDistance: activity.distance,
    totalElevation: activity.total_elevation_gain,
    bounds: bounds(latlng),
    source: "strava",
    publicShareEligible: false, // raw import — must be Converted before public sharing
    stravaActivityId: String(activity.id),
    status: "active",
  }).go();

  return true;
}

async function syncUser(user: StravaUserToken): Promise<number> {
  const { after, before } = bandBounds();
  const seen = await existingStravaIds(user.userId);
  let imported = 0;
  let page = 1;

  // Paginate the date-banded activity list.
  for (; page <= 20; page++) {
    const params = new URLSearchParams({ per_page: "100", page: String(page) });
    if (after) params.set("after", String(after));
    if (before) params.set("before", String(before));
    const activities = await stravaGet<StravaActivity[]>(
      `/athlete/activities?${params.toString()}`,
      user.accessToken
    );
    if (!activities || activities.length === 0) break;

    for (const activity of activities) {
      if (seen.has(String(activity.id))) continue;
      try {
        if (await importActivity(user, activity)) imported++;
      } catch (e) {
        console.error(`[strava-sync] import failed activity ${activity.id}`, e);
      }
    }
  }
  return imported;
}

/** Orchestrator: fetch tokens from run.auth, sync each user within the date band. */
export async function runStravaSync(): Promise<{ users: number; imported: number }> {
  const authUrl = process.env.AUTH_INTERNAL_URL;
  const secret = process.env.INTERNAL_SYNC_SECRET;
  if (!authUrl || !secret) {
    throw new Error("AUTH_INTERNAL_URL and INTERNAL_SYNC_SECRET are required");
  }

  const res = await fetch(`${authUrl}/api/internal/strava-tokens`, {
    headers: { "x-internal-secret": secret },
  });
  if (!res.ok) {
    throw new Error(`token endpoint returned ${res.status}`);
  }
  const { tokens } = (await res.json()) as { tokens: StravaUserToken[] };

  let imported = 0;
  for (const user of tokens) {
    try {
      imported += await syncUser(user);
    } catch (e) {
      console.error(`[strava-sync] user ${user.userId} failed`, e);
    }
  }
  return { users: tokens.length, imported };
}
