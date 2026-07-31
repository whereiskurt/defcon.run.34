/**
 * Heat-map artifact contract (Phase 71, HEAT-01).
 *
 * The single settled shape every heat-map code path codes against: the year
 * allowlist, the S3 key, the bounded geometry helpers, the artifact assembler,
 * and `assertNonAttributable` — the phase's one non-attributability chokepoint.
 *
 * DEPENDENCY-FREE BY DESIGN. This module imports NOTHING, so the scheduled
 * builder, the public serve route, the one-off `scripts/` backfill and vitest
 * can all use it without dragging in the ElectroDB entity config or the S3
 * client's environment chain. Keep it that way.
 *
 * S3 KEY CONSTRAINT — the artifact key MUST live under `uploads/`.
 * `infra/terraform/live/site/services/run.gpx/service.hcl` sets
 * `full_bucket_access = false`, and every PutObject/GetObject statement in
 * `infra/terraform/modules/s3-uploads/v1.0.0/iam.tf` is scoped to
 * `${bucket}/uploads/*`. The webapp's `s3Client` authenticates as exactly that
 * IAM user, so a top-level key such as `heatmap/dc34.json` would AccessDeny at
 * runtime. `uploads/HEATMAP/{year}.json` follows the existing reserved-sentinel
 * convention (`uploads/ROUTES/{routeId}.gpx` in `lib/s3-client.ts`, and
 * `GLOBAL` as a reserved userId). The gpx bucket has no ObjectCreated
 * notification wired, so writing under `uploads/` triggers no processor.
 */

/** The two con years that have a heat-map artifact. */
export type HeatmapYear = "dc33" | "dc34";

export const HEATMAP_YEARS: readonly HeatmapYear[] = ["dc33", "dc34"] as const;

/**
 * Allowlist membership check — a plain lookup, no regex and no normalisation,
 * so nothing outside the two literals can ever reach a key or a fetch. This is
 * what the public `/api/gpx/public/heatmap/[year]` route validates its dynamic
 * segment against.
 */
export function isHeatmapYear(v: unknown): v is HeatmapYear {
  return (
    typeof v === "string" && (HEATMAP_YEARS as readonly string[]).includes(v)
  );
}

/**
 * S3 key for a year's precomputed artifact.
 *
 * The `uploads/` prefix is MANDATORY, not cosmetic: the run.gpx S3 IAM user is
 * prefix-scoped to `${bucket}/uploads/*` in
 * `infra/terraform/modules/s3-uploads/v1.0.0/iam.tf`. Anything above that
 * prefix AccessDenies at runtime. `HEATMAP` is a reserved sentinel segment in
 * the same spirit as `ROUTES` and `GLOBAL` — no userId ever collides with it.
 */
export function heatmapArtifactKey(year: HeatmapYear): string {
  return `uploads/HEATMAP/${year}.json`;
}

/**
 * Response-size bounds for an UNAUTHENTICATED, CDN-cached public route.
 *
 * `MAX_TRACK_POINTS` decimates any one run's geometry; `MAX_RUNS` bounds how
 * many runs land in a single artifact; `COORD_PRECISION` of 5 decimal places is
 * ~1.1 m — far finer than a 3 px, 25 %-opacity stacked line can express, and
 * the point at which further precision only inflates bytes.
 */
export const MAX_TRACK_POINTS = 300;
export const MAX_RUNS = 5000;
export const COORD_PRECISION = 5;

export interface HeatmapMeta {
  year: HeatmapYear;
  /** ISO-8601 instant the artifact's source data was read. */
  generatedAt: string;
  runCount: number;
  totalKm: number;
}

export interface HeatmapFeature {
  type: "Feature";
  /** Deliberately empty — see `assertNonAttributable`. */
  properties: Record<string, never>;
  geometry: { type: "LineString"; coordinates: [number, number][] };
}

/**
 * `meta` is EMBEDDED rather than served as a sidecar: one object means one
 * atomic write, one fetch, and no way for the stamp to skew against the
 * geometry it describes. GeoJSON permits foreign members on a
 * FeatureCollection and Mapbox ignores them.
 */
export interface HeatmapArtifact {
  type: "FeatureCollection";
  meta: HeatmapMeta;
  features: HeatmapFeature[];
}

// Minimal GPX → coordinates: pull every <trkpt lat=".." lon=".."> as [lon, lat].
export function trkptCoords(gpx: string): [number, number][] {
  const coords: [number, number][] = [];
  const re = /<trkpt[^>]*\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(gpx)) !== null) {
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) coords.push([lon, lat]);
  }
  return coords;
}

const COORD_FACTOR = 10 ** COORD_PRECISION;

function roundCoord(n: number): number {
  return Math.round(n * COORD_FACTOR) / COORD_FACTOR;
}

/**
 * Clean and bound one run's geometry for publication.
 *
 * Filters to finite, in-range `[lon, lat]` pairs, rounds each component to
 * `COORD_PRECISION` decimals, then — if the result still exceeds
 * `MAX_TRACK_POINTS` — takes an even stride across the index range that ALWAYS
 * includes the first and last surviving point. Same arithmetic as
 * `decimatePolyline` in `lib/gpx-accomplishment.ts`, but emitting GeoJSON
 * `[lon, lat]` tuples rather than `{lat, lng}` objects.
 */
export function normalizeTrack(
  coords: [number, number][]
): [number, number][] {
  const clean: [number, number][] = [];
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const lon = c[0];
    const lat = c[1];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < -180 || lon > 180) continue;
    if (lat < -90 || lat > 90) continue;
    clean.push([roundCoord(lon), roundCoord(lat)]);
  }
  if (clean.length <= MAX_TRACK_POINTS) return clean;
  const out: [number, number][] = [];
  const step = (clean.length - 1) / (MAX_TRACK_POINTS - 1);
  for (let i = 0; i < MAX_TRACK_POINTS; i++) {
    out.push(clean[Math.round(i * step)]);
  }
  return out;
}

const EARTH_RADIUS_KM = 6371;

/**
 * Summed great-circle length of a `[lon, lat]` track, in KILOMETRES.
 *
 * `lib/gpx-accomplishment.ts` holds a module-private, metres-based, `[lat, lon]`
 * twin of this haversine. It is deliberately not exported and not imported here:
 * reaching into that module would drag this pure file into the entity/env chain
 * it exists to stay out of.
 */
export function trackKm(coords: [number, number][]): number {
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    const lon1 = coords[i - 1][0];
    const lat1 = coords[i - 1][1];
    const lon2 = coords[i][0];
    const lat2 = coords[i][1];
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const la1 = (lat1 * Math.PI) / 180;
    const la2 = (lat2 * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    km += 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
  }
  return km;
}

/**
 * Build the publishable artifact from raw `[lon, lat]` tracks.
 *
 * Each track is normalised, tracks that degenerate to fewer than 2 coordinates
 * are dropped, and the feature list is capped at `MAX_RUNS`. Every feature is
 * the bare-geometry shape the Phase 32 aggregate route established: `properties`
 * is a literal empty object and there is nothing else on the feature — no name,
 * no id, no user, no timestamp.
 */
export function assembleHeatmapArtifact(
  year: HeatmapYear,
  generatedAt: string,
  tracks: [number, number][][]
): HeatmapArtifact {
  const features: HeatmapFeature[] = [];
  let totalKm = 0;
  for (const track of tracks) {
    if (features.length >= MAX_RUNS) break;
    const coordinates = normalizeTrack(track);
    if (coordinates.length < 2) continue;
    totalKm += trackKm(coordinates);
    // Bare geometry — deliberately NO properties (non-attributable).
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates },
    });
  }
  return {
    type: "FeatureCollection",
    meta: {
      year,
      generatedAt,
      runCount: features.length,
      totalKm: Math.round(totalKm * 10) / 10,
    },
    features,
  };
}

const ROOT_KEYS = new Set(["type", "meta", "features"]);
const FEATURE_KEYS = new Set(["type", "properties", "geometry"]);
const GEOMETRY_KEYS = new Set(["type", "coordinates"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The phase's SINGLE non-attributability chokepoint (T-71-03).
 *
 * HEAT-06 consciously removed the `includeInAggregate` opt-in gate — every
 * con-day-assigned run now feeds the heat map — so this structural guard IS the
 * compensating control that keeps the widened data set publishable. It throws,
 * naming the offending path, if anything that could identify a runner has
 * attached itself to the artifact.
 *
 * EVERY write path must call it immediately before the object leaves the
 * process, and NO caller may catch-and-continue: a throw here means "do not
 * publish", not "publish anyway".
 */
export function assertNonAttributable(artifact: unknown): void {
  if (!isPlainObject(artifact)) {
    throw new Error("assertNonAttributable: root is not an object");
  }
  for (const k of Object.keys(artifact)) {
    if (!ROOT_KEYS.has(k)) {
      throw new Error(`assertNonAttributable: unexpected root key "${k}"`);
    }
  }
  const features = artifact.features;
  if (!Array.isArray(features)) {
    throw new Error("assertNonAttributable: features is not an array");
  }
  for (let i = 0; i < features.length; i++) {
    const feature: unknown = features[i];
    if (!isPlainObject(feature)) {
      throw new Error(`assertNonAttributable: features[${i}] is not an object`);
    }
    for (const k of Object.keys(feature)) {
      if (!FEATURE_KEYS.has(k)) {
        throw new Error(
          `assertNonAttributable: unexpected key "${k}" on features[${i}]`
        );
      }
    }
    const properties = feature.properties;
    if (!isPlainObject(properties)) {
      throw new Error(
        `assertNonAttributable: features[${i}].properties is not an object`
      );
    }
    const propKeys = Object.keys(properties);
    if (propKeys.length > 0) {
      throw new Error(
        `assertNonAttributable: features[${i}].properties carries ${propKeys.length} key(s): ${propKeys.join(", ")}`
      );
    }
    const geometry = feature.geometry;
    if (!isPlainObject(geometry)) {
      throw new Error(
        `assertNonAttributable: features[${i}].geometry is not an object`
      );
    }
    for (const k of Object.keys(geometry)) {
      if (!GEOMETRY_KEYS.has(k)) {
        throw new Error(
          `assertNonAttributable: unexpected key "${k}" on features[${i}].geometry`
        );
      }
    }
    if (geometry.type !== "LineString") {
      throw new Error(
        `assertNonAttributable: features[${i}].geometry.type is "${String(geometry.type)}", expected "LineString"`
      );
    }
  }
}
