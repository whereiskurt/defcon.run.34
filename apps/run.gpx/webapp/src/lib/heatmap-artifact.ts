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
 * Response-size bounds for an UNAUTHENTICATED public route.
 *
 * `MAX_TRACK_POINTS` decimates any one run's geometry; `MAX_RUNS` bounds how
 * many runs land in a single artifact; `COORD_PRECISION` of 5 decimal places is
 * ~1.1 m — far finer than a 3 px stacked line can express, and the point at
 * which further precision only inflates bytes.
 *
 * CACHING DEPENDENCY — name it, because these bounds were originally sized on a
 * "CDN-cached" premise that was NOT true when it was written. The catch-all
 * region behaviour on this distribution uses the managed caching-DISABLED
 * policy, so the serve route's `s-maxage` header was decorative and three
 * consecutive identical requests all missed to origin. The caching is delivered
 * by a DEDICATED ordered cache behaviour for the public heat-map path in
 * `infra/terraform/modules/cloudfront/v1.0.0/main.tf`, added by plan 71-13. If
 * that behaviour is ever removed these bounds are no longer correctly sized:
 * every hit becomes an origin S3 read plus a full-artifact response body off a
 * single ECS task. Do not delete the bounds — they are the only thing capping
 * that body when the edge is not absorbing.
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

/* ───────────────────────────────────────────────────────────────────────────
 * D-14 — ACCEPTED RISK: run start/end points are published at ~1.1 m.
 * DO NOT "FIX" THIS. It is a recorded decision, not an oversight.
 *
 * The stride below deliberately preserves each run's FIRST and LAST surviving
 * coordinate. Combined with `COORD_PRECISION` of 5 decimal places (~1.1 m) and
 * D-03's removal of the owner opt-in gate, that publishes every con-day run's
 * exact start and end point — often a hotel room door — unauthenticated, at a
 * stable public URL, for runners who never consented to it.
 *
 * Kurt reviewed exactly this on 2026-07-31 with the exposure named plainly and
 * ACCEPTED the risk (**D-14**, `71-CONTEXT.md` -> Gap-Closure Decisions). The
 * proposal he declined was endpoint trimming plus a precision reduction (CR-02).
 *
 * The residual property gap is on the record rather than implied away:
 * `assertNonAttributable` proves the artifact carries no identifier FIELDS.
 * That is a DIFFERENT property from "not re-identifiable from geometry", and it
 * does not imply it. The guard is the sole compensating control and it does not
 * address this.
 *
 * Therefore: the first/last preservation below and `COORD_PRECISION` must NOT
 * be changed as a drive-by fix, and no owner opt-in predicate may be
 * reintroduced. Reversing D-14 requires a NEW user decision, not a code review
 * comment.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Clean and bound one run's geometry for publication.
 *
 * Filters to finite, in-range `[lon, lat]` pairs, rounds each component to
 * `COORD_PRECISION` decimals, then — if the result still exceeds
 * `MAX_TRACK_POINTS` — takes an even stride across the index range that ALWAYS
 * includes the first and last surviving point (see the D-14 block above). Same
 * arithmetic as `decimatePolyline` in `lib/gpx-accomplishment.ts`, but emitting
 * GeoJSON `[lon, lat]` tuples rather than `{lat, lng}` objects.
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
 * are dropped, tracks that never move are dropped (see below), and the feature
 * list is capped at `MAX_RUNS`. Every feature is the bare-geometry shape the
 * Phase 32 aggregate route established: `properties` is a literal empty object
 * and there is nothing else on the feature — no name, no id, no user, no
 * timestamp.
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
    // WR-06 — a track that never moves is not a run. The DC33 export produced
    // 20 of these out of 110 features, all entirely at null island, because a
    // short or degenerate `summary_polyline` decodes to zero accumulated
    // deltas. Left in, they inflate the publicly-served `runCount` (by 22 % on
    // DC33) and draw nothing. This filter sits at the SINGLE assembly point, so
    // it fixes BOTH years at once — but the DC33 artifact is frozen in S3 and
    // must be REBUILT (plan 71-15) before the fix reaches production.
    const [first0, first1] = coordinates[0];
    if (coordinates.every((c) => c[0] === first0 && c[1] === first1)) continue;
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
/**
 * Spelling ported VERBATIM from `scripts/verify-heatmap-artifact.mjs`, which
 * has always been stricter than this runtime guard. One spelling, two callers —
 * do not invent a second.
 */
const META_KEYS = new Set(["year", "generatedAt", "runCount", "totalKm"]);
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
 * publish", not "publish anyway". The public serve route
 * (`api/gpx/public/heatmap/[year]/route.ts`) also calls it on the way OUT, so
 * an object written by anything other than the two known writers cannot be
 * echoed to the internet unchecked.
 *
 * WHAT IT CHECKS (WR-01 widened all three of the blind spots below into real
 * checks; before that the docstring's claim outran the code):
 *   - root is a plain object whose keys are exactly within `ROOT_KEYS`, and
 *     whose `type` is the FeatureCollection literal;
 *   - `meta` is a plain object and every own key is within `META_KEYS`;
 *   - `features` is an array; each feature is a plain object keyed within
 *     `FEATURE_KEYS`, with `properties` a plain object carrying ZERO keys;
 *   - each `geometry` is a plain object keyed within `GEOMETRY_KEYS` whose
 *     `type` is `LineString` and whose `coordinates` is an array of 2-element
 *     arrays of two numbers.
 *
 * WHAT IT STILL DOES NOT CHECK, stated honestly so nobody over-reads it:
 *   - it does NOT range-check coordinates (`normalizeTrack` filters
 *     out-of-range points on the write path and
 *     `scripts/verify-heatmap-artifact.mjs` range-checks the emitted bytes);
 *   - it does NOT check for degenerate geometry (the assembler drops
 *     never-moving tracks; the standalone verifier fails them);
 *   - and per D-14 it proves the artifact carries no identifier FIELDS, which
 *     is NOT the same property as "not re-identifiable from geometry".
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
  if (artifact.type !== "FeatureCollection") {
    throw new Error(
      `assertNonAttributable: root type is "${String(artifact.type)}", expected "FeatureCollection"`
    );
  }
  const meta = artifact.meta;
  if (!isPlainObject(meta)) {
    throw new Error("assertNonAttributable: meta is not an object");
  }
  for (const k of Object.keys(meta)) {
    if (!META_KEYS.has(k)) {
      throw new Error(`assertNonAttributable: unexpected meta key "${k}"`);
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
    // The one field that actually carries data. Before WR-01 the guard walked
    // every key name on the way to it and then never looked inside it.
    const coords = geometry.coordinates;
    if (!Array.isArray(coords)) {
      throw new Error(
        `assertNonAttributable: features[${i}].geometry.coordinates is not an array`
      );
    }
    for (let j = 0; j < coords.length; j++) {
      const c: unknown = coords[j];
      if (!Array.isArray(c) || c.length !== 2) {
        throw new Error(
          `assertNonAttributable: features[${i}].geometry.coordinates[${j}] is not a 2-element array`
        );
      }
      if (typeof c[0] !== "number" || typeof c[1] !== "number") {
        throw new Error(
          `assertNonAttributable: features[${i}].geometry.coordinates[${j}] is not a pair of numbers`
        );
      }
    }
  }
}
