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
