import { timingSafeEqual } from "node:crypto";

/**
 * Admin "test scan" detection.
 *
 * A scan carrying a valid `x-qr-test` header should redirect exactly as normal
 * but MUST NOT be logged — so the rollup never counts it and analytics stay
 * clean while an operator verifies a live code. The secret token lives in SSM
 * and is injected as the resolver's `QR_TEST_TOKEN` env var by Terraform; pass
 * `process.env.QR_TEST_TOKEN` as `token`.
 *
 * SECURITY:
 *  - When `token` is unset/empty the feature is OFF and this ALWAYS returns
 *    false, so production scans are always logged (fail-safe default).
 *  - Constant-time compare (with an equal-length guard, since timingSafeEqual
 *    throws on unequal lengths) avoids leaking the token via a timing oracle.
 *
 * Pure and total — no I/O, never throws.
 *
 * @param {Record<string,string>|undefined} headers ALB single-value headers (keys lowercased by ALB)
 * @param {string|undefined} token the configured QR_TEST_TOKEN (env)
 * @returns {boolean}
 */
export function isTestRequest(headers, token) {
  if (!token) return false;
  const got = headers?.["x-qr-test"];
  if (typeof got !== "string" || got.length === 0) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
