import { PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { GpxFile } from "@/entities/gpx-file";
import { s3Client, BUCKET, getUserPrefix } from "@/lib/s3-client";
import { logEvent } from "@/lib/log-event";
import {
  consumeQuota,
  restoreQuota,
  type QuotaTier,
} from "@/lib/quota-client";
import { conDayRemaining } from "@/lib/con-day-quota";
import { countConDayRuns } from "@/lib/con-day-usage";

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

export type StravaUserToken = { userId: string; athleteId: string; accessToken: string };
export type StravaActivity = {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  distance: number;
  total_elevation_gain: number;
  /** Local wall-clock start, e.g. "2026-08-07T06:31:00Z" (Strava quirk: Z-suffixed local time). */
  start_date_local: string;
  moving_time: number;
  map?: { summary_polyline?: string | null };
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

/**
 * Strava returns rate-limit headers as a "15min,daily" comma pair (e.g. "123,7890").
 * We track the 15-min window — the first hop — as the numeric quota signal.
 */
function firstHop(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const n = parseInt(headerValue.split(",")[0].trim(), 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Emit the Strava quota telemetry line (AR-08c). The `strava.ratelimit` evt with
 * numeric meta.usage / meta.limit is a LOCKED contract 40-04 binds to `$.meta.usage`
 * for the StravaRateLimitUsage CloudWatch widget — do NOT rename these fields.
 * Fire-and-forget: logEvent never throws, so sync control flow is unaffected.
 */
function emitStravaRateLimit(res: Response): void {
  logEvent("strava.ratelimit", {
    meta: {
      usage: firstHop(res.headers.get("X-RateLimit-Usage")),
      limit: firstHop(res.headers.get("X-RateLimit-Limit")),
    },
  });
}

async function stravaGet<T>(path: string, token: string): Promise<T | null> {
  const res = await fetch(`https://www.strava.com/api/v3${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // Emit rate-limit telemetry for every response (2xx, 429, and other non-ok).
  emitStravaRateLimit(res);
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

export async function getExistingStravaIds(userId: string): Promise<Set<string>> {
  const res = await GpxFile.query.byCreatedAt({ userId }).go({ pages: "all" });
  return new Set(
    res.data
      .map((f) => f.stravaActivityId)
      .filter((id): id is string => typeof id === "string")
  );
}

/** A route created from a Strava activity — what the studio needs to render it. */
export type ImportedFile = { fileId: string; fileName: string };

async function importActivity(
  user: StravaUserToken,
  activity: StravaActivity,
  opts?: { conDay?: string }
): Promise<ImportedFile | null> {
  const streams = await stravaGet<StreamSet>(
    `/activities/${activity.id}/streams?keys=latlng,altitude,time&key_by_type=true`,
    user.accessToken
  );
  const latlng = streams?.latlng?.data;
  if (!latlng || latlng.length === 0) return null; // no GPS (e.g. treadmill)

  const gpx = buildGpx(activity.name, latlng, streams?.altitude?.data, streams?.time?.data);
  const fileId = uuidv4();
  const fileName = `${activity.name}.gpx`;
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
    fileName,
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
    // Con-day tag (Phase 61): the user-facing sync path tags each imported run to
    // the chosen con-day; the batch worker leaves it undefined.
    ...(opts?.conDay ? { conDay: opts.conDay } : {}),
    status: "active",
  }).go();

  return { fileId, fileName };
}

async function syncUser(user: StravaUserToken): Promise<number> {
  const { after, before } = bandBounds();
  const seen = await getExistingStravaIds(user.userId);
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
        if (await importActivity(user, activity)) imported++; // null = no-GPS
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

// ---------------------------------------------------------------------------
// Per-user "Sync my Strava" button (Phase 61)
//
// The batch path above runs all users on a schedule inside a date band. The
// pieces below power the SESSION-authenticated single-user button: fetch just
// this runner's token, import their recent activities tagged to one con-day,
// deduped by stravaActivityId, consuming both the per-con-day budget and the
// lifetime gpx_upload quota. `importActivity`/`getExistingStravaIds`/`stravaGet`/
// `buildGpx` are reused unchanged so the two paths can't diverge.
// ---------------------------------------------------------------------------

/**
 * Fetch a single runner's fresh Strava token from run.auth's internal endpoint.
 * The route only ever passes the SESSION user's own id; the internal secret guard
 * keeps this a server-to-server call. Returns null when the runner has no usable
 * Strava link.
 */
export async function fetchSingleUserStravaToken(
  userId: string
): Promise<StravaUserToken | null> {
  const authUrl = process.env.AUTH_INTERNAL_URL;
  const secret = process.env.INTERNAL_SYNC_SECRET;
  if (!authUrl || !secret) {
    throw new Error("AUTH_INTERNAL_URL and INTERNAL_SYNC_SECRET are required");
  }

  const res = await fetch(
    `${authUrl}/api/internal/strava-tokens?userId=${encodeURIComponent(userId)}`,
    { headers: { "x-internal-secret": secret } }
  );
  if (!res.ok) {
    throw new Error(`token endpoint returned ${res.status}`);
  }
  const { tokens } = (await res.json()) as { tokens: StravaUserToken[] };
  return tokens[0] ?? null;
}

/**
 * Pure: split activities into fresh (not already imported) vs already-seen, keyed
 * on stravaActivityId. Extracted so the dedupe rule — the core correctness guard
 * shared by both doors (a Strava re-sync never double-imports) — is unit-testable
 * without S3/Dynamo. Order is preserved (Strava returns most-recent-first).
 */
export function dedupeActivities<T extends { id: number }>(
  activities: T[],
  seen: Set<string>
): { fresh: T[]; skipped: number } {
  const fresh: T[] = [];
  let skipped = 0;
  for (const a of activities) {
    if (seen.has(String(a.id))) skipped++;
    else fresh.push(a);
  }
  return { fresh, skipped };
}

/** List a runner's most-recent activities (no date band; user-initiated). */
async function listRecentActivities(
  token: string,
  maxPages = 2,
  perPage = 50
): Promise<StravaActivity[]> {
  const all: StravaActivity[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
    });
    const activities = await stravaGet<StravaActivity[]>(
      `/athlete/activities?${params.toString()}`,
      token
    );
    if (!activities || activities.length === 0) break;
    all.push(...activities);
    if (activities.length < perPage) break;
  }
  return all;
}

/**
 * List a runner's activities started after `afterUnixSeconds` (the strip's
 * rolling last-7-days window). Same pagination discipline as
 * listRecentActivities; 3 pages × 50 is far beyond any real 7-day volume.
 */
export async function listActivitiesSince(
  token: string,
  afterUnixSeconds: number,
  maxPages = 3,
  perPage = 50
): Promise<StravaActivity[]> {
  const all: StravaActivity[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
      after: String(afterUnixSeconds),
    });
    const activities = await stravaGet<StravaActivity[]>(
      `/athlete/activities?${params.toString()}`,
      token
    );
    if (!activities || activities.length === 0) break;
    all.push(...activities);
    if (activities.length < perPage) break;
  }
  return all;
}

/** What the strip renders per activity — summary polyline included. */
export type StripActivity = {
  id: number;
  name: string;
  type: string;
  startDateLocal: string;
  distanceMeters: number;
  movingTimeSeconds: number;
  summaryPolyline: string;
  imported: boolean;
};

/** Pure: shape Strava activities for the strip, dropping GPS-less ones. */
export function toStripActivities(
  activities: StravaActivity[],
  imported: Set<string>
): StripActivity[] {
  return activities
    .filter((a) => !!a.map?.summary_polyline)
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      startDateLocal: a.start_date_local,
      distanceMeters: a.distance,
      movingTimeSeconds: a.moving_time,
      summaryPolyline: a.map!.summary_polyline as string,
      imported: imported.has(String(a.id)),
    }));
}

/** Fetch one activity's detail (authoritative metadata for a single import). */
export async function fetchActivityById(
  token: string,
  id: number
): Promise<StravaActivity | null> {
  return stravaGet<StravaActivity>(`/activities/${id}`, token);
}

/** Import exactly one activity tagged to a con-day (the strip's tap-to-import). */
export async function importActivityForConDay(
  user: StravaUserToken,
  activity: StravaActivity,
  conDay: string
): Promise<ImportedFile | null> {
  return importActivity(user, activity, { conDay });
}

export interface UserStravaSyncSummary {
  /** Activities imported as new routes this call. */
  imported: number;
  /** Activities skipped: already in the folder (dedupe) or no GPS stream. */
  skipped: number;
  /** Per-con-day budget left AFTER this call (for the "N of 10" line). */
  conDayRemaining: number;
  /** Lifetime gpx_upload remaining after the last consume (null if none imported). */
  quotaRemaining: number | null;
  /** The created routes, so the studio can render them on the map. */
  files: ImportedFile[];
}

/**
 * Import THIS runner's recent Strava activities into their folder, tagged to
 * `conDay`. Deduped by stravaActivityId; bounded by the remaining per-con-day
 * budget (both doors share the same count, so switching can't bypass the cap);
 * each imported activity also consumes one lifetime `gpx_upload` (the atomic hard
 * ceiling), refunded when an activity turns out to have no GPS. Stops early when
 * either budget is exhausted.
 */
export async function syncUserToConDay(
  user: StravaUserToken,
  conDay: string,
  quotaTier: QuotaTier
): Promise<UserStravaSyncSummary> {
  const seen = await getExistingStravaIds(user.userId);
  const countBefore = await countConDayRuns(user.userId, conDay);
  let budget = conDayRemaining(countBefore, quotaTier);

  const files: ImportedFile[] = [];
  let quotaRemaining: number | null = null;

  const activities = await listRecentActivities(user.accessToken);
  const { fresh, skipped: dedupeSkipped } = dedupeActivities(activities, seen);
  let skipped = dedupeSkipped;

  for (const activity of fresh) {
    if (budget <= 0) break; // per-con-day cap / burst bound

    // Lifetime ceiling: consume the atomic gpx_upload before writing S3/Dynamo.
    const q = await consumeQuota(user.userId, "gpx_upload", 1, quotaTier);
    if (!q.success) break; // hard abuse wall hit — stop importing
    quotaRemaining = q.remaining;

    let created: ImportedFile | null = null;
    try {
      created = await importActivity(user, activity, { conDay });
    } catch (e) {
      console.error(`[strava-sync] import failed activity ${activity.id}`, e);
    }

    if (created) {
      files.push(created);
      budget--;
    } else {
      // No GPS or write error — refund the lifetime unit and count as skipped.
      await restoreQuota(user.userId, "gpx_upload", 1);
      skipped++;
    }
  }

  return {
    imported: files.length,
    skipped,
    conDayRemaining: conDayRemaining(countBefore + files.length, quotaTier),
    quotaRemaining,
    files,
  };
}
