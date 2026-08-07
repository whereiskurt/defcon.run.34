/**
 * Server-side GPX geometry summary for Route templates (routes-vs-runs spec,
 * section 4 confirm step). The client NEVER supplies geometry metadata for a
 * route — it is derived here from the uploaded bytes after validation, using
 * the same parseTrack regex core the accomplishment seam uses.
 */

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, BUCKET } from "./s3-client";
import { parseTrack } from "./gpx-accomplishment";
import { ROUTE_MAX_SIZE } from "./route-caps";

export interface GpxSummary {
  trackCount: number;
  waypointCount: number;
  totalDistance: number;
  totalElevation: number;
  bounds?: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

/** Pure core — summarize a GPX document string. */
export function summarizeGpxText(text: string): GpxSummary {
  // NOTE: /<trk[\s>]/ deliberately excludes <trkpt>/<trkseg>.
  const trackCount = (text.match(/<trk[\s>]/g) ?? []).length;
  const waypointCount = (text.match(/<wpt[\s>]/g) ?? []).length;
  const { points, distance, elevation } = parseTrack(text);

  let bounds: GpxSummary["bounds"];
  if (points.length > 0) {
    let minLat = points[0][0];
    let maxLat = points[0][0];
    let minLon = points[0][1];
    let maxLon = points[0][1];
    for (const [lat, lon] of points) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    bounds = { minLat, maxLat, minLon, maxLon };
  }

  return {
    trackCount,
    waypointCount,
    totalDistance: distance,
    totalElevation: elevation,
    bounds,
  };
}

/**
 * Fetch a route object from S3 (size-capped read) and summarize it.
 * Throws on S3 errors; the confirm handler maps that to a failed validation.
 */
export async function summarizeGpxObject(key: string): Promise<GpxSummary> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      // Belt-and-braces: never read more than the route size cap.
      Range: `bytes=0-${ROUTE_MAX_SIZE - 1}`,
    })
  );
  const text = (await response.Body?.transformToString()) ?? "";
  return summarizeGpxText(text);
}

/**
 * Read cap for summarizing an UPLOADED file (as opposed to a Route template).
 *
 * Sits just above the 20 MB `upload`-tier limit so an ordinary user's file is
 * always summarizable, while still bounding what a single ECS task will pull
 * into a string — the `admin` tier permits 100 MB, and reading that on the
 * one task this service runs is not worth a distance readout.
 */
export const UPLOAD_SUMMARY_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Total object size out of an S3 ranged-GET `Content-Range: bytes 0-N/TOTAL`.
 * Returns null when the header is absent or unparsable (including the `*`
 * unknown-length form), which callers must treat as "size unknown".
 */
export function contentRangeTotal(contentRange?: string): number | null {
  const m = /\/(\d+)\s*$/.exec(contentRange ?? "");
  if (!m) return null;
  const total = Number(m[1]);
  return Number.isFinite(total) ? total : null;
}

/**
 * Summarize an uploaded GPX, or return null when it CANNOT be summarized
 * honestly.
 *
 * WHY NULL RATHER THAN A NUMBER. This reads a byte RANGE. If the object is
 * larger than the range, the tail is missing and `summarizeGpxText` happily
 * returns a distance for the part it saw — a silent under-report that looks
 * exactly like a real measurement. Uploads are allowed up to 20 MB (100 MB for
 * admins), so this is reachable, not theoretical. A missing distance is a
 * visible gap someone can act on; a wrong one is a lie nobody can spot.
 *
 * Null therefore means "leave the stored value alone", and every caller must
 * treat it that way rather than defaulting to 0.
 */
export async function summarizeUploadedGpx(
  key: string,
  maxBytes = UPLOAD_SUMMARY_MAX_BYTES
): Promise<GpxSummary | null> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      // One byte PAST the cap: if the object is exactly `maxBytes` this still
      // reads it whole, and anything larger reports a total we can detect.
      Range: `bytes=0-${maxBytes}`,
    })
  );

  const total = contentRangeTotal(response.ContentRange);
  if (total !== null && total > maxBytes) return null;

  const text = (await response.Body?.transformToString()) ?? "";
  // No Content-Range (some S3-compatible stores omit it) — fall back to the
  // decoded length, which is still a truthful "did we hit the ceiling" check.
  if (total === null && Buffer.byteLength(text) > maxBytes) return null;

  return summarizeGpxText(text);
}
