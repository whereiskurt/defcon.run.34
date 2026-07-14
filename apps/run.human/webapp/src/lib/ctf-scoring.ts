/**
 * CTF scoring engine (CTF-02) — pure, clock-injectable, no I/O.
 *
 * Composed formula (LOCKED, see 44-CONTEXT §Scoring):
 *   if n > maxSolves            → 0
 *   ceiling = activeTierCeiling(now, timeTiers) ?? pointMax
 *   span    = ceiling - pointFloor
 *   frac    = maxSolves == 1 ? 1 : 1 - (n - 1) / (maxSolves - 1)   // linear decline
 *   base    = pointFloor + span * frac
 *   bonus   = n == 1 ? firstBloodBonus : 0
 *   return round(base) + bonus
 *
 * The `ScoringConfig` type is STRUCTURAL on purpose: it is not imported from the
 * `Ctf` entity, so this module stays parallel-safe with 44-01 (the loaded Ctf row
 * satisfies it by shape).
 */

export interface TimeTier {
  /** UTC-ISO start, inclusive. */
  from: string;
  /** UTC-ISO end, exclusive. */
  to: string;
  /** Curve ceiling while `now` is inside this window. */
  ceiling: number;
}

export interface ScoringConfig {
  /** Curve ceiling when no time tier is active. */
  pointMax: number;
  /** Curve floor (the `n == maxSolves` landing point, pre-bonus). */
  pointFloor: number;
  /** N — the solve cap AND the linear-decline denominator. */
  maxSolves: number;
  /** Flat bonus awarded only to the first blood (`n == 1`). */
  firstBloodBonus: number;
  /** Optional active-window ceilings; first half-open [from,to) match wins. */
  timeTiers?: TimeTier[];
}

/** Coerce a Date | number clock to epoch ms; defaults to Date.now(). */
function toMs(now?: Date | number): number {
  if (now === undefined) return Date.now();
  return now instanceof Date ? now.getTime() : now;
}

/**
 * Return the `ceiling` of the first time tier whose half-open `[from, to)`
 * interval contains `now`, else `null`. Total: an unparseable `from`/`to` is
 * treated as non-matching and never throws.
 */
export function activeTierCeiling(
  now: Date | number,
  tiers?: TimeTier[],
): number | null {
  if (!Array.isArray(tiers)) return null;
  const t = toMs(now);
  for (const tier of tiers) {
    if (!tier) continue;
    const from = Date.parse(tier.from);
    const to = Date.parse(tier.to);
    if (Number.isNaN(from) || Number.isNaN(to)) continue; // garbage → skip
    if (t >= from && t < to) return tier.ceiling; // half-open [from, to)
  }
  return null;
}

/**
 * Points awarded to the n-th solver (1-indexed) of a challenge.
 * Pure; `now` is injectable for deterministic tier-boundary tests.
 */
export function computePoints(
  n: number,
  ctf: ScoringConfig,
  now?: Date | number,
): number {
  if (n > ctf.maxSolves) return 0; // over the cap → no points

  const ceiling = activeTierCeiling(toMs(now), ctf.timeTiers) ?? ctf.pointMax;
  const span = ceiling - ctf.pointFloor;
  // --- linear per-solve decline (future curved-swap point: replace this line) ---
  const frac = ctf.maxSolves === 1 ? 1 : 1 - (n - 1) / (ctf.maxSolves - 1);
  const base = ctf.pointFloor + span * frac;
  const bonus = n === 1 ? ctf.firstBloodBonus : 0;
  return Math.round(base) + bonus;
}
