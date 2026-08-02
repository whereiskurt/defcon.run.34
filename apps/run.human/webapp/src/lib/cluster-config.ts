/**
 * Cluster check-in bonus — tunables, defaults, and validation. PURE: no I/O,
 * no entities, no DynamoDB. The persisted read (a single ClusterConfig row,
 * short-TTL cached) lives in `cluster-config-store.ts`; this module owns the
 * shape, the defaults, and the tier math so both the detector and the admin
 * PUT can share one validator.
 *
 * Config is persisted rather than hardcoded so the radius can be retuned from
 * a phone at the con without cutting a release.
 */

/** One rung of the award ladder: a cluster of >= minRunners pays `points` each. */
export type ClusterTier = { minRunners: number; points: number };

export type ClusterConfig = {
  enabled: boolean;
  /** Max distance from the cluster centroid for a check-in to belong, in metres. */
  radiusMeters: number;
  /** Max span of a single cluster, in minutes. */
  windowMinutes: number;
  /** Distinct runners required before a cluster awards anything. */
  minRunners: number;
  /** Per-runner, per-con-day cap on how many cluster awards count (best-N). */
  maxPerUserPerDay: number;
  /**
   * Anti-sybil: how old an account must be to count toward a cluster on age
   * alone. A runner younger than this still counts if they show ANY other
   * established signal (a run, a Strava import, a flag) — see
   * `isEstablishedRunner`. Set to 0 to disable the gate entirely (every
   * account then satisfies the age signal).
   */
  minAccountAgeHours: number;
  /**
   * Anti-spoof: km/h between a runner's consecutive check-ins above which the
   * later one is ignored for CLUSTERING. Defaults to a fast running pace,
   * because clusters are gatherings of runners. Note this also catches a
   * runner who DROVE between two check-ins made close together — the cost is
   * one group bonus, never a check-in or a streak day. Set to 0 to disable.
   */
  maxSpeedKmh: number;
  /** Award ladder, ascending by minRunners. */
  tiers: ClusterTier[];
};

/**
 * Balanced defaults (design §6): fits a Rebar meetup and a morning-run start
 * corral without merging two unrelated groups in the same hotel.
 */
export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
  enabled: true,
  radiusMeters: 200,
  windowMinutes: 60,
  minRunners: 4,
  maxPerUserPerDay: 3,
  minAccountAgeHours: 24,
  // Roughly elite marathon pace — clusters are gatherings of runners.
  maxSpeedKmh: 21,
  tiers: [
    { minRunners: 4, points: 25 },
    { minRunners: 8, points: 50 },
    { minRunners: 15, points: 100 },
    { minRunners: 25, points: 200 },
  ],
};

/** Hard bounds — the admin form is a text input, so the server re-clamps. */
const LIMITS = {
  radiusMeters: { min: 10, max: 5_000 },
  windowMinutes: { min: 1, max: 24 * 60 },
  minRunners: { min: 2, max: 500 },
  maxPerUserPerDay: { min: 1, max: 50 },
  minAccountAgeHours: { min: 0, max: 24 * 30 },
  maxSpeedKmh: { min: 0, max: 1000 },
} as const;

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Points every member of a cluster of `size` distinct runners receives: the
 * highest tier whose threshold the cluster meets. Below the lowest tier (or
 * with no tiers configured) a cluster is worth 0 — the detector's `minRunners`
 * gate normally makes that unreachable, but the two knobs are independent so
 * this stays defined.
 */
export function tierPoints(size: number, tiers: ClusterTier[]): number {
  let points = 0;
  for (const t of tiers) {
    if (size >= t.minRunners && t.minRunners >= 0) {
      // Ascending scan without assuming the caller sorted: keep the highest
      // threshold that still applies, so an out-of-order table still resolves.
      points = Math.max(points, t.points);
    }
  }
  return points;
}

/**
 * Coerce an untrusted object (the admin PUT body, or a legacy/partial DDB row)
 * into a valid ClusterConfig. Every field falls back to its default rather
 * than throwing — a malformed row must never take cluster scoring offline in a
 * way that silently zeroes everyone's bonus.
 *
 * Tiers are de-duplicated by threshold and sorted ascending so `tierPoints`
 * and the admin table agree on ordering.
 */
export function normalizeClusterConfig(raw: unknown): ClusterConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  const d = DEFAULT_CLUSTER_CONFIG;

  const rawTiers = Array.isArray(o.tiers) ? o.tiers : null;
  let tiers: ClusterTier[] = d.tiers;
  if (rawTiers) {
    const byThreshold = new Map<number, number>();
    for (const t of rawTiers) {
      const tt = (t ?? {}) as Record<string, unknown>;
      const minRunners = Number(tt.minRunners);
      const points = Number(tt.points);
      if (!Number.isFinite(minRunners) || !Number.isFinite(points)) continue;
      if (minRunners < 1 || points < 0) continue;
      byThreshold.set(Math.round(minRunners), Math.round(points));
    }
    // An explicitly empty tier table is legal (it disables awards without
    // disabling detection); only a fully unparseable one falls back.
    tiers = [...byThreshold.entries()]
      .map(([minRunners, points]) => ({ minRunners, points }))
      .sort((a, b) => a.minRunners - b.minRunners);
  }

  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : d.enabled,
    radiusMeters: clampInt(
      o.radiusMeters, d.radiusMeters, LIMITS.radiusMeters.min, LIMITS.radiusMeters.max),
    windowMinutes: clampInt(
      o.windowMinutes, d.windowMinutes, LIMITS.windowMinutes.min, LIMITS.windowMinutes.max),
    minRunners: clampInt(
      o.minRunners, d.minRunners, LIMITS.minRunners.min, LIMITS.minRunners.max),
    maxPerUserPerDay: clampInt(
      o.maxPerUserPerDay, d.maxPerUserPerDay,
      LIMITS.maxPerUserPerDay.min, LIMITS.maxPerUserPerDay.max),
    minAccountAgeHours: clampInt(
      o.minAccountAgeHours, d.minAccountAgeHours,
      LIMITS.minAccountAgeHours.min, LIMITS.minAccountAgeHours.max),
    maxSpeedKmh: clampInt(
      o.maxSpeedKmh, d.maxSpeedKmh,
      LIMITS.maxSpeedKmh.min, LIMITS.maxSpeedKmh.max),
    tiers,
  };
}

/**
 * The facts the sybil gate reads about a runner. All denormalized onto the
 * RunUser row, so the whole established-set is one batch get — no per-runner
 * queries at sweep time.
 */
export type RunnerSignals = {
  /** Account creation, epoch ms. Absent on very old rows → treated as old. */
  createdAt?: number;
  /** Rollup of non-check-in activity (written by rescoreUser). */
  activityCounts?: { gpx?: number; strava?: number };
  /** CTF solve count (written by rescoreUser). */
  ctfSolves?: number;
};

/**
 * PURE: may this runner count toward a cluster?
 *
 * A permissive OR — a real attendee almost certainly satisfies one of these; a
 * throwaway account created minutes ago to pad a cluster satisfies none:
 *   • the account is older than `minAccountAgeHours`, OR
 *   • they have logged a run or a Strava import, OR
 *   • they have solved a flag.
 *
 * Deliberately NOT gated on owning a bib: that would turn the cluster bonus
 * into a bib-holder perk and exclude most social-event attendees.
 *
 * Failing this does NOT invalidate the check-in — it still saves and still
 * lights the runner's con-day. It only stops the account swelling a cluster.
 */
export function isEstablishedRunner(
  signals: RunnerSignals | undefined,
  cfg: Pick<ClusterConfig, "minAccountAgeHours">,
  now: number,
): boolean {
  // A missing row is treated as NOT established — an account we cannot see is
  // exactly the case the gate exists for (fail closed).
  if (!signals) return false;

  if (cfg.minAccountAgeHours <= 0) return true;

  const ageMs = cfg.minAccountAgeHours * 3_600_000;
  // No createdAt = a pre-dating row, i.e. genuinely old.
  if (signals.createdAt === undefined) return true;
  if (now - signals.createdAt >= ageMs) return true;

  if ((signals.activityCounts?.gpx ?? 0) > 0) return true;
  if ((signals.activityCounts?.strava ?? 0) > 0) return true;
  if ((signals.ctfSolves ?? 0) > 0) return true;

  return false;
}
