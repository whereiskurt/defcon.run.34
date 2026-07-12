/**
 * Query-string enrichment for a resolved destination URL.
 *
 * Once `rules.mjs` has chosen a destination, the resolver may decorate it with:
 *
 *   - `preserveQuery` — carry the scanner's incoming query params onto the
 *     destination, so a `?utm_source=poster` on the short link survives the
 *     redirect. The DESTINATION's own params always win on a key collision
 *     (they are only copied in when absent).
 *   - `appendParam`   — expose the path param as `?p=<param>` (when non-null),
 *     so the landing page can read the second path segment as a query arg.
 *   - `utm`           — stamp campaign attribution (`utm_source/medium/campaign`)
 *     for any subkey that is defined.
 *
 * Built on the WHATWG `URL`. Defensive: if `destination` is not an absolute,
 * parseable URL, it is returned unchanged (a relative or malformed destination
 * is passed through so the redirect layer decides what to do with it).
 */

/**
 * @param {string} destination  Absolute destination URL (or passthrough).
 * @param {{
 *   originalQuery?: string,
 *   param?: string|null,
 *   enrich?: {
 *     preserveQuery?: boolean,
 *     appendParam?: boolean,
 *     utm?: { source?: string, medium?: string, campaign?: string },
 *   },
 * }} [opts]
 * @returns {string}
 */
export function enrichDestination(
  destination,
  { originalQuery = "", param = null, enrich = {} } = {}
) {
  let url;
  try {
    url = new URL(destination);
  } catch {
    // Not an absolute/parseable URL — pass through untouched (defensive).
    return destination;
  }

  // preserveQuery: copy incoming params in, but never clobber the dest's own.
  if (enrich.preserveQuery && originalQuery) {
    const incoming = new URLSearchParams(originalQuery);
    for (const [key, value] of incoming) {
      if (!url.searchParams.has(key)) {
        url.searchParams.append(key, value);
      }
    }
  }

  // appendParam: surface the path param as ?p=<param> (non-null only).
  if (enrich.appendParam && param != null) {
    url.searchParams.set("p", String(param));
  }

  // utm: stamp each defined attribution subkey.
  if (enrich.utm) {
    if (enrich.utm.source != null) {
      url.searchParams.set("utm_source", enrich.utm.source);
    }
    if (enrich.utm.medium != null) {
      url.searchParams.set("utm_medium", enrich.utm.medium);
    }
    if (enrich.utm.campaign != null) {
      url.searchParams.set("utm_campaign", enrich.utm.campaign);
    }
  }

  return url.toString();
}
