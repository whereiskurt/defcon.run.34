/**
 * Shared QR/CTF admin error type.
 *
 * Extracted into its own dependency-free module so PURE helpers (e.g.
 * lib/ctf-flag-types.ts) can throw it WITHOUT importing lib/qr-admin.ts and
 * thereby transitively pulling in the electro client. lib/qr-admin.ts re-exports
 * this symbol, so existing `import { QrValidationError } from "@/lib/qr-admin"`
 * call sites are unchanged.
 */

/** Thrown for any user-correctable bad input. Route maps it to HTTP 400. */
export class QrValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QrValidationError";
  }
}
