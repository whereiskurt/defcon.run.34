/**
 * Deep links into the DEF CON 34 map on gpx.defcon.run (the gpx-studio app).
 *
 * Two hard constraints, both of which fail *silently* if you get them wrong —
 * the button still opens a map, it just opens the wrong one:
 *
 * 1. REGION BASE PATH. The gpx app is mounted under /{region} in production
 *    (apps/run.gpx/webapp/next.config.ts `basePath`). The BARE origin serves a
 *    static interstitial whose whole job is `location.replace('/use1/')` — an
 *    absolute path with neither the query string nor the hash, so both are
 *    dropped in transit. Never link the bare origin with a deep link on it.
 *
 * 2. TERMINAL PATH. /{region} and /{region}/gpx are server-side `redirect()`s
 *    that also drop the query string; /{region}/studio/app is the map itself.
 *    Link straight there — the same form CheckInHistory already uses for its
 *    per-check-in map links.
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const REGION_SHORT = process.env.NEXT_PUBLIC_REGION_SHORT || 'use1';

/** The map itself. Dev gpx runs without a basePath on :3003. */
export const GPX_MAP_URL = IS_PRODUCTION
  ? `https://gpx.defcon.run/${REGION_SHORT}/studio/app`
  : 'http://localhost:3003/studio/app';

/** Street level — the zoom CheckInHistory already pins its map links at. */
export const GPX_MAP_DEFAULT_ZOOM = 16;

export type GpxMapCamera = { lat: number; lon: number; zoom?: number };

/**
 * `?layers=routes` shows exactly the official `DEF CON 34 Maps` routes and
 * forces everything else (notably Rabbit Routes) off. An optional camera adds
 * the mapbox-gl `#zoom/lat/lon` hash. Query first, hash last.
 */
export function gpxMapUrl(camera?: GpxMapCamera): string {
  const url = `${GPX_MAP_URL}?layers=routes`;
  if (!camera) return url;
  const { lat, lon, zoom = GPX_MAP_DEFAULT_ZOOM } = camera;
  return `${url}#${zoom}/${lat}/${lon}`;
}
