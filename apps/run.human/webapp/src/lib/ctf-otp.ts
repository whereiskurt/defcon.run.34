/**
 * ctf-otp.ts — RFC 6238 / 4226 TOTP core for CTF rotating-OTP flags (CTFT-02).
 *
 * PORT SOURCE: `~/working/meshtk/pkg/otp/totp.go` (upstream Go — NOT in this repo).
 *   NewOTPHandler                    -> parseOtpauth
 *   GenerateTOTP                     -> totpAt
 *   CalculateTOTPWithAdjacentPeriods -> adjacentCodes
 * The Go core is generation-only. `verifyTotp` (±skew window + constant-time
 * compare) is NEW logic the Go LACKS — proven here against RFC 6238 vectors.
 *
 * Pure module: imports ONLY `node:crypto` (no ElectroDB, no DOM, no new package).
 * Node has no built-in base32, so the decoder below is hand-written to match the
 * Go's `strings.ToUpper` + strip-spaces + `=`-pad-to-a-multiple-of-8 behavior.
 *
 * SECURITY HYGIENE (D-08): this module NEVER logs the secret or the guess. The
 * TOTP secret must be stored to verify (inherent to TOTP; same trust level as
 * meshtk — documented, not a regression). The final code comparison routes
 * through a length-guarded `crypto.timingSafeEqual` (T-53-02-01 mitigation).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** meshtk defaults — period is 120s (NOT the RFC's 30s), digits 6, SHA1. */
const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD = 120;
const DEFAULT_ALGORITHM = "SHA1";
const DEFAULT_ISSUER = "Defcon.run";

export interface OtpConfig {
  secret: string;
  digits: number;
  period: number;
  algorithm: string;
  label: string;
  issuer: string;
}

export interface TotpOptions {
  digits?: number;
  period?: number;
}

export interface VerifyOptions extends TotpOptions {
  /** Number of periods on EACH side of `now` to accept. Defaults to 1. */
  skew?: number;
}

export interface AdjacentCodes {
  previous: string;
  current: string;
  next: string;
  /** Seconds remaining in the current period, in [1, period]. */
  remainingSeconds: number;
}

const RFC4648_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Hand-written RFC 4648 base32 decode. Mirrors the Go core: uppercase-normalize,
 * strip spaces, `=`-pad to a multiple of 8, then decode. Throws on any character
 * outside the alphabet (callers that must never throw wrap this in try/catch).
 */
function base32Decode(input: string): Buffer {
  let s = input.toUpperCase().replace(/\s+/g, "");
  // Pad with '=' to a multiple of 8 (matches the Go's manual padding).
  if (s.length % 8 !== 0) {
    s = s + "=".repeat(8 - (s.length % 8));
  }
  // Strip padding for the bit-accumulation loop.
  s = s.replace(/=+$/g, "");

  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    const idx = RFC4648_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error("invalid base32 character");
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** 8-byte big-endian counter (matches Go's binary.BigEndian.PutUint64). */
function counterBytes(counter: number): Buffer {
  const buf = Buffer.alloc(8);
  // counter fits comfortably in a JS safe integer for any realistic unix time.
  buf.writeBigUInt64BE(BigInt(counter));
  return buf;
}

/**
 * Generate the TOTP code for `secret` at absolute time `unixSeconds`.
 * counter = floor(unixSeconds / period); HMAC over the big-endian counter;
 * dynamic truncation; mod 10^digits; zero-padded to `digits`.
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

  // Dynamic truncation (RFC 4226 §5.3).
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);

  const code = bin % 10 ** digits;
  return code.toString().padStart(digits, "0");
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

/**
 * Parse an `otpauth://totp/<label>?secret=...` URL via the WHATWG URL parser.
 * Applies the meshtk defaults (digits 6, period 120, SHA1, issuer "Defcon.run")
 * when the query params are absent. Throws on a non-otpauth scheme, a non-totp
 * type, or a missing secret. Mirrors the Go NewOTPHandler contract.
 */
export function parseOtpauth(otpUrl: string): OtpConfig {
  const u = new URL(otpUrl);
  // URL parses the scheme as "otpauth:" (with trailing colon).
  if (u.protocol !== "otpauth:") {
    throw new Error(`invalid OTP URL scheme: ${u.protocol.replace(/:$/, "")}`);
  }
  if (u.host !== "totp") {
    throw new Error(`unsupported OTP type: ${u.host}`);
  }

  const label = decodeURIComponent(u.pathname.replace(/^\//, ""));
  const q = u.searchParams;

  const secret = q.get("secret") ?? "";
  if (!secret) {
    throw new Error("secret is required");
  }

  const digitsRaw = q.get("digits");
  const periodRaw = q.get("period");
  const digits = digitsRaw ? Number.parseInt(digitsRaw, 10) : DEFAULT_DIGITS;
  const period = periodRaw ? Number.parseInt(periodRaw, 10) : DEFAULT_PERIOD;
  if (!Number.isFinite(digits) || digits <= 0) {
    throw new Error(`invalid digits value: ${digitsRaw}`);
  }
  if (!Number.isFinite(period) || period <= 0) {
    throw new Error(`invalid period value: ${periodRaw}`);
  }

  const algorithm = (q.get("algorithm") ?? DEFAULT_ALGORITHM).toUpperCase();
  const issuer = q.get("issuer") ?? DEFAULT_ISSUER;

  return { secret, digits, period, algorithm, label, issuer };
}
