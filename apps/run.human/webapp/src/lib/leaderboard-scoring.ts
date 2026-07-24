/**
 * Pure leaderboard scoring module (LDBR-03 / LDBR-12).
 *
 * Single source of truth for how the leaderboard (Phase 51) ranks runners:
 * the point constants, the read-time `globalScore = activityScore + ctfScore`
 * sum, and the DC33 rank comparator.
 *
 * This module is intentionally PURE — no database, no network, no ORM/entity
 * coupling, no import from the CTF judge worktree. It reads `ctfScore` / `ctfSolves`
 * ONLY off the row shape passed in (`ScorableUser`), defaulting to 0 until the
 * CTF judge ships. It NEVER writes CTF data and NEVER imports the judge — the
 * CTF signal is a read-only, additive input owned by the CTF judge worktree
 * (LDBR-12 / CTF design §11 integration boundary). `POINTS` therefore carries
 * no `ctf`/`qr` key: CTF points are owned there, activity points are owned here.
 */

/**
 * Tunable point values per activity source — the single source of truth for
 * activity scoring. No `ctf`/`qr` key: CTF points are owned by the CTF judge.
 */
export const POINTS = { checkin: 1, gpx: 1, strava: 1 } as const;

/**
 * The narrow read shape the scoring functions consume off a scanned `RunUser`
 * row. All fields optional so partial/empty rows read cleanly as 0. Exposes
 * only score/count/timestamp fields (no PII) — see threat T-49-04.
 */
export type ScorableUser = {
  activityScore?: number;
  activityCounts?: { checkin?: number; gpx?: number; strava?: number };
  latestActivityAt?: number;
  createdAt?: number;
  /** Read-only CTF rollup, owned by the CTF judge worktree (LDBR-12). */
  ctfScore?: number;
  /** Read-only CTF solve count, owned by the CTF judge worktree (LDBR-12). */
  ctfSolves?: number;
};

/**
 * Read-time global score: activity score plus the read-only CTF score.
 * Degrades to `activityScore` when `ctfScore` is unset, and to 0 for an empty
 * row (never NaN/throw) — SC #2.
 */
export function globalScore(u: ScorableUser): number {
  return (u.activityScore ?? 0) + (u.ctfScore ?? 0);
}

/**
 * Total accomplishment count: activity check-in + gpx + strava counts plus
 * the read-only CTF solve count. Used as the first tie-break in the
 * comparator.
 */
export function totalCount(u: ScorableUser): number {
  const counts = u.activityCounts ?? {};
  return (
    (counts.checkin ?? 0) +
    (counts.gpx ?? 0) +
    (counts.strava ?? 0) +
    (u.ctfSolves ?? 0)
  );
}

/**
 * DC33 rank comparator (ports db/user.ts sort order): globalScore desc →
 * total count desc → latestActivityAt desc (missing = 0) → createdAt asc
 * (missing = 0, older account first) — SC #3.
 */
export function rankComparator(a: ScorableUser, b: ScorableUser): number {
  const scoreA = globalScore(a);
  const scoreB = globalScore(b);
  if (scoreA !== scoreB) return scoreB - scoreA;

  const countA = totalCount(a);
  const countB = totalCount(b);
  if (countA !== countB) return countB - countA;

  const latestA = a.latestActivityAt ?? 0;
  const latestB = b.latestActivityAt ?? 0;
  if (latestA !== latestB) return latestB - latestA;

  return (a.createdAt ?? 0) - (b.createdAt ?? 0);
}
