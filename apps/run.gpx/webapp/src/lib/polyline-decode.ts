/**
 * DC33 `summary_polyline` decoder (Phase 71, HEAT-03).
 *
 * The DC33 DynamoDB export stores a run's geometry on
 * `Accomplishment.metadata.summary_polyline` in one of TWO historical
 * encodings: a Google encoded polyline (Strava imports) or a JSON coordinate
 * array (manual uploads). `~/working/defcon.run.33/.../api/heatmap/route.ts`
 * handles both by trying `JSON.parse` first and falling back to the encoded
 * decoder; this module ports that behaviour and normalises the result to
 * GeoJSON `[lon, lat]` order so it can feed `normalizeTrack` directly.
 *
 * NO DEPENDENCY WAS ADDED. DC33 used the Mapbox `polyline` npm package; here
 * the ~25-line algorithm is ported instead. run.gpx/webapp has 13 runtime deps
 * the only consumer of this decoder is one frozen, one-off backfill against an
 * export taken in August 2025 — a permanent supply-chain surface for that is a
 * bad trade (threat T-71-SC).
 *
 * DEPENDENCY-FREE BY DESIGN: this module imports nothing, so `scripts/` and
 * vitest can use it without the ElectroDB/S3 environment chain.
 *
 * In THIS repo `summary_polyline` is only ever stored and passed through as an
 * opaque string (`lib/strava-sync.ts`), which is why no decoder existed to reuse.
 */

/**
 * Hard input bound (DoS, threat T-71-01). A corrupt or hostile export row
 * cannot drive unbounded decoding work: anything longer is rejected before a
 * single character is examined. 200 000 characters is ~100 000 encoded points,
 * roughly two orders of magnitude beyond any real Strava summary polyline.
 */
export const MAX_POLYLINE_CHARS = 200000;

/** Lowest and highest character codes the encoded-polyline alphabet uses. */
const MIN_CHAR = 63;
const MAX_CHAR = 126;

function isFinitePair(lon: unknown, lat: unknown): boolean {
  return (
    typeof lon === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lon) &&
    Number.isFinite(lat)
  );
}

/**
 * Read a JSON-parsed value as a coordinate list.
 *
 * Two element shapes are accepted, matching the DC33 manual-upload data:
 * a two-number array read as `[lat, lon]`, or an object carrying a numeric
 * `lat` plus a numeric `lng` or `lon`. Unrecognised elements are skipped.
 *
 * The parsed value is only ever ITERATED as an array and read by FIXED key —
 * never used as a lookup map and never spread into an accumulator — so a
 * `__proto__` or `constructor` key smuggled through the JSON is inert
 * (threat T-71-02).
 */
function fromJsonArray(parsed: unknown): [number, number][] {
  if (!Array.isArray(parsed)) return [];
  const out: [number, number][] = [];
  for (const entry of parsed) {
    if (Array.isArray(entry)) {
      const lat = entry[0];
      const lon = entry[1];
      if (isFinitePair(lon, lat)) out.push([lon as number, lat as number]);
      continue;
    }
    if (typeof entry === "object" && entry !== null) {
      const rec = entry as { lat?: unknown; lng?: unknown; lon?: unknown };
      const lat = rec.lat;
      const lon = rec.lng !== undefined ? rec.lng : rec.lon;
      if (isFinitePair(lon, lat)) out.push([lon as number, lat as number]);
    }
  }
  return out;
}

/**
 * Google encoded-polyline algorithm at precision 5, ported from the reference
 * implementation: 5-bit chunks, `0x20` continuation bit, `~(result >> 1)` for
 * the negative case, running lat/lng deltas divided by 1e5.
 *
 * Returns `null` — not a partial result — for anything structurally invalid: a
 * character outside the alphabet, a chunk whose continuation bit runs off the
 * end of the string, or a latitude with no matching longitude. Bailing rather
 * than salvaging is what keeps arbitrary garbage (`"null"`, punctuation) from
 * decoding into plausible-looking coordinates.
 */
function fromEncoded(str: string): [number, number][] | null {
  const out: [number, number][] = [];
  const len = str.length;
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    const deltas: number[] = [];
    for (let part = 0; part < 2; part++) {
      let shift = 0;
      let result = 0;
      let byte = 0;
      do {
        if (index >= len) return null; // truncated chunk
        const code = str.charCodeAt(index++);
        if (code < MIN_CHAR || code > MAX_CHAR) return null; // outside alphabet
        byte = code - MIN_CHAR;
        result |= (byte & 0x1f) << shift;
        shift += 5;
        if (shift > 30) return null; // chunk wider than a coordinate delta
      } while (byte >= 0x20);
      deltas.push(result & 1 ? ~(result >> 1) : result >> 1);
    }
    lat += deltas[0];
    lng += deltas[1];
    const outLat = lat / 1e5;
    const outLng = lng / 1e5;
    if (!Number.isFinite(outLat) || !Number.isFinite(outLng)) continue;
    out.push([outLng, outLat]);
  }

  return out;
}

/**
 * The single entry point for turning a stored DC33 `summary_polyline` into
 * geometry.
 *
 * Contract: NEVER throws. Always returns GeoJSON `[lon, lat]` order. Returns
 * `[]` for anything it cannot understand — an unreadable row is one missing
 * run, never a failed backfill.
 */
export function decodeTrack(raw: unknown): [number, number][] {
  if (typeof raw !== "string") return [];
  if (raw.length > MAX_POLYLINE_CHARS) return [];
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];

  if (trimmed.startsWith("[")) {
    try {
      return fromJsonArray(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }

  return fromEncoded(trimmed) ?? [];
}
