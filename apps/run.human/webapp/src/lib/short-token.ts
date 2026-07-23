/**
 * Short runner token: first 16 hex chars of the per-user sha256 `hash`.
 * Deterministic — run.human and run.bib can derive it independently and never
 * disagree. Encoded in the runner QR as `https://q.<domain>/r/<token>`.
 * Client-safe: pure string code, no node imports.
 */

export const TOKEN_RE = /^[0-9a-f]{16}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

export function shortTokenFromHash(hash: string): string {
  if (!HASH_RE.test(hash)) {
    throw new Error("shortTokenFromHash: expected 64-char lowercase hex sha256");
  }
  return hash.slice(0, 16);
}
