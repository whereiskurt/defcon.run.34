/**
 * Cluster check-in detector. PURE — no I/O, no entities, no DynamoDB, so the
 * whole algorithm is unit-testable against hand-built fixtures.
 *
 * Finds groups of runners who checked in at the same place at the same time:
 * the morning-run start corral, a social event at the Rebar, an ad-hoc group
 * at a halfway point. Every member of a detected cluster earns the same award
 * (see `tierPoints`).
 *
 * The sweep (`cluster-sweep.ts`) owns the DynamoDB reads and the award
 * reconcile; this module only turns points-in-spacetime into clusters.
 */
import { conLocalDate, isConDay } from "./con-days";
import { tierPoints, type ClusterConfig } from "./cluster-config";

/** One check-in reduced to what clustering needs. */
export type ClusterPoint = {
  userId: string;
  checkInId: string;
  lat: number;
  lng: number;
  /** Check-in timestamp, epoch ms. */
  t: number;
};

export type ClusterMember = {
  userId: string;
  /** The runner's EARLIEST check-in in this cluster — their award's anchor. */
  checkInId: string;
  t: number;
};

export type DetectedCluster = {
  clusterId: string;
  /** Con-local YYYY-MM-DD of the cluster's start. */
  day: string;
  centroidLat: number;
  centroidLng: number;
  startAt: number;
  endAt: number;
  /** Distinct runners — always `members.length`. */
  size: number;
  /** Points EACH member receives. */
  points: number;
  members: ClusterMember[];
};

/**
 * Abuse gates supplied by the caller (the sweep). Kept as an argument rather
 * than read here so the detector stays PURE and offline-testable.
 */
export type DetectOptions = {
  /**
   * userIds allowed to count toward a cluster (the anti-sybil gate). When
   * OMITTED the gate is off and every runner counts — the map port and older
   * callers rely on that. When PRESENT it is authoritative: a userId absent
   * from the set is excluded, which is why the sweep must build it fail-closed.
   */
  established?: Set<string>;
};

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. Exported for tests and the sweep's logging. */
export function haversineMeters(
  aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const lat1 = aLat * toRad;
  const lat2 = bLat * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** FNV-1a — a stable, dependency-free id hash. Not security-relevant. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function centroidOf(points: { lat: number; lng: number }[]): {
  lat: number; lng: number;
} {
  // Con venues span a few hundred metres, so a planar mean is exact enough and
  // avoids the branchiness of a spherical mean near the antimeridian (which
  // Las Vegas is nowhere near).
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}

/**
 * Collapse to one entry per runner, keeping each runner's EARLIEST check-in.
 * That earliest check-in becomes the award's anchor key, which is what makes a
 * re-sweep idempotent: a cluster that grows still anchors each existing member
 * on the same check-in, so their award row is updated rather than duplicated.
 */
function earliestPerUser(points: ClusterPoint[]): ClusterMember[] {
  const best = new Map<string, ClusterPoint>();
  for (const p of points) {
    const cur = best.get(p.userId);
    if (!cur || p.t < cur.t || (p.t === cur.t && p.checkInId < cur.checkInId)) {
      best.set(p.userId, p);
    }
  }
  return [...best.values()]
    .map((p) => ({ userId: p.userId, checkInId: p.checkInId, t: p.t }))
    .sort((a, b) => a.t - b.t || (a.userId < b.userId ? -1 : 1));
}

/**
 * Detect check-in clusters.
 *
 * 1. Drop anything not on a con day — every other scoring track is con-day
 *    gated, and cluster bonuses follow the same rule.
 * 2. Sort by time, then use each check-in as a SEED and advance a forward
 *    pointer to collect everything within `windowMinutes`. A cluster therefore
 *    spans at most one window and the seed is always its earliest member. This
 *    keeps candidate generation O(n · window-occupancy) rather than O(n²).
 * 3. Keep points within `radiusMeters` of the seed, then run ONE refinement
 *    pass: recompute the centroid and re-filter around it. Without refinement a
 *    seed on the edge of a crowd clips half the group.
 * 4. Collapse to distinct runners (earliest check-in each).
 * 5. Keep candidates meeting `minRunners`, sort by (size desc, startAt asc,
 *    seed id asc), then GREEDILY claim.
 *
 * Greedy claim: a candidate is accepted only if at least `minRunners` of its
 * runners are still eligible, and the accepted cluster contains exactly those.
 * A runner is ineligible for a candidate when they already hold an accepted
 * cluster within one window of it — so a group cannot farm a second award by
 * re-checking-in twenty minutes later, while a 6am corral and a 9pm social on
 * the same day both pay out.
 *
 * Because sizes shift as runners are claimed, the initial sort only
 * approximates true maximum coverage. That is deliberate: it is deterministic,
 * it is a single pass, and at event scale the difference is immaterial.
 */
export function detectClusters(
  points: ClusterPoint[],
  cfg: ClusterConfig,
  opts: DetectOptions = {},
): DetectedCluster[] {
  if (!cfg.enabled) return [];

  const windowMs = cfg.windowMinutes * 60_000;

  const pool = applyAbuseGates(
    points
      .filter(
        (p) =>
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lng) &&
          Number.isFinite(p.t) &&
          isConDay(conLocalDate(p.t)),
      )
      .sort((a, b) => a.t - b.t || (a.checkInId < b.checkInId ? -1 : 1)),
    cfg,
    opts,
  );

  // ── Candidate generation ──────────────────────────────────────────────────
  const candidates: { seedId: string; members: ClusterMember[]; slice: ClusterPoint[] }[] = [];
  for (let i = 0; i < pool.length; i++) {
    const seed = pool[i];

    const slice: ClusterPoint[] = [];
    for (let j = i; j < pool.length && pool[j].t - seed.t <= windowMs; j++) {
      slice.push(pool[j]);
    }

    const nearSeed = slice.filter(
      (p) => haversineMeters(seed.lat, seed.lng, p.lat, p.lng) <= cfg.radiusMeters,
    );
    if (countDistinct(nearSeed) < cfg.minRunners) continue;

    // Refinement pass: recentre on the crowd, re-filter from the same slice.
    const c = centroidOf(nearSeed);
    const nearCentroid = slice.filter(
      (p) => haversineMeters(c.lat, c.lng, p.lat, p.lng) <= cfg.radiusMeters,
    );
    if (countDistinct(nearCentroid) < cfg.minRunners) continue;

    candidates.push({
      seedId: seed.checkInId,
      members: earliestPerUser(nearCentroid),
      slice: nearCentroid,
    });
  }

  candidates.sort(
    (a, b) =>
      b.members.length - a.members.length ||
      a.members[0].t - b.members[0].t ||
      (a.seedId < b.seedId ? -1 : 1),
  );

  // ── Greedy claim ──────────────────────────────────────────────────────────
  const acceptedTimes = new Map<string, number[]>();
  const out: DetectedCluster[] = [];

  for (const cand of candidates) {
    const eligible = cand.members.filter((m) => {
      const times = acceptedTimes.get(m.userId);
      return !times || !times.some((t) => Math.abs(t - m.t) < windowMs);
    });
    if (eligible.length < cfg.minRunners) continue;

    const eligibleIds = new Set(eligible.map((m) => m.checkInId));
    const c = centroidOf(cand.slice.filter((p) => eligibleIds.has(p.checkInId)));

    const startAt = eligible[0].t;
    const endAt = eligible[eligible.length - 1].t;
    const size = eligible.length;

    out.push({
      clusterId: fnv1a(
        `${startAt}|${c.lat.toFixed(5)},${c.lng.toFixed(5)}|` +
          eligible.map((m) => m.checkInId).sort().join(","),
      ),
      day: conLocalDate(startAt),
      centroidLat: c.lat,
      centroidLng: c.lng,
      startAt,
      endAt,
      size,
      points: tierPoints(size, cfg.tiers),
      members: eligible,
    });

    for (const m of eligible) {
      const times = acceptedTimes.get(m.userId) ?? [];
      times.push(m.t);
      acceptedTimes.set(m.userId, times);
    }
  }

  return out.sort((a, b) => a.startAt - b.startAt);
}

function countDistinct(points: ClusterPoint[]): number {
  const users = new Set<string>();
  for (const p of points) users.add(p.userId);
  return users.size;
}

/**
 * Drop check-ins that must not count toward a cluster. PURE.
 *
 * Two independent gates, both of which only ever remove a check-in from
 * CLUSTERING — the row still exists and still lights the runner's con-day for
 * their run streak. The worst a false positive costs is one group bonus, and a
 * re-sweep recomputes it, so nothing here is destructive.
 *
 *  1. SYBIL — a userId missing from `opts.established` is dropped. Four
 *     throwaway accounts created on the spot can otherwise manufacture a valid
 *     cluster, and with the tiers super-linear that scales badly.
 *
 *  2. IMPOSSIBLE TRAVEL — within one runner's own timeline, if the implied
 *     speed from their previous SURVIVING check-in exceeds `maxSpeedKmh`, the
 *     later one is dropped. Chaining off the previous surviving point (rather
 *     than the raw previous one) stops a single spoofed outlier from
 *     invalidating every genuine check-in after it.
 *
 *     This is a tripwire, not a wall: it catches one account used in two places
 *     at once, and scripted map-hopping. A patient spoofer who only ever
 *     reports one fake location produces no contradiction and sails through.
 */
function applyAbuseGates(
  sorted: ClusterPoint[],
  cfg: ClusterConfig,
  opts: DetectOptions,
): ClusterPoint[] {
  const afterSybil = opts.established
    ? sorted.filter((p) => opts.established!.has(p.userId))
    : sorted;

  if (cfg.maxSpeedKmh <= 0) return afterSybil;

  const lastKept = new Map<string, ClusterPoint>();
  const kept: ClusterPoint[] = [];

  // `sorted` is ascending by time, so per-runner order is already correct.
  for (const p of afterSybil) {
    const prev = lastKept.get(p.userId);
    if (prev) {
      const meters = haversineMeters(prev.lat, prev.lng, p.lat, p.lng);
      const hours = (p.t - prev.t) / 3_600_000;
      // Same instant in two places is impossible at any speed; treat a
      // non-trivial jump with no elapsed time as a violation rather than
      // dividing by zero.
      const violates =
        hours <= 0 ? meters > 1 : meters / 1000 / hours > cfg.maxSpeedKmh;
      if (violates) continue;
    }
    lastKept.set(p.userId, p);
    kept.push(p);
  }

  return kept;
}
