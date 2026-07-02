/**
 * Deterministic receiptId for BibReconcile idempotence.
 *
 * The reconciliation Lambda is invoked once per SES-written S3 object. SES
 * delivers a raw MIME message per email, so under normal operation the
 * Message-ID header uniquely identifies the payment notification. Hashing
 * the Message-ID gives a stable receiptId that survives Lambda retries
 * (SDK-level exponential backoff on 5xx, at-least-once S3 event delivery,
 * etc.). Two identical Message-IDs → identical receiptId → BibReconcile
 * create issues a PutItem with an attribute_not_exists condition and the
 * second call returns "already processed".
 *
 * Fallback: when the email has no Message-ID header (rare — Venmo /
 * CashApp always set one — but junk / malformed emails might not), hash
 * the S3 bucket/key pair instead. That's still stable across retries of
 * the same S3 object.
 */

import { createHash } from "node:crypto";

/**
 * Build a deterministic receiptId from an email Message-ID.
 *
 * @param {string|null|undefined} messageId  Raw Message-ID header value
 *   (with or without angle brackets — mailparser strips them, we strip
 *   defensively too).
 * @returns {string|null} 64-char hex sha256 hash prefixed with `mid_`, or
 *   null if `messageId` is missing/blank.
 */
export function receiptIdFromMessageId(messageId) {
  if (typeof messageId !== "string") return null;
  const cleaned = messageId.trim().replace(/^<|>$/g, "");
  if (cleaned.length === 0) return null;
  return "mid_" + createHash("sha256").update(cleaned).digest("hex");
}

/**
 * Build a receiptId from an S3 bucket+key pair. Used only when the source
 * email has no Message-ID header.
 */
export function receiptIdFromS3Object(bucket, key) {
  const src = `${bucket ?? ""}\0${key ?? ""}`;
  return "s3_" + createHash("sha256").update(src).digest("hex");
}

/**
 * Composite helper: prefer Message-ID, fall back to S3 coordinate.
 */
export function deriveReceiptId({ messageId, bucket, key }) {
  return (
    receiptIdFromMessageId(messageId) ?? receiptIdFromS3Object(bucket, key)
  );
}
