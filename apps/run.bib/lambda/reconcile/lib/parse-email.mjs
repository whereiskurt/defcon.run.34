/**
 * Email parsing helper for the bib-reconcile Lambda.
 *
 * Wraps `mailparser` so `index.mjs` only sees the fields it needs:
 *   - `bodyText`: plain-text body (Haiku input)
 *   - `messageId`: raw Message-ID header (for idempotence hashing)
 *   - `from`: parsed From address (for sender-based fallback matching)
 *   - `subject`: subject line (helps Haiku disambiguate provider on edge cases)
 *   - `date`: parsed Date header, epoch ms (for receivedAt column)
 *
 * Body trimming: cap at BODY_TRIM_CHARS (10k) so Venmo/CashApp legal-footer
 * boilerplate doesn't inflate token count. Real Venmo/CashApp receipts are
 * <2k chars in the meaningful section; 10k is 5x safety margin.
 */

import { simpleParser } from "mailparser";

/**
 * Character cap on body text sent to Haiku. AI-SPEC §"Implementation notes":
 * "Trim body to first 10k chars (token efficiency; email footers full of
 * legal copy)."
 */
export const BODY_TRIM_CHARS = 10000;

/**
 * Parse a raw MIME buffer (as delivered by SES to S3) into the fields the
 * reconciliation Lambda needs.
 *
 * @param {Buffer|Uint8Array|string} raw - Raw MIME bytes.
 * @returns {Promise<{
 *   bodyText: string,
 *   messageId: string|null,
 *   from: {name: string, address: string}|null,
 *   subject: string|null,
 *   receivedAtMs: number,
 * }>}
 */
export async function parseReceiptEmail(raw) {
  const parsed = await simpleParser(raw);

  // Prefer text/plain; fall back to text extracted from HTML.
  const rawBody =
    (typeof parsed.text === "string" && parsed.text.trim().length > 0
      ? parsed.text
      : parsed.textAsHtml || "") || "";

  const bodyText = rawBody.slice(0, BODY_TRIM_CHARS);

  // Extract first From address (mailparser normalizes multi-address headers).
  const fromEntry = parsed.from?.value?.[0];
  const from = fromEntry
    ? {
        name: fromEntry.name || "",
        address: fromEntry.address || "",
      }
    : null;

  return {
    bodyText,
    messageId: parsed.messageId ?? null,
    from,
    subject: parsed.subject ?? null,
    receivedAtMs: parsed.date instanceof Date ? parsed.date.getTime() : Date.now(),
  };
}
