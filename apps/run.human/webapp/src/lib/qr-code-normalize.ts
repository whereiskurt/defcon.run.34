/**
 * Lenient lookup key for an EXISTING QR code, of any shape.
 *
 * The strict `normalizeCode()` in qr-admin.ts is a WRITE guard — it rejects
 * anything outside the `CODE_RE` charset ([A-Za-z0-9_-]) and reserved names, so
 * new codes stay clean short links. But rows created OUTSIDE `upsertQr` (e.g. the
 * ☎ CTF codes, stored as their lowercase percent-encoded form like `%e2%98%8e`)
 * still exist in the table and must be viewable + deletable from /admin/qr.
 *
 * Read and delete paths key by this lenient form — trim + lowercase only,
 * matching ElectroDB's stored pk — so loading such a code returns the row (or
 * null) instead of throwing `QrValidationError` and crashing the server-rendered
 * edit page. Pure (no DynamoDB imports) so it is unit-testable in isolation.
 */
export function normalizeCodeKey(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}
