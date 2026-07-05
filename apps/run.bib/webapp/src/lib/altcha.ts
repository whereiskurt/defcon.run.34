import { createChallenge, verifySolution } from "altcha-lib/v1";

/**
 * ALTCHA proof-of-work friction (Kurt 2026-07-03).
 *
 * Self-hosted (no external service) PoW gate on bib mutations. The server
 * issues an HMAC-signed challenge; the browser solves it (SHA-256 search),
 * and the /api/bib PATCH verifies the solution before applying. Friction is
 * tuned per action via `maxNumber`:
 *   - save   → ~5s   (bib-name change)
 *   - toggle → ~1-2s (pay-in-person pledge)
 * (Solve time is device-dependent; these are approximate.)
 *
 * HMAC key: reuses the bib container's existing AUTH_INTERNAL_SECRET (also
 * accepts AUTH_JWT_SECRET, or an explicit BIB_ALTCHA_HMAC_KEY override) so no
 * new SSM param / IAM change is required. The key is server-only, never sent
 * to the client. Fail-closed: if no key is configured, challenges/verifies
 * throw and mutations are rejected.
 */

export type AltchaLevel = "save" | "toggle";

// maxNumber bounds the PoW search space → controls average solve time.
const MAX_NUMBER: Record<AltchaLevel, number> = {
  save: 500_000, // ~2.5s target (Kurt 2026-07-05: halved from 1_000_000)
  toggle: 200_000, // ~1-2s target (unused now — toggle no longer solves ALTCHA)
};

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // solutions must be used within 5 min

function hmacKey(): string {
  const key =
    process.env.BIB_ALTCHA_HMAC_KEY ||
    process.env.AUTH_INTERNAL_SECRET ||
    process.env.AUTH_JWT_SECRET;
  if (!key) {
    throw new Error("[altcha] no HMAC key configured (AUTH_INTERNAL_SECRET)");
  }
  return key;
}

/** Issue an HMAC-signed challenge for the given friction level. */
export async function createBibChallenge(level: AltchaLevel) {
  return createChallenge({
    hmacKey: hmacKey(),
    maxNumber: MAX_NUMBER[level],
    expires: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
}

/**
 * Verify a base64 ALTCHA payload. Returns false (never throws) on any bad /
 * missing / expired / tampered solution so the caller can 400 cleanly.
 */
export async function verifyBibSolution(
  payload: string | undefined | null
): Promise<boolean> {
  if (!payload) return false;
  try {
    return await verifySolution(payload, hmacKey());
  } catch {
    return false;
  }
}
