import { PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { GpxFile } from "@/entities/gpx-file";
import { GpxStravaCache } from "@/entities/gpx-strava-cache";
import { s3Client, BUCKET, getUserPrefix } from "@/lib/s3-client";
import { logEvent } from "@/lib/log-event";
import {
  consumeQuota,
  restoreQuota,
  type QuotaTier,
} from "@/lib/quota-client";
import { conDayRemaining } from "@/lib/con-day-quota";
import { countConDayRuns } from "@/lib/con-day-usage";
import { reconcileBestEffort } from "@/lib/gpx-reconcile";

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

/**
 * Date band for the batch sync. `STRAVA_SYNC_AFTER`/`BEFORE` env overrides still
 * win when set (ops override for a manual backfill/replay); when NEITHER is set,
 * this is a rolling window of the last `afterDaysDefault` days ending now — so the
 * scheduled sync always covers "since last run" instead of the fixed epoch it used
 * to fall back to (2026-07-21).
 */
function bandBounds(afterDaysDefault = 7): { after?: number; before?: number } {
  const after = process.env.STRAVA_SYNC_AFTER;
  const before = process.env.STRAVA_SYNC_BEFORE;
  if (!after && !before) {
    return { after: Math.floor(Date.now() / 1000) - afterDaysDefault * 86400 };
  }
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

/**
 * Index of this user's imported Strava activities, keyed by stravaActivityId,
 * carrying the fileId + conDay (undefined when untagged) so callers that need
 * more than "was this imported" (the strip, Task 3) can join without a second
 * query. Non-failed files only — a "failed" upload never counts as imported.
 */
export async function getStravaFileIndex(
  userId: string
): Promise<Map<string, { fileId: string; conDay?: string }>> {
  const res = await GpxFile.query.byCreatedAt({ userId }).go({ pages: "all" });
  const index = new Map<string, { fileId: string; conDay?: string }>();
  for (const f of res.data) {
    if (typeof f.stravaActivityId !== "string") continue;
    if (f.status === "failed") continue;
    index.set(f.stravaActivityId, {
      fileId: f.fileId,
      ...(f.conDay ? { conDay: f.conDay } : {}),
    });
  }
  return index;
}

/** Dedupe-only view over `getStravaFileIndex` — same single query, no behavior change. */
export async function getExistingStravaIds(userId: string): Promise<Set<string>> {
  const index = await getStravaFileIndex(userId);
  return new Set(index.keys());
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

async function syncUser(user: StravaUserToken, afterDays?: number): Promise<number> {
  const { after, before } = bandBounds(afterDays);
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

/**
 * Orchestrator: fetch tokens from run.auth, sync each user within the date band.
 * `afterDays` (optional) overrides the rolling window's look-back in days — plumbed
 * from the internal route's request body; absent/undefined falls back to
 * `bandBounds`'s own default (7).
 */
export async function runStravaSync(
  afterDays?: number
): Promise<{ users: number; imported: number }> {
  const authUrl = process.env.AUTH_INTERNAL_URL;
  // The deployed tasks carry the shared AUTH_INTERNAL_SECRET (same secret the
  // quota/profile internal endpoints use); INTERNAL_SYNC_SECRET remains as an
  // override for the batch scheduler if it is ever provisioned separately.
  const secret = process.env.INTERNAL_SYNC_SECRET ?? process.env.AUTH_INTERNAL_SECRET;
  if (!authUrl || !secret) {
    throw new Error(
      "AUTH_INTERNAL_URL and INTERNAL_SYNC_SECRET (or AUTH_INTERNAL_SECRET) are required"
    );
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
      const userImported = await syncUser(user, afterDays);
      imported += userImported;
    } catch (e) {
      console.error(`[strava-sync] user ${user.userId} failed`, e);
    } finally {
      // Task 4 (leaderboard<->runs reconcile): the twice-daily scheduled sync
      // is the SELF-HEAL channel — fire once per processed linked user
      // regardless of import count (unconditionally, even on zero imports or
      // a thrown sync) so a runner whose earlier best-effort reconcile got
      // dropped (T-50-06 fire-and-forget) still heals here. Placed in
      // `finally` so a throwing `syncUser` doesn't skip it.
      reconcileBestEffort(user.userId);
    }
    // Refresh this runner's strip cache while we hold a fresh token, so strip
    // opens between scheduled ticks are free (no quota, no Strava traffic).
    // Best-effort: a cache failure must never fail the sync run.
    try {
      await refreshStripCache(
        user.userId,
        user.accessToken,
        Math.floor(Date.now() / 1000),
        { skipEmptyWrite: true }
      );
    } catch (e) {
      console.warn(`[strava-sync] strip cache refresh failed for ${user.userId}`, e);
    }
  }
  return { users: tokens.length, imported };
}

/**
 * Hard sanity cap on imports per `syncUserUntagged` call — a runaway Strava
 * history (or a mistakenly wide `afterDays`) can't turn one scheduled tick into
 * an unbounded S3/Dynamo write burst. Overflow activities are counted as skipped.
 */
const UNTAGGED_IMPORT_CAP = 30;

/**
 * Single-user version of the batch `syncUser`, for the on-demand scheduled-sync
 * function (Task 1): bands one runner's activity list on `afterUnixSeconds`,
 * dedupes via `getExistingStravaIds`, and imports each fresh activity UNTAGGED —
 * `importActivity(user, activity)` with no `opts`, so (unlike `syncUserToConDay`)
 * these imports consume no per-con-day budget and no lifetime `gpx_upload` quota,
 * exactly like the batch path above. Bounded by `UNTAGGED_IMPORT_CAP`.
 */
export async function syncUserUntagged(
  user: StravaUserToken,
  afterUnixSeconds: number
): Promise<{ imported: number; skipped: number }> {
  const seen = await getExistingStravaIds(user.userId);
  let imported = 0;
  let skipped = 0;

  // Banded activity list: per_page 100, capped at 3 pages (far beyond any
  // realistic rolling-window volume for a single runner).
  for (let page = 1; page <= 3; page++) {
    const params = new URLSearchParams({
      per_page: "100",
      page: String(page),
      after: String(afterUnixSeconds),
    });
    const activities = await stravaGet<StravaActivity[]>(
      `/athlete/activities?${params.toString()}`,
      user.accessToken
    );
    if (!activities || activities.length === 0) break;

    for (const activity of activities) {
      if (seen.has(String(activity.id))) {
        skipped++;
        continue;
      }
      if (imported >= UNTAGGED_IMPORT_CAP) {
        skipped++; // over the sanity cap — count as skipped, don't call Strava again
        continue;
      }
      try {
        const created = await importActivity(user, activity);
        if (created) imported++;
        else skipped++; // no GPS
      } catch (e) {
        console.error(`[strava-sync] import failed activity ${activity.id}`, e);
        skipped++;
      }
    }
  }

  return { imported, skipped };
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
  // The deployed tasks carry the shared AUTH_INTERNAL_SECRET (same secret the
  // quota/profile internal endpoints use); INTERNAL_SYNC_SECRET remains as an
  // override for the batch scheduler if it is ever provisioned separately.
  const secret = process.env.INTERNAL_SYNC_SECRET ?? process.env.AUTH_INTERNAL_SECRET;
  if (!authUrl || !secret) {
    throw new Error(
      "AUTH_INTERNAL_URL and INTERNAL_SYNC_SECRET (or AUTH_INTERNAL_SECRET) are required"
    );
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
  perPage = 50,
  beforeUnixSeconds?: number
): Promise<StravaActivity[]> {
  const all: StravaActivity[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
      after: String(afterUnixSeconds),
    });
    if (beforeUnixSeconds !== undefined) {
      params.set("before", String(beforeUnixSeconds));
    }
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
 * Week-by-week backfill for the strip (Kurt 2026-07-21): start with the last
 * 7 days; while the ribbon holds fewer than `minCount` GPS-having activities,
 * extend the look-back one WHOLE week at a time — the week that crosses the
 * threshold is always included in full ("3 in week one + 7 in week two →
 * show all 10"). Bounds: each week is exactly one banded Strava call (after +
 * before, no overlap, one page), capped at `maxWeeks`, so the worst case is
 * maxWeeks requests for a runner with an empty recent history. All knobs are
 * SERVER-side constants — the client cannot influence the window.
 */
export const STRIP_MIN_ACTIVITIES = 4;
export const STRIP_MAX_LOOKBACK_WEEKS = 8;
const WEEK_SECONDS = 7 * 24 * 3600;

export async function listStripActivitiesBackfill(
  token: string,
  nowUnixSeconds: number,
  minCount = STRIP_MIN_ACTIVITIES,
  maxWeeks = STRIP_MAX_LOOKBACK_WEEKS
): Promise<{ activities: StravaActivity[]; weeks: number }> {
  const all: StravaActivity[] = [];
  let withGps = 0;
  let weeks = 0;
  for (let w = 1; w <= maxWeeks; w++) {
    const after = nowUnixSeconds - w * WEEK_SECONDS;
    const before = nowUnixSeconds - (w - 1) * WEEK_SECONDS;
    // One page of 50 per week-band is far beyond any real weekly volume, and
    // keeps the per-week cost to a single Strava request.
    const batch = await listActivitiesSince(token, after, 1, 50, before);
    all.push(...batch);
    withGps += batch.filter((a) => !!a.map?.summary_polyline).length;
    weeks = w;
    if (withGps >= minCount) break;
  }
  return { activities: all, weeks };
}

// ---------------------------------------------------------------------------
// Strip cache (2026-07-21 caching rework)
//
// The strip list is served from a per-user DDB snapshot of the RAW Strava
// activity list, so ordinary strip opens cost no Strava traffic and no
// strava_sync quota. Only these paths hit Strava and (re)write the cache:
// the first-ever load (no cache yet), the explicit Refresh button
// (?refresh=1), Sync-now, and the twice-daily scheduled sync. Imported/tagged
// flags are NEVER cached — every read re-joins getStravaFileIndex live.
// ---------------------------------------------------------------------------

export type StripCache = {
  activities: StravaActivity[];
  weeks: number;
  fetchedAt: number;
};

/** Stay well under DynamoDB's 400KB item cap (row overhead + key inflation). */
export const STRIP_CACHE_MAX_BYTES = 320_000;

/**
 * Pure: bound the cached payload. Activities arrive newest-first (recent week
 * bands first, Strava newest-first within a band), so dropping from the END
 * discards the oldest ones. Never returns an empty list for a non-empty input.
 */
export function trimActivitiesForCache(
  activities: StravaActivity[],
  maxBytes = STRIP_CACHE_MAX_BYTES
): StravaActivity[] {
  let kept = activities;
  while (kept.length > 1 && Buffer.byteLength(JSON.stringify(kept)) > maxBytes) {
    kept = kept.slice(0, Math.max(1, Math.floor(kept.length / 2)));
  }
  return kept;
}

/** Read the user's cached raw activity list; null when absent or unparsable. */
export async function readStripCache(userId: string): Promise<StripCache | null> {
  const res = await GpxStravaCache.get({ userId }).go();
  if (!res.data) return null;
  try {
    const activities = JSON.parse(res.data.activities) as StravaActivity[];
    if (!Array.isArray(activities)) return null;
    return { activities, weeks: res.data.weeks, fetchedAt: res.data.fetchedAt };
  } catch {
    return null; // corrupt row — treat as no cache; next real fetch overwrites it
  }
}

export async function writeStripCache(
  userId: string,
  activities: StravaActivity[],
  weeks: number
): Promise<void> {
  await GpxStravaCache.upsert({
    userId,
    activities: JSON.stringify(trimActivitiesForCache(activities)),
    weeks,
    fetchedAt: Date.now(),
  }).go();
}

/**
 * Fetch a fresh backfill list from Strava and write-through the cache.
 * `skipEmptyWrite` is set by the BACKGROUND callers (scheduled sync, Sync-now):
 * stravaGet swallows a 429 as an empty page, so an empty result there may just
 * be rate limiting — never let it clobber a good snapshot. The user-facing
 * route path writes even an empty result (an explicit fetch that truly found
 * nothing is an authoritative answer, and Refresh always bypasses the cache).
 */
export async function refreshStripCache(
  userId: string,
  token: string,
  nowUnixSeconds: number,
  opts?: { skipEmptyWrite?: boolean }
): Promise<{ activities: StravaActivity[]; weeks: number }> {
  const result = await listStripActivitiesBackfill(token, nowUnixSeconds);
  if (result.activities.length === 0 && opts?.skipEmptyWrite) return result;
  await writeStripCache(userId, result.activities, result.weeks);
  return result;
}

/**
 * What the strip renders per activity — summary polyline included. For an
 * imported activity, `fileId` identifies the route and `conDay` distinguishes
 * "tagged to a con day" (string) from "imported but untagged" (null) — the
 * client uses that split to offer tag-a-day only on untagged imports.
 * Unimported activities carry neither field.
 */
export type StripActivity = {
  id: number;
  name: string;
  type: string;
  startDateLocal: string;
  distanceMeters: number;
  movingTimeSeconds: number;
  summaryPolyline: string;
  imported: boolean;
  fileId?: string;
  conDay?: string | null;
};

/** Pure: shape Strava activities for the strip, dropping GPS-less ones. */
export function toStripActivities(
  activities: StravaActivity[],
  index: Map<string, { fileId: string; conDay?: string }>
): StripActivity[] {
  return activities
    .filter((a) => !!a.map?.summary_polyline)
    .map((a) => {
      const entry = index.get(String(a.id));
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        startDateLocal: a.start_date_local,
        distanceMeters: a.distance,
        movingTimeSeconds: a.moving_time,
        summaryPolyline: a.map!.summary_polyline as string,
        imported: index.has(String(a.id)),
        ...(entry ? { fileId: entry.fileId, conDay: entry.conDay ?? null } : {}),
      };
    });
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
