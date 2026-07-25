/**
 * mesh-otp-derive.ts — Node twin of meshtk's server-secret TOTP derivation
 * (upstream `pkg/otp/derive.go`, whereiskurt/meshtk#10). The fleet rewrites each
 * ghost's committed `OtpUrl` secret at startup; this module reproduces that
 * derivation so /admin/ghosts can reveal the seed the DEPLOYED bot actually
 * validates. The committed YAML value is only an HKDF input (a decoy).
 *
 * MUST stay bit-for-bit identical to the Go side:
 *   info    = "meshtk-otp-seed:" + fleetId + ":" + committedSecret
 *   key     = HKDF-SHA256(ikm = serverSecret, salt = empty, info, 20 bytes)
 *   secret  = RFC 4648 base32, UPPERCASE, no padding (32 chars)
 * (Node hkdfSync with a zero-length salt ≡ Go crypto/hkdf nil salt — HMAC
 * zero-pads both to the block size; the shared vectors in the vitest prove it.)
 *
 * SECURITY: takes the server secret as an argument (callers read
 * process.env.MESHTK_GHOST_KEY_SECRET); never logs secrets; results are only
 * surfaced through the admin-gated ghost_otp_reveal action.
 */
import { hkdfSync } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, uppercase, no padding (encode twin of ctf-otp-core's base32Decode). */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** The real TOTP secret a derivation-enabled bot validates (see module header). */
export function deriveTotpSecret(
  serverSecret: string,
  fleetId: string,
  committedSecret: string,
): string {
  const info = `meshtk-otp-seed:${fleetId}:${committedSecret}`;
  const key = hkdfSync(
    "sha256",
    Buffer.from(serverSecret),
    Buffer.alloc(0),
    Buffer.from(info),
    20,
  );
  return base32Encode(new Uint8Array(key));
}

/**
 * The real covert flag code a derivation-enabled bot reveals (meshtk#11), from
 * the committed (decoy) flag code. MUST match Go's `DeriveFlagCode` bit-for-bit:
 * HKDF-SHA256(serverSecret, salt=∅, info=`meshtk-flag-code:<fleetId>:<committed>`,
 * 5 bytes) → 8-char unpadded uppercase base32. Distinct info label from the OTP
 * seed so the two never collide.
 */
export function deriveFlagCode(
  serverSecret: string,
  fleetId: string,
  committedFlag: string,
): string {
  const info = `meshtk-flag-code:${fleetId}:${committedFlag}`;
  const key = hkdfSync(
    "sha256",
    Buffer.from(serverSecret),
    Buffer.alloc(0),
    Buffer.from(info),
    5,
  );
  return base32Encode(new Uint8Array(key));
}

/**
 * The CHAIN seed for a ghost's `<persona>-otp` CTF flag — deliberately a
 * DIFFERENT derivation (distinct HKDF info label) from the bot's unlock seed
 * (`deriveTotpSecret`), so the CTF reward enrollment never discloses the
 * credential that unlocks the ghost's DM chat. Node-only: the Go fleet never
 * derives or validates this seed. Same shape as the unlock seed (20 bytes →
 * 32-char unpadded uppercase base32).
 */
export function deriveChainTotpSecret(
  serverSecret: string,
  fleetId: string,
  committedSecret: string,
): string {
  const info = `meshtk-chain-seed:${fleetId}:${committedSecret}`;
  const key = hkdfSync(
    "sha256",
    Buffer.from(serverSecret),
    Buffer.alloc(0),
    Buffer.from(info),
    20,
  );
  return base32Encode(new Uint8Array(key));
}

/** Shared otpauth-URL secret swap for the two derivations below. */
function swapOtpauthSecret(
  committedOtpauth: string,
  derive: (committedSecret: string) => string,
): { otpauth: string; secret: string; committedSecret: string } {
  const u = new URL(committedOtpauth);
  if (u.protocol !== "otpauth:") {
    throw new Error(`not an otpauth url: ${u.protocol}`);
  }
  const committedSecret = u.searchParams.get("secret");
  if (!committedSecret) throw new Error("otp url has no secret param");
  const secret = derive(committedSecret);
  u.searchParams.set("secret", secret);
  return { otpauth: u.toString(), secret, committedSecret };
}

/**
 * Committed otpauth URL → { derived otpauth, derived secret, committed secret }
 * for the bot's UNLOCK seed. Only the `secret=` query param changes —
 * label/issuer/digits/period/algorithm pass through so authenticator
 * enrollments keep their display identity (same contract as Go's DeriveOtpUrl).
 * Throws on a malformed URL or missing secret.
 */
export function deriveOtpauthUrl(
  serverSecret: string,
  fleetId: string,
  committedOtpauth: string,
): { otpauth: string; secret: string; committedSecret: string } {
  return swapOtpauthSecret(committedOtpauth, (committed) =>
    deriveTotpSecret(serverSecret, fleetId, committed),
  );
}

/** Chain-seed twin of `deriveOtpauthUrl` (see `deriveChainTotpSecret`). */
export function deriveChainOtpauthUrl(
  serverSecret: string,
  fleetId: string,
  committedOtpauth: string,
): { otpauth: string; secret: string; committedSecret: string } {
  return swapOtpauthSecret(committedOtpauth, (committed) =>
    deriveChainTotpSecret(serverSecret, fleetId, committed),
  );
}
