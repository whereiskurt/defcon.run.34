/**
 * ctf-otp.ts — RFC 6238 / 4226 TOTP SERVER surface for CTF rotating-OTP flags
 * (CTFT-02). The node-crypto-backed half of the CTF OTP core.
 *
 * PORT SOURCE: `~/working/meshtk/pkg/otp/totp.go` (upstream Go — NOT in this repo).
 *   NewOTPHandler                    -> parseOtpauth (now in ./ctf-otp-core)
 *   GenerateTOTP                     -> totpAt
 *   CalculateTOTPWithAdjacentPeriods -> adjacentCodes
 * The Go core is generation-only. `verifyTotp` (±skew window + constant-time
 * compare) is NEW logic the Go LACKS — proven here against RFC 6238 vectors.
 *
 * The platform-NEUTRAL primitives (base32 decode → Uint8Array, big-endian
 * counter bytes, RFC-4226 dynamic truncation, otpauth parsing, the DEFAULT_*
 * constants and shared types) now live in `./ctf-otp-core`, which imports
 * NOTHING from node so it can also back the browser client (`ctf-otp-client.ts`).
 * This module re-exports those types + parseOtpauth so every existing
 * `import { parseOtpauth, OtpConfig, ... } from "./ctf-otp"` caller is unaffected,
 * and layers the node-only steps (`createHmac`, `timingSafeEqual`) on top.
 *
 * SECURITY HYGIENE (D-08): this module NEVER logs the secret or the guess. The
 * TOTP secret must be stored to verify (inherent to TOTP; same trust level as
 * meshtk — documented, not a regression). The final code comparison routes
 * through a length-guarded `crypto.timingSafeEqual` (T-53-02-01 mitigation).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  DEFAULT_ALGORITHM,
  DEFAULT_DIGITS,
  DEFAULT_PERIOD,
  base32Decode,
  counterBytes,
  parseOtpauth,
  truncateHotp,
} from "./ctf-otp-core";
import type {
  AdjacentCodes,
  OtpConfig,
  TotpOptions,
  VerifyOptions,
} from "./ctf-otp-core";

// Re-export the shared types + the node-free parseOtpauth so existing callers
// (`import { parseOtpauth, OtpConfig } from "./ctf-otp"`) keep working unchanged.
export type { AdjacentCodes, OtpConfig, TotpOptions, VerifyOptions };
export { parseOtpauth };

/**
 * Generate the TOTP code for `secret` at absolute time `unixSeconds`.
 * counter = floor(unixSeconds / period); HMAC over the big-endian counter;
 * dynamic truncation; mod 10^digits; zero-padded to `digits`.
 *
 * Builds the key/counter and truncates via the shared node-free core primitives;
 * only the HMAC-SHA1 step uses `node:crypto`.
 */
export function totpAt(secret: string, unixSeconds: number, opts: TotpOptions = {}): string {
  const digits = opts.digits ?? DEFAULT_DIGITS;
  const period = opts.period ?? DEFAULT_PERIOD;
  const algorithm = DEFAULT_ALGORITHM;

  const key = base32Decode(secret);
  const counter = Math.floor(unixSeconds / period);

  let mac: Buffer;
  // Only SHA1 is wired today; the switch is the documented seam for SHA256/512.
  switch (algorithm) {
    case "SHA1":
      mac = createHmac("sha1", key).update(counterBytes(counter)).digest();
      break;
    default:
      throw new Error(`unsupported algorithm: ${algorithm}`);
  }

  // Dynamic truncation (RFC 4226 §5.3) via the shared core formatter.
  return truncateHotp(mac, digits);
}

/**
 * Compute the codes for the window straddling `now`: previous/current/next
 * period plus the seconds remaining in the current period (in [1, period]).
 * Exported now for the Slice 1b reward reveal (rolling-code display).
 */
export function adjacentCodes(
  secret: string,
  nowUnixSeconds: number,
  opts: TotpOptions = {},
): AdjacentCodes {
  const period = opts.period ?? DEFAULT_PERIOD;
  const currentPeriodStart = Math.floor(nowUnixSeconds / period) * period;
  // Matches the Go core: at a period boundary (mod 0) this reads `period`,
  // elsewhere `period - (now % period)` — always in [1, period].
  const remainingSeconds = period - (nowUnixSeconds % period);

  return {
    previous: totpAt(secret, currentPeriodStart - period, opts),
    current: totpAt(secret, currentPeriodStart, opts),
    next: totpAt(secret, currentPeriodStart + period, opts),
    remainingSeconds,
  };
}

/**
 * Length-guarded constant-time string compare (T-53-02-01 mitigation).
 * `crypto.timingSafeEqual` REQUIRES equal-length buffers (throws otherwise), so
 * a different length short-circuits to false BEFORE the timing-safe compare.
 * Empty inputs are false. Never throws. Exported (underscore-prefixed) as the
 * unit-testable seam; do not call from outside this module's own verify path.
 */
export function _constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * NEW LOGIC (the Go core has no verify/skew): accept `guess` if it equals the
 * code for ANY period offset in [-skew .. +skew] around `now`. Every candidate
 * is compared with the length-guarded constant-time compare and the results are
 * OR'd. Returns false (never throws) on any decode error, so an undecodable
 * secret or malformed guess is an indistinguishable non-match — the covert /
 * judge callers rely on "wrong answer == false", never an exception.
 *
 * NEVER logs the secret or the guess.
 */
export function verifyTotp(
  secret: string,
  guess: string,
  nowUnixSeconds: number,
  opts: VerifyOptions = {},
): boolean {
  const period = opts.period ?? DEFAULT_PERIOD;
  const skew = opts.skew ?? 1;
  const g = (guess ?? "").trim();
  if (!g) return false;

  let ok = false;
  try {
    for (let offset = -skew; offset <= skew; offset++) {
      const candidate = totpAt(secret, nowUnixSeconds + offset * period, opts);
      // Do NOT short-circuit the loop: OR every result so the compare cost does
      // not depend on which offset (if any) matched.
      ok = _constantTimeEqual(g, candidate) || ok;
    }
  } catch {
    return false;
  }
  return ok;
}
