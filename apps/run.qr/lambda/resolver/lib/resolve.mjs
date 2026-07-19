/**
 * Resolver core for the q.defcon.run short-link / QR front-door.
 *
 * `resolve` is the single pure orchestration seam: it takes the already-parsed
 * request target (path + headers) plus a monotonic `nowMs`, and returns an ALB
 * Lambda-target response. All the moving parts it composes are their own pure
 * modules — this function only wires them together in the fixed order:
 *
 *   parsePath ─▶ classify ─▶
 *     empty / flush     → notFound()          (nothing to serve here)
 *     ogimage           → buildOgImage         (bundled unfurl preview PNG)
 *     ctf               → buildCtfHandoff      (forward the guess, never score)
 *     redirect          → getQr → rules → enrich →
 *         crawler + item.unfurl → buildUnfurl  (OG card, code-free)
 *         otherwise             → buildRedirect
 *
 * Two properties are load-bearing:
 *
 *   1. NEVER THROWS. Every branch — including a `getQr` that rejects, a garbage
 *      destination, or a malformed header — degrades to `notFound()`. A QR at a
 *      con is scanned by strangers; a 404 is always better than a 502.
 *
 *   2. NO SIDE EFFECTS beyond the injected `log`. The DynamoDB read is injected
 *      as `deps.getQr` (index.mjs supplies the warm-cached GetItem) and the log
 *      sink is injected as `deps.log` (defaults to `emit`), so the whole flow is
 *      drivable from a unit test with a fake `getQr` and a capturing `log`.
 *
 * REGION PREFIXING happens in `respond.mjs` (`buildRedirect`/`buildCtfHandoff`):
 * `run.defcon.run` destinations get `/use1` spliced in, since only use1 serves
 * today and run.human is basePath-mounted per region. The resolver does not read
 * or log region — it's a fixed prefix on the response side. See respond.mjs for
 * the why (the run.defcon.run distro is mixed-origin, so edge-prefixing there is
 * a riskier separate project).
 *
 * Header seams (analytics only — region is NOT read here):
 *   - `user-agent`   — copied verbatim into the redirect log line (`ua`).
 *   - `cloudfront-viewer-country` — copied into the log line as `geo`.
 *   ALB lowercases header names, so these are matched lowercase.
 */

import { parsePath } from "./parse-path.mjs";
import { resolveDestination } from "./rules.mjs";
import { enrichDestination } from "./enrich.mjs";
import {
  buildRedirect,
  buildCtfHandoff,
  buildUnfurl,
  buildOgImage,
  withRegion,
  notFound,
} from "./respond.mjs";
import {
  resolveTheme,
  isCrawler,
  renderUnfurlHtml,
  loadThemeImageBase64,
} from "./unfurl.mjs";
import { redirectLog, ctfHandoffLog, emit } from "./logline.mjs";

/**
 * Best-effort host extraction for the redirect log line. `enrichDestination`
 * passes non-absolute destinations through unchanged, so `finalDest` is not
 * guaranteed to be a parseable URL — never let a bad destination throw.
 *
 * @param {string} finalDest
 * @returns {string} the URL host, or "" if unparseable
 */
function destHostOf(finalDest) {
  try {
    return new URL(finalDest).host;
  } catch {
    return "";
  }
}

/**
 * Resolve a parsed request into an ALB response.
 *
 * @param {{ path: string, headers?: Record<string,string>, nowMs: number }} req
 * @param {{
 *   getQr: (code: string) => Promise<object|null>,
 *   log?: (obj: object) => void,
 * }} deps
 * @returns {Promise<object>} ALB Lambda-target response
 */
export async function resolve({ path, headers = {}, nowMs }, deps) {
  const { getQr, log = emit } = deps || {};

  try {
    const parsed = parsePath(path);

    switch (parsed.kind) {
      // Bare root or the reserved rollup trigger: the resolver serves neither.
      // `_flush` belongs to the rollup Lambda; here it is simply "not found".
      case "empty":
      case "flush":
        return notFound();

      // Unfurl preview image (`/_og/<theme>.png`): serve the bundled PNG for a
      // known theme, else 404. Not a scan — never logged. Any load failure
      // degrades to 404 via the null guard.
      case "ogimage": {
        const theme = resolveTheme(parsed.theme);
        if (!theme) return notFound();
        const base64 = loadThemeImageBase64(theme);
        if (!base64) return notFound();
        return buildOgImage({ base64 });
      }

      // CTF submission: forward the challenge + guess to run.defcon.run, which
      // owns scoring. We NEVER inspect or log the submitted value — the log
      // builder structurally cannot carry it.
      case "ctf": {
        log(ctfHandoffLog({ challenge: parsed.challenge }));
        return buildCtfHandoff({
          challenge: parsed.challenge,
          value: parsed.value,
        });
      }

      // Ordinary short-link redirect.
      case "redirect": {
        const { code, param, query } = parsed;

        const item = await getQr(code);
        // Unknown or explicitly disabled code → 404. (A missing `enabled`
        // defaults to enabled per the entity, so only an explicit `false`
        // suppresses; `!item` covers the miss.)
        if (!item || item.enabled === false) {
          return notFound();
        }

        const { destination, matchedRule } = resolveDestination(item, {
          param,
          nowMs,
        });
        const finalDest = enrichDestination(destination, {
          originalQuery: query,
          param,
          enrich: item.enrich,
        });

        // Defense in depth: never emit a redirect to a destination with no host
        // (empty/null/relative). buildRedirect would return a 302 with a blank
        // Location, which the ALB rejects as a 502. A code with no usable
        // destination is a clean 404 instead. (rules.mjs already skips dest-less
        // rules; this also covers a base destination that is empty.)
        const destHost = destHostOf(finalDest);
        if (!destHost) {
          return notFound();
        }

        // Unfurl: a code that opted into a theme (`item.unfurl`) serves an Open-
        // Graph card — but ONLY to a recognized link-preview crawler. A human
        // still gets the 302 below, so the shared secret (`v=<CODE>`) can never
        // leak: the crawler card forwards to the destination BASE (pre-enrich,
        // region-prefixed, query STRIPPED) and its og:image is a static PNG.
        // Crawler prefetches are not scans → NOT logged.
        const theme = item.unfurl ? resolveTheme(item.unfurl) : null;
        if (theme && isCrawler(headers["user-agent"] || "")) {
          const html = renderUnfurlHtml({
            theme,
            forwardUrl: withRegion(destination),
          });
          return buildUnfurl({ html });
        }

        log(
          redirectLog({
            code,
            param,
            matchedRule,
            destHost,
            geo: headers["cloudfront-viewer-country"] || "",
            ua: headers["user-agent"] || "",
          })
        );

        return buildRedirect({ destination: finalDest });
      }

      default:
        // parsePath only returns the four kinds above; anything else is a bug
        // in the parser, but we still degrade gracefully.
        return notFound();
    }
  } catch {
    // Total safety net: any unexpected throw (a rejecting getQr, a surprise in
    // a downstream helper) resolves to a plain 404 rather than a 5xx.
    return notFound();
  }
}
