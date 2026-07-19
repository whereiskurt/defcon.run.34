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
 * REGION PREFIXING (pragmatic, resolver-side). `run.defcon.run` is region-
 * partitioned under `/use1`, `/cac1`, `/apse1` (Next.js basePath), so a bare
 * `run.defcon.run/orderform` 404s — it needs a region segment. Ideally a shared
 * CloudFront edge function would add that on the run.defcon.run distribution,
 * but that distro is an intricate mixed-origin setup (S3 landing + assets + CMS
 * media + ALB app + default_root_object), so region-prefixing there is a risky
 * prod-site change. Since ONLY `use1` serves today (cac1/apse1 are skip_regions),
 * we instead prefix `/use1` HERE, for `run.defcon.run` destinations only, and
 * leave every other host untouched. When multi-region actually arrives, revisit
 * and move this to a properly-scoped edge function. See the spec-corrections doc.
 *
 * The one load-bearing rule that stays: NO CACHING. Redirects are per-scan and
 * rule-driven (time windows, params), so every response is
 * `Cache-Control: no-store` to keep CloudFront / browsers from pinning a stale
 * destination.
 */

// The one region that serves today. run.human is basePath-mounted per region;
// this is the only valid prefix until cac1/apse1 un-skip.
const DEFAULT_REGION = "use1";

// The one host we region-partition. Compared against `URL.hostname` (lowercased
// + punycoded by the parser), so a lookalike like `run.defcon.run.evil.com`
// will not match.
const REGION_HOST = "run.defcon.run";

// Path prefixes that already encode a region — presence of any means we must
// NOT prefix again (idempotent). Matched as whole leading path segments.
const REGION_SEGMENTS = ["use1", "cac1", "apse1"];

/**
 * Splice `/<DEFAULT_REGION>` into a `run.defcon.run` destination that lacks a
 * region segment. Any other host — and anything that fails to parse as an
 * absolute URL — is returned unchanged (defensive: never mangle a third-party
 * URL or throw on malformed data).
 *
 * @param {string} destination
 * @returns {string}
 */
export function withRegion(destination) {
  let url;
  try {
    url = new URL(destination);
  } catch {
    return destination; // not absolute-parseable → pass through
  }
  if (url.hostname !== REGION_HOST) return destination;

  // `url.pathname` is always leading-slash; first segment is split()[1].
  const first = url.pathname.split("/")[1];
  if (REGION_SEGMENTS.includes(first)) return destination; // already prefixed

  const rest = url.pathname === "/" ? "" : url.pathname;
  return `${url.protocol}//${url.host}/${DEFAULT_REGION}${rest}${url.search}${url.hash}`;
}

/**
 * Build a 302 redirect response to `destination`. `run.defcon.run` destinations
 * get `/use1` spliced in (via `withRegion`); every other host is emitted
 * verbatim. Always `no-store`.
 *
 * @param {{ destination: string }} args
 * @returns {object} ALB response
 */
export function buildRedirect({ destination }) {
  return {
    statusCode: 302,
    statusDescription: "302 Found",
    headers: {
      Location: withRegion(destination),
      "Cache-Control": "no-store",
    },
  };
}

/**
 * Build the CTF hand-off redirect. The resolver NEVER validates answers — it
 * simply forwards the scanned challenge + submitted value to run.defcon.run,
 * which owns scoring. The value is `encodeURIComponent`-escaped so arbitrary
 * guesses survive the query string intact. The claim target is region-prefixed
 * (`/use1`) since it lives on run.defcon.run.
 *
 * @param {{ challenge: string, value: string }} args
 * @returns {object} ALB response
 */
export function buildCtfHandoff({ challenge, value }) {
  const location =
    `https://run.defcon.run/${DEFAULT_REGION}/ctf/claim` +
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
 * Build the crawler-facing unfurl response: a 200 HTML card. `no-store` because
 * the embedded forward destination is rule-driven and must not be pinned. The
 * HTML is pre-rendered by `unfurl.mjs` (this builder stays pure — no templating,
 * no fs). Only recognized crawlers ever reach this; humans get `buildRedirect`.
 *
 * @param {{ html: string }} args
 * @returns {object} ALB response
 */
export function buildUnfurl({ html }) {
  return {
    statusCode: 200,
    statusDescription: "200 OK",
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: html,
  };
}

/**
 * Build the unfurl `og:image` response: a 200 PNG served from the Lambda bundle.
 * The body is already base64 (loaded by `unfurl.mjs`), flagged with
 * `isBase64Encoded` so the ALB integration returns raw bytes. Unlike redirects
 * this IS cacheable — the art is static per theme — so a day-long `max-age`
 * spares the Lambda repeated crawler fetches.
 *
 * @param {{ base64: string }} args
 * @returns {object} ALB response
 */
export function buildOgImage({ base64 }) {
  return {
    statusCode: 200,
    statusDescription: "200 OK",
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
    body: base64,
    isBase64Encoded: true,
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
