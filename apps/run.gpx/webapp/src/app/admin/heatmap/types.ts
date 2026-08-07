import type { RunShape } from "@/lib/heatmap-shape";

/** One row of the moderation roster, as `GET /api/gpx/admin/heatmap` returns it. */
export type HeatmapRun = {
  fileId: string;
  userId: string;
  fileName: string;
  conDay?: string;
  totalDistance?: number;
  trackCount?: number;
  source?: string;
  stravaActivityId?: string;
  createdAt: number;
  hidden: boolean;
  /**
   * Resolved from run.human's least-privilege `?summary=1` lookup, which
   * returns a display name and nothing else — see lib/owner-directory.ts.
   * Absent when the runner has no run.human identity or the lookup failed.
   */
  owner?: { displayName?: string };
};

/** Keyed by fileId, from `GET /api/gpx/admin/heatmap/shapes`. */
export type ShapeMap = Record<string, RunShape>;

/** `GET /api/gpx/admin/heatmap/[fileId]/strava` — cache-only, so a miss is normal. */
export type StravaPayload =
  | { found: true; activityId: string; fetchedAt: number; activity: unknown }
  | {
      found: false;
      reason: "not-strava" | "no-cache" | "not-in-snapshot";
      activityId?: string;
      fetchedAt?: number;
      snapshotSize?: number;
    };

/**
 * Provenance colours. Scanning 300 rows for an anomaly is what colour is for —
 * the same reasoning behind `SVC_COLOR` in run.human's AdminConsole.
 */
export const SOURCE_COLOR: Record<string, string> = {
  strava: "#fc4c02",
  upload: "#0369a1",
  draw: "#7c3aed",
  converted: "#0a7a5c",
};
