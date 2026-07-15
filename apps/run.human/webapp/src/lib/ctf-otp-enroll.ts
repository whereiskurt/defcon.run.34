/**
 * ctf-otp-enroll.ts — the pure narrowing gate for the Slice-1b `otp-enroll`
 * reward (CTFT-08).
 *
 * `JudgeResult.effect` is typed `unknown` (a per-challenge authored payload the
 * judge carries but never interprets — see ctf-judge.ts / OtpEnrollEffect). The
 * visible ClaimClient result card must narrow it before rendering the reward.
 * `asOtpEnrollEffect` is that gate: it returns a well-typed `OtpEnrollEffect`
 * only when the input is an object with `kind==="otp-enroll"` and a non-empty
 * `otpauth` string that `parseOtpauth` accepts; otherwise it returns `null`.
 *
 * The predicate NEVER throws (parseOtpauth is wrapped in try/catch), so a
 * malformed effect degrades to "render nothing / base success still shows"
 * rather than crashing the claim page (T-54-03-02).
 *
 * Client-safe: it imports the `OtpEnrollEffect` TYPE from ctf-judge (type-only,
 * so no electro/server runtime is pulled in) and `parseOtpauth` from
 * ctf-otp-core (the node-free shared core). It never imports the node-backed
 * ctf-otp.ts or the judge runtime.
 */

import type { OtpEnrollEffect } from "@/lib/ctf-judge";
import { parseOtpauth } from "@/lib/ctf-otp-core";

export type { OtpEnrollEffect };

/**
 * Narrow an untyped judge `effect` to an `OtpEnrollEffect`, or `null`.
 *
 * Returns a value only when ALL hold:
 *   - `effect` is a non-null, non-array object;
 *   - `effect.kind === "otp-enroll"`;
 *   - `effect.otpauth` is a non-empty string that `parseOtpauth` parses without
 *     throwing (valid `otpauth://totp/...?secret=...`).
 *
 * `nextFlag` is carried through only when it is a string; any other type is
 * dropped (the otpauth reward stays valid). Never throws.
 */
export function asOtpEnrollEffect(effect: unknown): OtpEnrollEffect | null {
  if (typeof effect !== "object" || effect === null || Array.isArray(effect)) {
    return null;
  }

  const e = effect as Record<string, unknown>;
  if (e.kind !== "otp-enroll") {
    return null;
  }

  const otpauth = e.otpauth;
  if (typeof otpauth !== "string" || otpauth.length === 0) {
    return null;
  }

  // Confirm the otpauth is well-formed; a bad URL/secret/type must no-op, not throw.
  try {
    parseOtpauth(otpauth);
  } catch {
    return null;
  }

  const narrowed: OtpEnrollEffect = { kind: "otp-enroll", otpauth };
  if (typeof e.nextFlag === "string") {
    narrowed.nextFlag = e.nextFlag;
  }
  return narrowed;
}
