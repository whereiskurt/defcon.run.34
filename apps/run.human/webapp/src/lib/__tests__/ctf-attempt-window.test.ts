import { describe, it, expect } from "vitest";
import {
  attemptWindow,
  DEFAULT_ATTEMPT_WINDOW_SECONDS,
} from "@/lib/ctf-attempt-window";

/**
 * The production incident these tests pin (2026-08-08, DEF CON 34):
 *
 * `overAttemptLimit` kept ONE CtfAttempt row per (challenge, user), did
 * `ADD count 1` forever, and delegated the window reset entirely to DynamoDB
 * TTL. TTL reaping is best-effort (AWS promises only ~48h), and every attempt
 * pushed `ttl` forward again — so `count` accumulated across DAYS. On a daily
 * repeatable flag (ricky, <persona>-otp) a player got ~5 good days and was then
 * blocked forever, silently, because the over-cap branch is deliberately
 * indistinguishable from a wrong guess.
 *
 * Observed: Shake-Weight made exactly ONE ricky claim that day (a single
 * ctf-judge "no-solve" at 16:10:20Z) and his counter read count=6 against
 * maxAttempts=5. One attempt cannot reach 6 — the counter had carried over.
 *
 * The fix makes the window a KEY component, so a new window is a brand-new row
 * that starts at 1 by construction and never depends on TTL for correctness.
 */
describe("attemptWindow", () => {
  const base = Date.UTC(2026, 7, 8, 16, 10, 20); // the real failure instant

  it("returns the SAME token for two times inside one window", () => {
    const a = attemptWindow(base, 60);
    const b = attemptWindow(base + 30_000, 60);
    expect(a).toBe(b);
  });

  it("returns a DIFFERENT token for the adjacent window", () => {
    const a = attemptWindow(base, 60);
    const b = attemptWindow(base + 60_000, 60);
    expect(a).not.toBe(b);
  });

  it("REGRESSION: attempts days apart never share a window", () => {
    // Shake-Weight's prior ricky claims (08-06, 08-07) must not be able to
    // poison the 08-08 claim. Distinct tokens ⇒ distinct rows ⇒ count starts
    // at 1 ⇒ the single 08-08 tap is admitted.
    const aug06 = Date.UTC(2026, 7, 6, 16, 22, 38);
    const aug07 = Date.UTC(2026, 7, 7, 6, 49, 44);
    const tokens = new Set([
      attemptWindow(aug06, 60),
      attemptWindow(aug07, 60),
      attemptWindow(base, 60),
    ]);
    expect(tokens.size).toBe(3);
  });

  it("falls back to a bounded default when the window is absent or garbage", () => {
    // A missing/zero/negative window must NEVER collapse to a constant token:
    // that would recreate the never-resetting counter this fix removes.
    const cases = [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY];
    for (const w of cases) {
      const a = attemptWindow(base, w as number);
      const b = attemptWindow(base + DEFAULT_ATTEMPT_WINDOW_SECONDS * 1000, w as number);
      expect(a, `window=${String(w)} must still advance`).not.toBe(b);
    }
  });

  it("is a stable string token suitable for a key composite", () => {
    const t = attemptWindow(base, 60);
    expect(typeof t).toBe("string");
    expect(t).toMatch(/^\d+$/);
  });
});
