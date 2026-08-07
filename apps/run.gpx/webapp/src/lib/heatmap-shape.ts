/**
 * Run-shape rendering + suspicion heuristics for the heat-map moderation page.
 *
 * WHY THIS EXISTS. `/admin/heatmap` is the only join between a shape drawn on
 * the public map and the run that drew it — the published artifact is
 * deliberately non-attributable (see `assertNonAttributable`). But the roster
 * listed runs as TEXT, and the abuse case the page exists for (a track drawn to
 * spell something) is a SHAPE. This module turns a run's real geometry into
 * something an admin can see at a glance, sitting next to the Delete button.
 *
 * PURE BY CONSTRUCTION. No AWS, no React, no I/O, no env — coordinates in,
 * render-ready description out. That is what makes the heuristics below
 * testable against a control case, which matters more than usual here: a
 * heuristic that fires on every ordinary run is worse than no heuristic, because
 * it trains the admin to ignore the column.
 *
 * A SIGNAL IS A PROMPT TO LOOK, NEVER AN ACTION. Nothing here auto-hides,
 * auto-deletes, or feeds `lib/heatmap-build.ts`. The artifact builder does not
 * import this file and must not start.
 */

/** Coordinates are `[lon, lat]`, matching `trkptCoords()` in heatmap-artifact.ts. */
type Coord = [number, number];

export type ShapeSignal =
  | "no-gps"
  | "drawn-in-place"
  | "teleport"
  | "off-site"
  | "fast";

export type RunShape = {
  /** SVG path data in `viewBox` units. Empty string for a trackless run. */
  path: string;
  /** Aspect-preserving, e.g. "0 0 100 62". */
  viewBox: string;
  /** ORIGINAL trackpoint count — the decimated path is not the run. */
  points: number;
  /** Bounding-box diagonal in metres. */
  spanMeters: number;
  signals: ShapeSignal[];
};

/**
 * Thumbnail vertex cap. Deliberately far below `MAX_TRACK_POINTS` (300) in
 * heatmap-artifact.ts: that value governs what the PUBLIC map draws at full
 * zoom, this one governs a ~64 px cell where anything past ~120 points is
 * sub-pixel detail paid for in payload bytes across 300 rows.
 */
export const MAX_SHAPE_POINTS = 120;

/** The long edge of the normalized viewBox. The short edge scales to fit. */
const VIEW_LONG_EDGE = 100;

/**
 * The con footprint, generously drawn — LVCC, the Strip, and the surrounding
 * hotels, with room to spare. Its only job is to catch a run that plainly did
 * not happen at DEF CON; it is not a geofence and nothing is enforced on it.
 */
export const VEGAS_BOX = {
  minLat: 35.8,
  maxLat: 36.4,
  minLon: -115.5,
  maxLon: -114.9,
} as const;

/** Points inside a box this small are not a route, they are a drawing. */
const DRAWN_IN_PLACE_SPAN_M = 500;
/** …but only once there are enough of them to rule out a genuinely short walk. */
const DRAWN_IN_PLACE_MIN_POINTS = 150;
/** A single stride this long is stitched or synthesised, not run. */
const TELEPORT_GAP_M = 1000;
/** Faster than a person runs, sustained over a smoothing window. */
const FAST_KMH = 30;
/**
 * Speed is measured over a window rather than point-to-point: consumer GPS
 * routinely produces one absurd sample, and a single spike must not condemn an
 * otherwise ordinary run.
 */
const FAST_WINDOW_POINTS = 10;

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle metres between two `[lon, lat]` points. */
function metersBetween(a: Coord, b: Coord): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Trackpoint timestamps in document order, as epoch ms.
 *
 * A SIBLING of `trkptCoords()`, not a change to it: that function is on the
 * artifact builder's hot path and its behaviour is pinned by the heat-map
 * tests. Unparsable `<time>` values are dropped rather than emitted as NaN, so
 * a partially-timestamped file yields a SHORTER array than its coordinates —
 * which `buildRunShape` treats as "no usable times" rather than silently
 * pairing the wrong time with the wrong point.
 */
export function trkptTimes(gpx: string): number[] {
  const times: number[] = [];
  const re = /<trkpt\b[\s\S]*?<time>([^<]+)<\/time>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(gpx)) !== null) {
    const t = Date.parse(m[1]);
    if (Number.isFinite(t)) times.push(t);
  }
  return times;
}

/**
 * Even-stride decimation that always keeps the first and last point.
 *
 * Endpoint preservation is what makes the thumbnail honest about where the run
 * started and finished — the same reason `normalizeTrack` does it in
 * heatmap-artifact.ts.
 */
function decimate(coords: Coord[], max: number): Coord[] {
  if (coords.length <= max) return coords;
  const stride = Math.ceil(coords.length / max);
  const out: Coord[] = [];
  for (let i = 0; i < coords.length; i += stride) out.push(coords[i]);
  const last = coords[coords.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function bbox(coords: Coord[]) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, maxLon, minLat, maxLat };
}

/**
 * Peak speed in km/h over a `FAST_WINDOW_POINTS` sliding window, or null when
 * the timestamps are unusable. Non-monotonic or zero-duration windows are
 * skipped rather than dividing by zero.
 */
function peakKmh(coords: Coord[], times: number[]): number | null {
  if (times.length !== coords.length || coords.length < 2) return null;
  const w = Math.min(FAST_WINDOW_POINTS, coords.length - 1);
  let peak = 0;
  let measured = false;
  for (let i = w; i < coords.length; i++) {
    const seconds = (times[i] - times[i - w]) / 1000;
    if (!(seconds > 0)) continue;
    let meters = 0;
    for (let j = i - w + 1; j <= i; j++) {
      meters += metersBetween(coords[j - 1], coords[j]);
    }
    measured = true;
    peak = Math.max(peak, (meters / seconds) * 3.6);
  }
  return measured ? peak : null;
}

/**
 * Turn a run's coordinates into a thumbnail path plus the signals worth an
 * admin's attention.
 *
 * `times` is best-effort: pass `trkptTimes(gpx)` when available. A length
 * mismatch against `coords` disables the speed signal instead of guessing at an
 * alignment — see `trkptTimes`.
 */
export function buildRunShape(coords: Coord[], times?: number[]): RunShape {
  if (coords.length === 0) {
    return {
      path: "",
      viewBox: `0 0 ${VIEW_LONG_EDGE} ${VIEW_LONG_EDGE}`,
      points: 0,
      spanMeters: 0,
      signals: ["no-gps"],
    };
  }

  const { minLon, maxLon, minLat, maxLat } = bbox(coords);
  const spanMeters = metersBetween([minLon, minLat], [maxLon, maxLat]);

  // Degrees of longitude shrink with latitude, so a raw lon/lat box would
  // stretch every Vegas run ~20% wide. Correct before deriving the aspect.
  const midLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
  const spanX = (maxLon - minLon) * Math.cos(midLatRad);
  const spanY = maxLat - minLat;
  const longest = Math.max(spanX, spanY);

  let viewW = VIEW_LONG_EDGE;
  let viewH = VIEW_LONG_EDGE;
  if (longest > 0) {
    viewW = spanX >= spanY ? VIEW_LONG_EDGE : (spanX / spanY) * VIEW_LONG_EDGE;
    viewH = spanY >= spanX ? VIEW_LONG_EDGE : (spanY / spanX) * VIEW_LONG_EDGE;
  }
  // A run that never moved has no extent to normalize against; centre it and
  // let the single point render as a dot rather than dividing by zero.
  const scale = longest > 0 ? VIEW_LONG_EDGE / longest : 0;

  const project = ([lon, lat]: Coord): [number, number] => {
    if (scale === 0) return [viewW / 2, viewH / 2];
    const x = (lon - minLon) * Math.cos(midLatRad) * scale;
    // SVG y grows downward; latitude grows upward. Flip so north is up.
    const y = viewH - (lat - minLat) * scale;
    return [x, y];
  };

  const path = decimate(coords, MAX_SHAPE_POINTS)
    .map((c, i) => {
      const [x, y] = project(c);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join("");

  const signals: ShapeSignal[] = [];

  if (coords.length >= DRAWN_IN_PLACE_MIN_POINTS && spanMeters < DRAWN_IN_PLACE_SPAN_M) {
    signals.push("drawn-in-place");
  }

  for (let i = 1; i < coords.length; i++) {
    if (metersBetween(coords[i - 1], coords[i]) > TELEPORT_GAP_M) {
      signals.push("teleport");
      break;
    }
  }

  const outside = coords.some(
    ([lon, lat]) =>
      lat < VEGAS_BOX.minLat ||
      lat > VEGAS_BOX.maxLat ||
      lon < VEGAS_BOX.minLon ||
      lon > VEGAS_BOX.maxLon
  );
  if (outside) signals.push("off-site");

  if (times && times.length > 0) {
    const kmh = peakKmh(coords, times);
    if (kmh !== null && kmh > FAST_KMH) signals.push("fast");
  }

  return {
    path,
    viewBox: `0 0 ${viewW.toFixed(2)} ${viewH.toFixed(2)}`,
    points: coords.length,
    spanMeters: Math.round(spanMeters),
    signals,
  };
}

/** Human-facing label + colour for a signal chip. Colour is for SCANNING 300 rows. */
export const SIGNAL_META: Record<
  ShapeSignal,
  { label: string; color: string; title: string }
> = {
  "no-gps": {
    label: "no gps",
    color: "#6b7280",
    title: "No trackpoints — a distance-only import (treadmill). Nothing to draw.",
  },
  "drawn-in-place": {
    label: "drawn in place",
    color: "#b00020",
    title:
      "Many points inside a very small area — the signature of a track drawn rather than run.",
  },
  teleport: {
    label: "teleport",
    color: "#b06a00",
    title: "A jump over 1 km between consecutive points — stitched or synthesised.",
  },
  "off-site": {
    label: "off-site",
    color: "#7c3aed",
    title: "Part of this track is outside the Las Vegas area.",
  },
  fast: {
    label: "fast",
    color: "#0369a1",
    title: "Sustained speed above 30 km/h — vehicle pace, not a run.",
  },
};
