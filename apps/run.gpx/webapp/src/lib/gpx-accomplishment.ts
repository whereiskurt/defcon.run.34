/**
 * GPX -> leaderboard accomplishment seam (LDBR-05, producer side).
 *
 * Pure, unit-testable helpers plus a best-effort POST to run.human's internal
 * accomplishment endpoint. The confirm route (Plan 50-02) calls these AFTER a
 * GPX file flips to "active" for an individually-owned (non-GLOBAL) file:
 *   parseTrack(body) -> buildAccomplishmentPayload(...) -> notifyAccomplishment(...)
 *
 * Design notes:
 *  - The decimated polyline is computed in-memory here and persisted only on
 *    run.human's Accomplishment.metadata.polyline — there is NO GpxFile schema
 *    change (CONTEXT YAGNI decision).
 *  - `notifyAccomplishment` swallows EVERY error: a leaderboard miss must never
 *    break a GPX save (T-50-06, best-effort). The base URL is derived from fixed
 *    env only (no user input -> no SSRF, T-50-09) and the secret is sent as a
 *    header, never logged (T-50-08).
 *
 * The haversine + `<trkpt lat lon><ele>` regex are ported from
 * scripts/seed-local-routes.ts `stats()`.
 */

export interface AccomplishmentPayload {
  oidcSub: string;
  gpxFileId: string;
  name: string;
  distance: number;
  elevation: number;
  polyline: { lat: number; lng: number }[];
  completedAt: number;
  /**
   * Con-day tag (Phase 58): ISO date (YYYY-MM-DD) of the DEF CON run day this
   * route was logged for. Present only when the GpxFile carries one; run.human
   * keys flags off it. Omitted (not null) when absent so the contract stays lean.
   */
  conDay?: string;
  /**
   * Provenance of the run (leaderboard<->runs reconcile, Task 4). Omitted (not
   * a default) when absent so run.human's own server-fix default ("gpx") still
   * applies to the plain confirm-route path.
   */
  source?: "gpx" | "strava";
  /** Strava activity id, present only when `source === "strava"`. */
  stravaActivityId?: string;
}

const EARTH_RADIUS_M = 6371000;

/** Great-circle distance (meters) between two [lat, lon] points. */
function haversine(a: [number, number], b: [number, number]): number {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Parse a GPX string into ordered [lat, lon] track points plus total distance
 * (summed haversine, meters) and positive elevation gain (meters). Both totals
 * are rounded, matching seed-local-routes.ts `stats()`.
 */
export function parseTrack(gpx: string): {
  points: [number, number][];
  distance: number;
  elevation: number;
} {
  const re =
    /<trkpt[^>]*\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)"[^>]*>(?:[\s\S]*?<ele>([-\d.]+)<\/ele>)?/g;
  const points: [number, number][] = [];
  const eles: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(gpx)) !== null) {
    points.push([parseFloat(m[1]), parseFloat(m[2])]);
    if (m[3] !== undefined) eles.push(parseFloat(m[3]));
  }
  let distance = 0;
  let elevation = 0;
  for (let i = 1; i < points.length; i++) {
    distance += haversine(points[i - 1], points[i]);
  }
  for (let i = 1; i < eles.length; i++) {
    const d = eles[i] - eles[i - 1];
    if (d > 0) elevation += d;
  }
  return {
    points,
    distance: Math.round(distance),
    elevation: Math.round(elevation),
  };
}

/**
 * Even-stride downsample of [lat,lon] track points to at most `max` entries,
 * emitting `{lat, lng}` OBJECTS (the shape Accomplishment.metadata.polyline and
 * Phase 52's PolylineRenderer consume — NOT [lat,lng] tuples).
 *
 * For `points.length <= max` every point is returned. Otherwise an even stride
 * across the index range is taken that ALWAYS includes the first and last point
 * (Douglas-Peucker is overkill per CONTEXT discretion).
 */
export function decimatePolyline(
  points: [number, number][],
  max = 100
): { lat: number; lng: number }[] {
  const toObj = (p: [number, number]) => ({ lat: p[0], lng: p[1] });
  if (points.length <= max) return points.map(toObj);
  if (max <= 1) return points.length ? [toObj(points[0])] : [];
  const out: { lat: number; lng: number }[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(toObj(points[Math.round(i * step)]));
  }
  return out;
}

/**
 * Assemble the exact run.human `/api/internal/accomplishment` contract object.
 * `source` is intentionally absent — the endpoint SERVER-FIXES `source:"gpx"`.
 */
export function buildAccomplishmentPayload(args: {
  oidcSub: string;
  gpxFileId: string;
  name: string;
  points: [number, number][];
  distance: number;
  elevation: number;
  completedAt: number;
  conDay?: string;
  max?: number;
  source?: "gpx" | "strava";
  stravaActivityId?: string;
}): AccomplishmentPayload {
  return {
    oidcSub: args.oidcSub,
    gpxFileId: args.gpxFileId,
    name: args.name,
    distance: args.distance,
    elevation: args.elevation,
    polyline: decimatePolyline(args.points, args.max ?? 100),
    completedAt: args.completedAt,
    // Only include conDay when tagged — keeps the wire contract lean and lets
    // run.human distinguish "untagged" from any sentinel.
    ...(args.conDay ? { conDay: args.conDay } : {}),
    // source/stravaActivityId (Task 4, leaderboard<->runs reconcile): threaded
    // verbatim, same lean-contract style as conDay — omitted (not defaulted)
    // when absent so the plain confirm-route caller keeps relying on
    // run.human's own server-fix default of "gpx".
    ...(args.source ? { source: args.source } : {}),
    ...(args.stravaActivityId ? { stravaActivityId: args.stravaActivityId } : {}),
  };
}

/**
 * Derive run.human's internal base URL from FIXED env (never request input) —
 * mirrors social-qr.ts / public/checkins. Read at call time so env overrides
 * apply. In production run.human mounts at basePath `/{region}`; the
 * RUN_HUMAN_INTERNAL_URL the ECS task provides already includes it.
 */
function humanBaseUrl(): string {
  const isDev = process.env.NODE_ENV !== "production";
  const region = process.env.REGION_SHORT || "use1";
  const siteDomain = process.env.SITE_DOMAIN || "defcon.run";
  const localPort = process.env.LOCAL_HUMAN_PORT || "3001";
  return (
    process.env.RUN_HUMAN_INTERNAL_URL ||
    (isDev
      ? `http://localhost:${localPort}`
      : `http://run-human.app-${region}-${siteDomain.replace(
          /\./g,
          "-"
        )}.local:3000/${region}`)
  );
}

/**
 * Public seam for any other run.gpx caller (e.g. gpx-reconcile.ts, Task 4)
 * that needs to hit a different run.human internal path without duplicating
 * `humanBaseUrl`'s env-derivation logic.
 */
export function humanInternalUrl(path: string): string {
  return `${humanBaseUrl()}${path}`;
}

/**
 * Best-effort POST of an accomplishment to run.human's secret-gated internal
 * endpoint. Swallows EVERY error (network reject, non-2xx, anything) and always
 * resolves — a leaderboard miss must never break a GPX save (T-50-06). The
 * secret is sent as a header only, never logged (T-50-08).
 *
 * `fetchImpl` defaults to the global `fetch` (resolved at call time so tests can
 * stub it via `vi.stubGlobal`).
 */
export async function notifyAccomplishment(
  payload: AccomplishmentPayload,
  fetchImpl?: typeof fetch
): Promise<void> {
  try {
    const doFetch = fetchImpl ?? fetch;
    const url = humanInternalUrl("/api/internal/accomplishment");
    await doFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": process.env.AUTH_INTERNAL_SECRET || "",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Best-effort: a leaderboard miss must never break a GPX save.
  }
}
