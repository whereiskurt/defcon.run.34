/**
 * ctf-otp-core.ts — dependency-free TOTP primitives (RFC 6238 / 4226).
 *
 * This module is the platform-NEUTRAL half of the CTF OTP core. It imports
 * NOTHING node-only (no node crypto module, no node byte-buffer type) so it
 * bundles cleanly into a "use client" browser component. It provides:
 *   - base32Decode      → Uint8Array (RFC 4648, matches the meshtk Go behavior)
 *   - counterBytes      → 8-byte big-endian counter as a Uint8Array (DataView)
 *   - truncateHotp      → RFC 4226 §5.3 dynamic truncation + zero-pad formatter
 *   - parseOtpauth      → WHATWG-URL parse of an otpauth:// URL (already node-free)
 *   - DEFAULT_* consts + the shared OtpConfig/TotpOptions/VerifyOptions/AdjacentCodes types
 *
 * The node server surface (`ctf-otp.ts`) re-exports the types + parseOtpauth from
 * here and builds `totpAt`/`verifyTotp` on these primitives with node crypto.
 * The browser client (`ctf-otp-client.ts`) builds `adjacentCodesAsync` on these
 * primitives with the Web Crypto API. Both paths therefore share ONE audited
 * base32 decoder, counter encoder, and truncation formatter — no re-implementation.
 *
 * PORT SOURCE (behavioral parity): `~/working/meshtk/pkg/otp/totp.go`.
 */

/** meshtk defaults — period is 120s (NOT the RFC's 30s), digits 6, SHA1. */
export const DEFAULT_DIGITS = 6;
export const DEFAULT_PERIOD = 120;
export const DEFAULT_ALGORITHM = "SHA1";
export const DEFAULT_ISSUER = "Defcon.run";

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
  /**
   * HMAC hash algorithm ("SHA1" | "SHA256" | "SHA512"). Defaults to SHA1. The
   * browser client (`ctf-otp-client.ts`) honors this so a non-SHA1 enrollment URL
   * still reveals codes (WR-02). The node server (`ctf-otp.ts`) currently ignores
   * it and remains SHA1-only (deferred phase-53 WR-03); passing a non-SHA1
   * algorithm to the client while the server stays SHA1 would break verification,
   * so keep the two in step when the server gains multi-algorithm support.
   */
  algorithm?: string;
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
 * Hand-written RFC 4648 base32 decode → Uint8Array (a plain typed array, so this
 * is browser-safe). Mirrors the Go core: uppercase-normalize, strip spaces,
 * `=`-pad to a multiple of 8, then decode. Throws on any character outside the
 * alphabet (callers that must never throw wrap this in try/catch).
 */
export function base32Decode(input: string): Uint8Array<ArrayBuffer> {
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
  return Uint8Array.from(bytes);
}

/**
 * 8-byte big-endian counter → Uint8Array (matches Go's binary.BigEndian.PutUint64).
 * Uses DataView.setBigUint64 (browser-safe) instead of the node-only writer.
 */
export function counterBytes(counter: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  // counter fits comfortably in a JS safe integer for any realistic unix time.
  view.setBigUint64(0, BigInt(counter), false); // false = big-endian
  return buf;
}

/**
 * RFC 4226 §5.3 dynamic truncation applied to an HMAC byte array, reduced to
 * `digits` and zero-padded. Works on any Uint8Array byte view (the node byte
 * container is a Uint8Array subclass), so both the node and Web Crypto paths
 * share it.
 */
export function truncateHotp(mac: Uint8Array, digits: number): string {
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
 * Parse an `otpauth://totp/<label>?secret=...` URL via the WHATWG URL parser.
 * Applies the meshtk defaults (digits 6, period 120, SHA1, issuer "Defcon.run")
 * when the query params are absent. Throws on a non-otpauth scheme, a non-totp
 * type, or a missing secret. Mirrors the Go NewOTPHandler contract. Already
 * node-free (uses only the global URL), so it lives in the shared core.
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

/**
 * Build an `otpauth://totp/<issuer>:<account>?secret=…` enrollment URL — the
 * inverse of {@link parseOtpauth}. Applies the same meshtk defaults (digits 6,
 * period 120, SHA1, issuer "Defcon.run") when a field is omitted, uppercases the
 * algorithm (matching parse), and percent-encodes the issuer/account label
 * segments so the URL survives a round-trip. The base32 `secret` needs no
 * escaping (RFC 4648 alphabet only). Node-free (uses only URLSearchParams +
 * encodeURIComponent), so it bundles into the client.
 *
 * `label` is the authenticator ACCOUNT name (defaults to the issuer). Only
 * secret/digits/period/algorithm affect the generated codes — label/issuer are
 * cosmetic, so a URL rebuilt from a stored secret enrolls identically to the
 * admin's original paste even though the label may differ.
 */
export function buildOtpauth(config: {
  secret: string;
  digits?: number;
  period?: number;
  algorithm?: string;
  label?: string;
  issuer?: string;
}): string {
  const { secret } = config;
  if (!secret) {
    throw new Error("secret is required");
  }
  const digits = config.digits ?? DEFAULT_DIGITS;
  const period = config.period ?? DEFAULT_PERIOD;
  const algorithm = (config.algorithm ?? DEFAULT_ALGORITHM).toUpperCase();
  const issuer = config.issuer ?? DEFAULT_ISSUER;
  const account = config.label ?? issuer;

  // Canonical "<issuer>:<account>" label with a LITERAL colon; each side is
  // percent-encoded independently so spaces/reserved chars can't break parsing.
  const labelPath = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;

  const params = new URLSearchParams();
  params.set("secret", secret);
  params.set("issuer", issuer);
  params.set("algorithm", algorithm);
  params.set("digits", String(digits));
  params.set("period", String(period));

  return `otpauth://totp/${labelPath}?${params.toString()}`;
}
