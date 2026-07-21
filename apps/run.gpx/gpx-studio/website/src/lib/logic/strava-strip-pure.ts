/**
 * Pure helpers for the Strava strip (2026-07-21 spec). NO imports — this module
 * is shared source: the Svelte studio consumes it directly, and the webapp
 * vitest suite unit-tests it via a relative path (the studio has no test
 * harness). Keep it dependency-free.
 */

/** Decode a Google encoded polyline (Strava `map.summary_polyline`) → [lat, lng][]. */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    for (const which of [0, 1] as const) {
      let result = 0;
      let shift = 0;
      let b: number;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/**
 * Fit a [lat, lng] track into a width×height viewBox (padding `pad`) as an SVG
 * path. Lat is inverted (SVG y grows down; north stays up). Aspect ratio is
 * preserved and the track centered on the shorter axis.
 */
export function polylineToSvgPath(
  points: [number, number][],
  width: number,
  height: number,
  pad = 4
): string {
  if (points.length < 2) return "";
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [la, ln] of points) {
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (ln < minLng) minLng = ln;
    if (ln > maxLng) maxLng = ln;
  }
  const spanLat = maxLat - minLat || 1e-9;
  const spanLng = maxLng - minLng || 1e-9;
  const innerW = width - 2 * pad;
  const innerH = height - 2 * pad;
  const scale = Math.min(innerW / spanLng, innerH / spanLat);
  const offX = pad + (innerW - spanLng * scale) / 2;
  const offY = pad + (innerH - spanLat * scale) / 2;
  const coords = points.map(([la, ln]) => {
    const x = offX + (ln - minLng) * scale;
    const y = offY + (maxLat - la) * scale;
    return `${round2(x)},${round2(y)}`;
  });
  return `M${coords[0]} L${coords.slice(1).join(" ")}`;
}

function round2(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Best-guess con day for an activity: its local calendar date when that IS a
 * con day, else the nearest con day (ties → earlier). `startDateLocal` is
 * Strava's Z-suffixed LOCAL wall-clock time, so the date part is already the
 * athlete's local day — slice, don't timezone-shift.
 */
export function guessConDay(
  startDateLocal: string,
  dayDates: string[]
): string | null {
  const date = (startDateLocal || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || dayDates.length === 0) return null;
  if (dayDates.includes(date)) return date;
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const d of [...dayDates].sort()) {
    const dist = Math.abs(Date.parse(`${d}T00:00:00Z`) - t);
    if (dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
}

/** "5.4 km" / "850 m" for card metadata. */
export function formatKm(meters: number): string {
  return meters >= 1000
    ? `${(Math.round(meters / 100) / 10).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}

/**
 * The admin con-day tier reports `remaining` as `Number.MAX_SAFE_INTEGER`
 * (see webapp con-day-quota.ts `conDayLimit("admin")`), which renders as
 * "9007199254940991 of 9007199254940991 left" — meaningless to a human.
 * Anything past this threshold is "no real cap" rather than an actual count
 * a runner could hit, so callers should show "Unlimited" instead of the
 * raw numbers.
 */
export const UNLIMITED_QUOTA_THRESHOLD = 100_000;

/** True when a con-day's quota is the "no real cap" admin tier rather than a real limit. */
export function isUnlimitedQuota(remaining: number, count = 0): boolean {
  return remaining > UNLIMITED_QUOTA_THRESHOLD || count + remaining > UNLIMITED_QUOTA_THRESHOLD;
}
