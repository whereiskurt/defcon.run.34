/**
 * Derived scoring engine (points-consistency design, 2026-07-30). PURE — no
 * I/O, no entities. Values a user's ENTIRE ledger against CURRENT config:
 *   score = runStreak + socialStreak + ctfStreak + flagPoints
 * Solve ORDINALS are frozen history; solve VALUES are recomputed here, so a
 * config retune re-values everyone on their next rescore. The ONLY writer of
 * the result is lib/rescore.ts (enforced by scoring-write-invariant.test.ts).
 */
import { computePoints } from "./ctf-scoring";
import { conLocalDate, isConDay, streakPoints } from "./con-days";

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

export interface UserScore {
  score: number;
  breakdown: { runStreak: number; socialStreak: number; ctfStreak: number; flagPoints: number };
  days: { run: number; social: number; ctf: number };
  counts: { checkin: number; gpx: number; strava: number; solves: number };
  latestActivityAt?: number;
}

/** The one non-flag ledger challenge: scan events light social days, worth 0. */
const SOCIAL_CHALLENGE = "social-scan";

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
}): UserScore {
  const { accomplishments, solves, events, configs } = input;

  // ── Run track: any accomplishment (run OR check-in) lights its con day. ──
  const runDays = new Set<string>();
  const counts = { checkin: 0, gpx: 0, strava: 0, solves: 0 };
  let latestActivityAt: number | undefined;
  for (const a of accomplishments) {
    counts[a.source] += 1;
    if (latestActivityAt === undefined || a.completedAt > latestActivityAt) {
      latestActivityAt = a.completedAt;
    }
    const day = conLocalDate(a.completedAt);
    if (isConDay(day)) runDays.add(day);
  }

  // ── Social track: scan-day events light days; individual scans worth 0. ──
  const socialDays = new Set<string>();
  const flagRows: { challenge: string; ordinal?: number; at?: string; points?: number }[] = [];
  for (const e of events) {
    if (e.challenge === SOCIAL_CHALLENGE) {
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
  };
  return {
    score: breakdown.runStreak + breakdown.socialStreak + breakdown.ctfStreak + breakdown.flagPoints,
    breakdown,
    days: { run: runDays.size, social: socialDays.size, ctf: ctfDays.size },
    counts,
    latestActivityAt,
  };
}
