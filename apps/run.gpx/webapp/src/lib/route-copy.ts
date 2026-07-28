/**
 * Pure builder for the GpxFile row a route copy creates ("Add to My Maps",
 * routes-vs-runs spec section 4). Kept entity-free so the double-scoring
 * guarantee is test-locked: the payload NEVER carries conDay or
 * stravaActivityId, so a copied route can never satisfy the leaderboard's
 * scored-run predicate nor collide with Strava idempotency.
 */

import type { RouteItem } from "@/entities/route";

export interface RouteCopyPayload {
  userId: string;
  fileId: string;
  fileName: string;
  bucket: string;
  key: string;
  fileSize: number;
  trackCount?: number;
  waypointCount?: number;
  totalDistance?: number;
  totalElevation?: number;
  // Same optional-prop shape ElectroDB map attributes produce.
  bounds?: {
    minLat?: number;
    maxLat?: number;
    minLon?: number;
    maxLon?: number;
  };
  folderId: string;
  source: "converted";
  status: "active";
}

export function buildRouteCopyPayload(
  route: Pick<
    RouteItem,
    | "name"
    | "fileSize"
    | "trackCount"
    | "waypointCount"
    | "totalDistance"
    | "totalElevation"
    | "bounds"
  >,
  callerUserId: string,
  newFileId: string,
  bucket: string,
  key: string
): RouteCopyPayload {
  const fileName = route.name.toLowerCase().endsWith(".gpx")
    ? route.name
    : `${route.name}.gpx`;
  return {
    userId: callerUserId,
    fileId: newFileId,
    fileName,
    bucket,
    key,
    fileSize: route.fileSize,
    trackCount: route.trackCount,
    waypointCount: route.waypointCount,
    totalDistance: route.totalDistance,
    totalElevation: route.totalElevation,
    bounds: route.bounds,
    folderId: "ROOT",
    source: "converted",
    status: "active",
  };
}
