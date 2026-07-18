/**
 * Lenient lookup key for a QR code: trim + lowercase, matching ElectroDB's
 * lowercased pk composite. Unlike the strict normalizeCode() write guard in
 * qr-admin.ts (CODE_RE + reserved names), this never throws — so the admin can
 * read/delete EXISTING rows of any shape, not just newly-created clean codes.
 */
export function normalizeCodeKey(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}

/** Best-effort percent-decode. Returns the input unchanged if it is not a valid
 * percent-encoding (decodeURIComponent throws on e.g. "50%off"). */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Candidate lookup keys for a code, most-literal first, deduped.
 *
 * Some rows are inconsistent: their DynamoDB pk was composed from the DECODED
 * value while their `code` attribute stores the percent-ENCODED string. The ☎
 * CTF codes are the live example — pk `$run#code_☎️`, attribute
 * `%e2%98%8e%ef%b8%8f` (they resolve fine on a real scan, because the ALB
 * decodes the path, but the admin only ever holds the percent attribute). A
 * lookup keyed only by the attribute composes `$run#code_%e2%98%8e%ef%b8%8f`
 * and misses → 404.
 *
 * Returning both the literal key and its percent-decoded form lets reads/deletes
 * hit the row whichever way its pk was composed — no need to know which form a
 * given row used. Normal codes (no `%`) yield a single candidate.
 */
export function codeKeyCandidates(raw: string): string[] {
  const asIs = normalizeCodeKey(raw);
  const decoded = normalizeCodeKey(safeDecode(raw));
  return decoded === asIs ? [asIs] : [asIs, decoded];
}
