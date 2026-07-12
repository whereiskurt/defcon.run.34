/**
 * ALB response builders for the q.defcon.run resolver Lambda.
 *
 * The resolver runs behind an ALB Lambda target, so every return value is
 * the ALB Lambda-target integration shape:
 *
 *   { statusCode, statusDescription?, headers, body? }
 *
 * These helpers are PURE — they take plain data and return that shape. No
 * AWS SDK, no I/O, no `process.env`. All URL work goes through the WHATWG
 * `URL` global so parsing/serialization matches the browser exactly.
 *
 * Two load-bearing rules live here:
 *
 *   1. Region injection. `run.defcon.run` is region-partitioned under
 *      `/use1` and `/cac1`. A bare `run.defcon.run/...` destination gets the
 *      resolver's region spliced in right after the host — UNLESS the path
 *      already carries a region segment. Any OTHER host is passed through
 *      byte-for-byte (we never rewrite third-party or lookalike hosts).
 *
 *   2. No caching. Redirects are per-scan and rule-driven (time windows,
 *      params), so every response is `Cache-Control: no-store` to keep
 *      CloudFront / browsers from pinning a stale destination.
 */

// The one host we own and region-partition. Compared against `URL.hostname`
// (already lowercased + punycoded by the URL parser), so a lookalike like
// `run.defcon.run.attacker.com` will not match.
const REGION_HOST = "run.defcon.run";

// Path prefixes that already encode a region — presence of either means we
// must NOT inject again. Matched as whole leading path segments.
const REGION_SEGMENTS = ["use1", "cac1"];

/**
 * Resolve the serving region from an opaque hint (e.g. a CloudFront-supplied
 * header). This is a deliberately tiny seam: the resolver only ever serves
 * two regions and defaults to `use1`. Only an exact `"cac1"` flips it.
 *
 * @param {string|undefined|null} hint
 * @returns {"use1"|"cac1"}
 */
export function resolveRegion(hint) {
  return hint === "cac1" ? "cac1" : "use1";
}

/**
 * True when `pathname` (a `URL.pathname`, always leading-slash) already
 * begins with a region segment like `/use1` or `/cac1` — i.e. `/use1`,
 * `/use1/...`, but NOT `/use1234/...` (that is a different segment).
 */
function hasRegionSegment(pathname) {
  return REGION_SEGMENTS.some(
    (seg) => pathname === `/${seg}` || pathname.startsWith(`/${seg}/`)
  );
}

/**
 * Compute the final `Location` value for a redirect, applying region
 * injection only when the destination is our region-partitioned host and
 * does not already carry a region segment.
 *
 * Non-`run.defcon.run` destinations — and anything that fails to parse as an
 * absolute URL — are returned unchanged (defensive: we never want to mangle
 * a third-party URL or throw on malformed data).
 */
function locationFor(destination, region) {
  let url;
  try {
    url = new URL(destination);
  } catch {
    // Not absolute-parseable → pass through untouched.
    return destination;
  }

  if (url.hostname !== REGION_HOST) return destination;
  if (hasRegionSegment(url.pathname)) return destination;

  // Splice `/<region>` in right after the host, preserving the remaining
  // path, query, and fragment exactly.
  return `${url.protocol}//${url.host}/${region}${url.pathname}${url.search}${url.hash}`;
}

/**
 * Build a 302 redirect response to `destination`, region-injected per
 * `locationFor`. Always `no-store`.
 *
 * @param {{ destination: string, region?: "use1"|"cac1" }} args
 * @returns {object} ALB response
 */
export function buildRedirect({ destination, region = "use1" }) {
  return {
    statusCode: 302,
    statusDescription: "302 Found",
    headers: {
      Location: locationFor(destination, region),
      "Cache-Control": "no-store",
    },
  };
}

/**
 * Build the CTF hand-off redirect. The resolver NEVER validates answers — it
 * simply forwards the scanned challenge + submitted value to run.defcon.run,
 * which owns scoring. The value is `encodeURIComponent`-escaped so arbitrary
 * guesses survive the query string intact.
 *
 * @param {{ challenge: string, value: string, region?: "use1"|"cac1" }} args
 * @returns {object} ALB response
 */
export function buildCtfHandoff({ challenge, value, region = "use1" }) {
  const location =
    `https://run.defcon.run/${region}/ctf/claim` +
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
