import { POINTS } from "./leaderboard-scoring";
import type { CreateAccomplishmentInput } from "../entities/accomplishment";

/**
 * PURE gpx -> accomplishment payload seam (LDBR-06).
 *
 * Mirrors entities/checkin.ts's buildCheckinAccomplishmentInput: maps a GPX
 * activation payload to the exact `createAccomplishment` input WITHOUT any I/O
 * or env, so it is unit-testable without S3/DynamoDB. Fixes `source:"gpx"`,
 * `type:"activity"`, and `points: POINTS.gpx`; threads polyline/distance/
 * elevation through only when present; and throws on a malformed payload (a bad
 * body is a caller error, not a silent zero-score).
 *
 * LDBR-12: `source` is SERVER-FIXED here — the caller's body cannot inject
 * `ctf`/`qr` (nor could the Accomplishment enum hold them). This is the
 * type-level half of the CTF write boundary.
 */

/** Loosely-typed inbound body — the route parses arbitrary JSON, so every
 *  field is validated at runtime rather than trusted from the type. */
export interface GpxAccomplishmentBody {
  gpxFileId?: unknown;
  name?: unknown;
  distance?: unknown;
  elevation?: unknown;
  polyline?: unknown;
  completedAt?: unknown;
  source?: unknown;
  stravaActivityId?: unknown;
  conDay?: unknown;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Keep only well-formed {lat,lng} numeric points; undefined if none. */
function normalizePolyline(
  raw: unknown
): { lat: number; lng: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const pts: { lat: number; lng: number }[] = [];
  for (const p of raw) {
    if (
      p &&
      typeof p === "object" &&
      isFiniteNumber((p as { lat?: unknown }).lat) &&
      isFiniteNumber((p as { lng?: unknown }).lng)
    ) {
      pts.push({
        lat: (p as { lat: number }).lat,
        lng: (p as { lng: number }).lng,
      });
    }
  }
  return pts.length ? pts : undefined;
}

export function buildGpxAccomplishmentInput(
  body: GpxAccomplishmentBody,
  userId: string
): CreateAccomplishmentInput {
  if (!userId || typeof userId !== "string") {
    throw new Error("buildGpxAccomplishmentInput: missing userId");
  }
  const gpxFileId =
    typeof body.gpxFileId === "string" ? body.gpxFileId.trim() : "";
  if (!gpxFileId) {
    throw new Error("buildGpxAccomplishmentInput: missing gpxFileId");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    throw new Error("buildGpxAccomplishmentInput: missing name");
  }
  if (!isFiniteNumber(body.completedAt)) {
    throw new Error(
      "buildGpxAccomplishmentInput: missing/invalid completedAt"
    );
  }

  // Determine source: strava if explicitly requested with stravaActivityId, otherwise gpx (LDBR-12).
  const source = body.source === "strava" ? "strava" : "gpx";

  // When source is strava, require a non-empty stravaActivityId.
  let stravaActivityId: string | undefined;
  if (source === "strava") {
    stravaActivityId =
      typeof body.stravaActivityId === "string"
        ? body.stravaActivityId.trim()
        : "";
    if (!stravaActivityId) {
      throw new Error("buildGpxAccomplishmentInput: missing stravaActivityId");
    }
  }

  const input: CreateAccomplishmentInput = {
    userId,
    source,
    type: "activity",
    name,
    completedAt: body.completedAt,
    points: POINTS[source],
    gpxFileId,
  };

  if (stravaActivityId) input.stravaActivityId = stravaActivityId;
  if (isFiniteNumber(body.distance)) input.distance = body.distance;
  if (isFiniteNumber(body.elevation)) input.elevation = body.elevation;
  const polyline = normalizePolyline(body.polyline);
  if (polyline) input.polyline = polyline;

  return input;
}
