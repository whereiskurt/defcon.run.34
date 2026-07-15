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
 * Web Crypto TOTP for `secret` at absolute time `unixSeconds`. Mirrors the sync
 * `totpAt`: counter = floor(unixSeconds / period); HMAC-SHA1 over the big-endian
 * counter; RFC-4226 dynamic truncation; mod 10^digits; zero-padded. Async because
 * `crypto.subtle` is promise-based.
 */
async function totpAtAsync(
  secret: string,
  unixSeconds: number,
  opts: TotpOptions = {},
): Promise<string> {
  const digits = opts.digits ?? DEFAULT_DIGITS;
  const period = opts.period ?? DEFAULT_PERIOD;
  const algorithm = DEFAULT_ALGORITHM;

  // Only SHA1 is wired today; matches the shipped server default. The branch is
  // the documented seam for SHA256/512 (Web Crypto: "SHA-256" / "SHA-512").
  let hash: string;
  switch (algorithm) {
    case "SHA1":
      hash = "SHA-1";
      break;
    default:
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
