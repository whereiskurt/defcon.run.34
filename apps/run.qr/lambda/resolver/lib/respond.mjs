/**
 * ALB response builders for the q.defcon.run resolver Lambda.
 *
 * The resolver runs behind an ALB Lambda target, so every return value is
 * the ALB Lambda-target integration shape:
 *
 *   { statusCode, statusDescription?, headers, body? }
 *
 * These helpers are PURE — they take plain data and return that shape. No
 * AWS SDK, no I/O, no `process.env`.
 *
 * REGION IS NOT OUR JOB. `run.defcon.run` is region-partitioned under
 * `/use1`, `/cac1`, `/apse1`, but choosing and splicing that prefix is done by
 * a shared CloudFront region-prefix edge function on the run.defcon.run
 * distribution (geo / cookie / default lookup) — NOT here. The resolver emits
 * BARE `run.defcon.run/...` destinations and lets the edge prefix them. So
 * these builders do NO URL rewriting at all: the `Location` is whatever
 * destination they are handed, verbatim.
 *
 * The one load-bearing rule that stays: NO CACHING. Redirects are per-scan and
 * rule-driven (time windows, params), so every response is
 * `Cache-Control: no-store` to keep CloudFront / browsers from pinning a stale
 * destination.
 */

/**
 * Build a 302 redirect response to `destination`. The `Location` is the
 * destination VERBATIM — no rewriting, no region injection (the edge owns
 * region). Always `no-store`.
 *
 * @param {{ destination: string }} args
 * @returns {object} ALB response
 */
export function buildRedirect({ destination }) {
  return {
    statusCode: 302,
    statusDescription: "302 Found",
    headers: {
      Location: destination,
      "Cache-Control": "no-store",
    },
  };
}

/**
 * Build the CTF hand-off redirect. The resolver NEVER validates answers — it
 * simply forwards the scanned challenge + submitted value to run.defcon.run,
 * which owns scoring. The value is `encodeURIComponent`-escaped so arbitrary
 * guesses survive the query string intact. The destination is a BARE
 * `run.defcon.run` URL (no region segment) — the edge prefixes region.
 *
 * @param {{ challenge: string, value: string }} args
 * @returns {object} ALB response
 */
export function buildCtfHandoff({ challenge, value }) {
  const location =
    `https://run.defcon.run/ctf/claim` +
    `?c=${challenge}&v=${encodeURIComponent(value)}`;
  return {
    statusCode: 302,
    statusDescription: "302 Found",
    headers: {
      Location: location,
      "Cache-Control": "no-store",
    },
  };
}

/**
 * The catch-all "nothing matched" response: unknown code, disabled code,
 * empty path, or any parse failure. Small plain-text body.
 *
 * @returns {object} ALB response
 */
export function notFound() {
  return {
    statusCode: 404,
    statusDescription: "404 Not Found",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: "Not found\n",
  };
}
