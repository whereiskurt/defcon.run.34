/**
 * ctf-otp-client.ts — browser-safe rolling-OTP code computation for the Slice 1b
 * `otp-enroll` reward renderer (CTFT-08).
 *
 * The shipped server TOTP (`ctf-otp.ts`) uses the node crypto module and cannot
 * run in a "use client" bundle. This module reuses the AUDITED, dependency-free
 * primitives from `./ctf-otp-core` (base32 decode, big-endian counter bytes,
 * RFC-4226 dynamic truncation) and performs the one platform-specific step — the
 * HMAC-SHA1 — via the Web Crypto API (`globalThis.crypto.subtle`). It therefore
 * imports NOTHING node-only and does NOT import the server module (which would
 * drag the node crypto module into the client bundle).
 *
 * `adjacentCodesAsync` resolves the SAME { previous, current, next,
 * remainingSeconds } as the synchronous server `adjacentCodes` for identical
 * inputs — parity is unit-tested across a secret×time×period matrix and anchored
 * to an RFC-6238 vector. No new dependency: HMAC uses the built-in Web Crypto.
 */

import {
  DEFAULT_ALGORITHM,
  DEFAULT_DIGITS,
  DEFAULT_PERIOD,
  base32Decode,
  counterBytes,
  truncateHotp,
} from "./ctf-otp-core";
import type { AdjacentCodes, TotpOptions } from "./ctf-otp-core";

/**
 * Map an otpauth `algorithm` (case-insensitive) to the Web Crypto SubtleCrypto
 * hash name. Covers the three RFC-6238 algorithms; anything else is unsupported.
 */
const SUBTLE_HASH_BY_ALGORITHM: Record<string, string> = {
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA512: "SHA-512",
};

/**
 * Whether the browser TOTP path can compute codes for `algorithm` (SHA1/256/512).
 * `CtfOtpEnroll` uses this to render an explicit "unsupported algorithm" note
 * instead of a permanent `······` placeholder for an exotic enrollment URL (WR-02).
 */
export function isSupportedAlgorithm(algorithm: string): boolean {
  return algorithm.toUpperCase() in SUBTLE_HASH_BY_ALGORITHM;
}

/**
 * Web Crypto TOTP for `secret` at absolute time `unixSeconds`. Mirrors the sync
 * `totpAt`: counter = floor(unixSeconds / period); HMAC over the big-endian
 * counter; RFC-4226 dynamic truncation; mod 10^digits; zero-padded. Async because
 * `crypto.subtle` is promise-based.
 *
 * Honors `opts.algorithm` (SHA1/256/512), defaulting to SHA1 (WR-02): a non-SHA1
 * enrollment URL previously threw an "unsupported algorithm" error that the caller
 * swallowed, leaving the rolling code stuck. Throws on a genuinely unsupported
 * algorithm so the caller can surface it rather than no-op silently.
 */
async function totpAtAsync(
  secret: string,
  unixSeconds: number,
  opts: TotpOptions = {},
): Promise<string> {
  const digits = opts.digits ?? DEFAULT_DIGITS;
  const period = opts.period ?? DEFAULT_PERIOD;
  const algorithm = (opts.algorithm ?? DEFAULT_ALGORITHM).toUpperCase();

  const hash = SUBTLE_HASH_BY_ALGORITHM[algorithm];
  if (hash === undefined) {
    throw new Error(`unsupported algorithm: ${algorithm}`);
  }

  const keyBytes = base32Decode(secret);
  const counter = Math.floor(unixSeconds / period);

  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  const sig = await subtle.sign("HMAC", key, counterBytes(counter));
  const mac = new Uint8Array(sig);

  return truncateHotp(mac, digits);
}

/**
 * Browser-safe equivalent of the server `adjacentCodes`: resolves the codes for
 * the window straddling `now` (previous/current/next period) plus the seconds
 * remaining in the current period (in [1, period]). Identical results to the
 * synchronous server path for the same inputs.
 */
export async function adjacentCodesAsync(
  secret: string,
  nowUnixSeconds: number,
  opts: TotpOptions = {},
): Promise<AdjacentCodes> {
  const period = opts.period ?? DEFAULT_PERIOD;
  const currentPeriodStart = Math.floor(nowUnixSeconds / period) * period;
  // Matches the server: at a period boundary (mod 0) this reads `period`,
  // elsewhere `period - (now % period)` — always in [1, period].
  const remainingSeconds = period - (nowUnixSeconds % period);

  const [previous, current, next] = await Promise.all([
    totpAtAsync(secret, currentPeriodStart - period, opts),
    totpAtAsync(secret, currentPeriodStart, opts),
    totpAtAsync(secret, currentPeriodStart + period, opts),
  ]);

  return { previous, current, next, remainingSeconds };
}
