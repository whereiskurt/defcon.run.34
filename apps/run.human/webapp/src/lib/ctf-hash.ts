/**
 * CTF answer hashing seam (CTF-04) — Node `crypto` only, no new dependency.
 *
 * Goal (per 44-CONTEXT §Hashing & hygiene): "a table leak doesn't hand over
 * flags" — NOT password-grade KDF. We store a salted SHA-256 hex digest of the
 * normalized answer. The raw answer never appears in the digest.
 *
 * Salt choice: a per-app static salt sourced from `process.env.CTF_ANSWER_SALT`
 * with an in-code default fallback. This is deliberate and documented — a static
 * app salt defeats generic rainbow tables for a table read, which is the stated
 * threat. Upgrading to a per-answer salt or an actual KDF (scrypt/argon2) later
 * is a single-file change confined to this module.
 */

import { createHash, timingSafeEqual } from "crypto";

/**
 * Documented default salt. Overridable via CTF_ANSWER_SALT so a rotation does
 * not require a code change. If you rotate the salt, existing `answerHash` rows
 * must be re-hashed (they become unverifiable otherwise).
 */
const DEFAULT_SALT = "dc34-ctf-answer-salt-v1";

function salt(): string {
  return process.env.CTF_ANSWER_SALT || DEFAULT_SALT;
}

/**
 * Normalize an answer/guess: trim + lowercase — same rule the challenge names
 * use (see qr-admin.normalizeChallenge), so answers are case/space-insensitive.
 */
function normalizeAnswer(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}

/** Salted SHA-256 hex of the normalized answer. Deterministic; raw is not recoverable. */
export function hashAnswer(raw: string): string {
  return createHash("sha256")
    .update(`${salt()}:${normalizeAnswer(raw)}`)
    .digest("hex");
}

/**
 * Constant-time compare of hashAnswer(guess) against a stored answerHash.
 * Returns false (never throws) when answerHash is empty or a different length
 * than the computed digest. Never logs `guess`.
 */
export function verifyAnswer(guess: string, answerHash: string): boolean {
  if (!answerHash) return false;
  const computed = Buffer.from(hashAnswer(guess), "utf8");
  const stored = Buffer.from(answerHash, "utf8");
  if (computed.length !== stored.length) return false; // timingSafeEqual requires equal length
  return timingSafeEqual(computed, stored);
}
