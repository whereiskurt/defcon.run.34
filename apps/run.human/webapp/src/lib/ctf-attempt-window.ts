/**
 * Attempt-window token for the CTF anti-spam counter — pure, no I/O, no electro.
 *
 * Mirrors `scoreBucket` (ctf-flag-types.ts): floor the clock to a fixed window
 * and return a stable string token. The token is a KEY component of the
 * `CtfAttempt` sk, which is what makes the rate limiter self-resetting: a new
 * window is a brand-new row that starts at `count = 1` by construction.
 *
 * ⚠️ WHY THIS EXISTS (production incident, DEF CON 34, 2026-08-08):
 * The counter used to be ONE row per (challenge, user) with `ADD count 1` and
 * no window in the key — the reset was delegated entirely to DynamoDB TTL.
 * TTL deletion is best-effort (AWS promises only ~48h), and every attempt reset
 * `ttl` to `now + window`, re-arming the expiry. So `count` accumulated across
 * DAYS. On a daily repeatable flag (`ricky`, `<persona>-otp`) a player got about
 * five good days and was then blocked permanently — silently, because the
 * over-cap branch is deliberately indistinguishable from a wrong guess.
 * TTL is now garbage collection only; correctness never depends on it.
 */

/**
 * Fallback window (seconds) when a challenge configures none. A challenge with
 * no `rateLimitWindow` must still get a window that ADVANCES — collapsing to a
 * constant token would recreate the never-resetting counter above.
 */
export const DEFAULT_ATTEMPT_WINDOW_SECONDS = 60;

/**
 * Floor `nowMs` to the rate-limit window and return a stable string token. Two
 * timestamps in the same window return the SAME token; adjacent windows differ.
 *
 * A missing, zero, negative or non-finite `windowSeconds` falls back to
 * DEFAULT_ATTEMPT_WINDOW_SECONDS — a garbage config must degrade to ordinary
 * rate limiting, never to a permanent lockout.
 */
export function attemptWindow(nowMs: number, windowSeconds?: number): string {
  const w =
    Number.isFinite(windowSeconds) && (windowSeconds as number) > 0
      ? Math.floor(windowSeconds as number)
      : DEFAULT_ATTEMPT_WINDOW_SECONDS;
  const nowSeconds = Math.floor(nowMs / 1000);
  return String(Math.floor(nowSeconds / w));
}
