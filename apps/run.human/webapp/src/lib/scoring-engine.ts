/**
 * Derived scoring engine (points-consistency design, 2026-07-30). PURE — no
 * I/O, no entities. Values a user's ENTIRE ledger against CURRENT config:
 *   score = runStreak + socialStreak + ctfStreak + flagPoints + socialPoints
 *           + clusterBonus
 * Solve ORDINALS are frozen history; solve VALUES are recomputed here, so a
 * config retune re-values everyone on their next rescore. The ONLY writer of
 * the result is lib/rescore.ts (enforced by scoring-write-invariant.test.ts).
 */
import { computePoints } from "./ctf-scoring";
import { conLocalDate, isConDay, streakPoints } from "./con-days";
import { DEFAULT_CLUSTER_CONFIG } from "./cluster-config";

export type EngineAccomplishment = {
  source: "checkin" | "gpx" | "strava";
  completedAt: number;
};
export type EngineSolve = { challenge: string; ordinal?: number; solvedAt?: string };
export type EngineScoreEvent = {
  challenge: string;
  bucket: string;
  ordinal?: number;
  points?: number;
  scoredAt?: string;
};
export type EngineCtfConfig = {
  challenge: string;
  pointMax?: number;
  pointFloor?: number;
  maxSolves?: number;
  firstBloodBonus?: number;
  floorAfterMax?: boolean;
  globalMax?: number;
  timeTiers?: { from: string; to: string; ceiling: number }[];
};

/**
 * One cluster check-in award off the ClusterAward ledger. `startAt` is when the
 * CLUSTER happened (not when the sweep ran), so the per-day cap groups by the
 * con day the runners were actually standing together.
 */
export type EngineClusterAward = { points: number; startAt: number };

export interface UserScore {
  score: number;
  breakdown: {
    runStreak: number;
    socialStreak: number;
    ctfStreak: number;
    flagPoints: number;
    /** Flat per-scan social points (see SOCIAL_SCAN_POINTS). Distinct from
     *  `socialStreak`, which pays for DAYS covered rather than scans made. */
    socialPoints: number;
    clusterBonus: number;
  };
  days: { run: number; social: number; ctf: number };
  counts: { checkin: number; gpx: number; strava: number; solves: number; clusters: number };
  latestActivityAt?: number;
}

/**
 * Cluster bonus with the per-day cap applied. The cap counts a runner's BEST
 * `cap` clusters per con day, not their first `cap` — a runner who joins a
 * 5-person group before a 30-person one is not punished for arriving early.
 *
 * The cap lives HERE rather than at award-write time for two reasons: raising
 * it in the admin UI re-values everyone on their next rescore (exactly like a
 * CTF config retune), and the live sweep only ever sees one time window, so it
 * cannot enforce a whole-day cap correctly. The engine sees the full ledger.
 */
function clusterBonusPoints(awards: EngineClusterAward[], cap: number): number {
  const byDay = new Map<string, number[]>();
  for (const a of awards) {
    const day = conLocalDate(a.startAt);
    if (!isConDay(day)) continue;
    const pts = byDay.get(day) ?? [];
    pts.push(a.points ?? 0);
    byDay.set(day, pts);
  }

  let total = 0;
  for (const pts of byDay.values()) {
    pts.sort((a, b) => b - a);
    for (const p of pts.slice(0, Math.max(0, cap))) total += p;
  }
  return total;
}

/** The one non-flag ledger challenge: scan events light social days AND pay. */
const SOCIAL_CHALLENGE = "social-scan";

/**
 * What one social scan is worth (Kurt, 2026-08-06).
 *
 * Scans used to be worth ZERO each — the social track paid only through the
 * streak table, so a runner who scanned forty people saw "+0 🥕 · 40 scans" and
 * reasonably read the board as broken. Every scan now pays this flat amount ON
 * TOP OF the streak bonus.
 *
 * DERIVED, never read from the ledger row's stored `points`. Every social-scan
 * row written before this change stored 0, and the whole point is that those
 * re-value on the next rescore rather than needing a data migration. The scan
 * judge (lib/social-scan.ts) does stamp this value onto NEW rows, but only as
 * an honest audit trail — nothing scores off it.
 *
 * MUTUAL by construction: a successful scan writes one ledger row for the
 * scanner and one for the person scanned, each in their own partition, so both
 * parties earn this — "5 per person", not 5 split between them. The pair-day
 * idempotency gate means the same two runners can only pay each other once per
 * day; DAILY_SCAN_CAP (50) bounds the rest.
 */
export const SOCIAL_SCAN_POINTS = 5;

function flagValue(
  row: { challenge: string; ordinal?: number; at?: string; points?: number },
  configs: Map<string, EngineCtfConfig>,
): number {
  const cfg = configs.get(row.challenge);
  if (!cfg) return 0; // deleted flag = deleted points (reactive by design)
  if (row.ordinal !== undefined && row.ordinal !== null) {
    if ((cfg.globalMax ?? 0) > 0 && row.ordinal > (cfg.globalMax as number)) return 0;
    return computePoints(
      row.ordinal,
      {
        pointMax: cfg.pointMax ?? 0,
        pointFloor: cfg.pointFloor ?? 0,
        maxSolves: cfg.maxSolves ?? 0,
        firstBloodBonus: cfg.firstBloodBonus ?? 0,
        floorAfterMax: cfg.floorAfterMax,
        timeTiers: cfg.timeTiers,
      },
      row.at ? Date.parse(row.at) || 0 : 0,
    );
  }
  // Ordinal-less row: a genuine pre-DC34 legacy row (the old accrue path
  // always wrote `points`) values at the current floor. An ABANDONED claim —
  // a repeatable-flag row claimed (R1) then rejected at perPlayerMax (R2) —
  // never had `points` recorded and must value 0, not farm the floor.
  if (row.points !== undefined) return cfg.pointFloor ?? 0;
  return 0;
}

export function computeUserScore(input: {
  accomplishments: EngineAccomplishment[];
  solves: EngineSolve[];
  events: EngineScoreEvent[];
  configs: Map<string, EngineCtfConfig>;
  /** Cluster check-in awards. Absent on callers that predate the feature. */
  clusterAwards?: EngineClusterAward[];
  /** Per-runner per-con-day cap on counted awards. Defaults to config default. */
  clusterCap?: number;
}): UserScore {
  const { accomplishments, solves, events, configs } = input;
  const clusterAwards = input.clusterAwards ?? [];
  const clusterCap = input.clusterCap ?? DEFAULT_CLUSTER_CONFIG.maxPerUserPerDay;

  // ── Run track: any accomplishment (run OR check-in) lights its con day. ──
  const runDays = new Set<string>();
  const counts = { checkin: 0, gpx: 0, strava: 0, solves: 0, clusters: clusterAwards.length };
  let latestActivityAt: number | undefined;
  for (const a of accomplishments) {
    counts[a.source] += 1;
    if (latestActivityAt === undefined || a.completedAt > latestActivityAt) {
      latestActivityAt = a.completedAt;
    }
    const day = conLocalDate(a.completedAt);
    if (isConDay(day)) runDays.add(day);
  }

  // ── Social track: each scan pays a flat rate AND lights its con day. ──
  // Mirrors the flag track's split: the ACT earns points, the DAY earns streak.
  // A scan outside the con days therefore still pays but lights nothing.
  const socialDays = new Set<string>();
  let socialScans = 0;
  const flagRows: { challenge: string; ordinal?: number; at?: string; points?: number }[] = [];
  for (const e of events) {
    if (e.challenge === SOCIAL_CHALLENGE) {
      socialScans += 1;
      const day = e.bucket.split("#")[0];
      if (isConDay(day)) socialDays.add(day);
      continue;
    }
    flagRows.push({ challenge: e.challenge, ordinal: e.ordinal, at: e.scoredAt, points: e.points });
  }
  for (const s of solves) {
    flagRows.push({ challenge: s.challenge, ordinal: s.ordinal, at: s.solvedAt });
  }

  // ── CTF track: every admitted flag row (even valued 0) lights its day. ──
  // An ABANDONED claim (no ordinal, no points — claimed at R1 then rejected
  // at perPlayerMax R2) was never admitted: it must not light a CTF streak
  // day, matching its 0 valuation in flagValue above.
  const ctfDays = new Set<string>();
  let flagPoints = 0;
  for (const row of flagRows) {
    counts.solves += 1;
    const abandonedClaim =
      (row.ordinal === undefined || row.ordinal === null) && row.points === undefined;
    flagPoints += flagValue(row, configs);
    if (!abandonedClaim && row.at) {
      const t = Date.parse(row.at);
      if (!Number.isNaN(t)) {
        const day = conLocalDate(t);
        if (isConDay(day)) ctfDays.add(day);
      }
    }
  }

  const breakdown = {
    runStreak: streakPoints(runDays.size),
    socialStreak: streakPoints(socialDays.size),
    ctfStreak: streakPoints(ctfDays.size),
    flagPoints,
    socialPoints: socialScans * SOCIAL_SCAN_POINTS,
    clusterBonus: clusterBonusPoints(clusterAwards, clusterCap),
  };
  return {
    score:
      breakdown.runStreak +
      breakdown.socialStreak +
      breakdown.ctfStreak +
      breakdown.flagPoints +
      breakdown.socialPoints +
      breakdown.clusterBonus,
    breakdown,
    days: { run: runDays.size, social: socialDays.size, ctf: ctfDays.size },
    counts,
    latestActivityAt,
  };
}
