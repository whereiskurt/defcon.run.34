/**
 * q.defcon.run resolver Lambda — ALB target handler.
 *
 * This is the thin edge shim. It does exactly three things, then hands off to
 * the pure `resolve` core:
 *
 *   1. Reconstruct the request target (`path?query`) from the ALB event shape.
 *   2. Provide a warm-cached `getQr(code)` backed by a single ElectroDB GetItem
 *      on the shared `run-human-electro` table.
 *   3. Call `resolve({ path, headers, nowMs }, { getQr })` and return its ALB
 *      response verbatim.
 *
 * ALL routing/rule/enrich/response logic lives in `lib/` and is unit-tested
 * without AWS. The handler itself takes no `nowMs` argument — it stamps
 * `Date.now()` at the edge and passes it down, keeping the core deterministic.
 *
 * WARM CACHE. The Lambda runtime reuses the module (and thus the handler
 * closure) across warm invocations, so the `Map` inside `_buildHandler` is a
 * genuine cross-invocation cache. Each entry lives `CACHE_TTL_MS` (60s), which
 * is short enough that an operator edit to a code propagates within a minute
 * yet long enough to absorb a scan burst on one code (a poster being photographed
 * by a crowd). NEGATIVE hits are cached too: a `null` (unknown code) is stored
 * with the same TTL so a scan storm on a bogus/retired code can't hammer
 * DynamoDB. The blast radius of a stale negative is a 404 for up to 60s.
 *
 * TESTABILITY. `_buildHandler({ getQr })` is the injectable factory: it wraps
 * the supplied per-code fetch in the warm cache and returns the ALB handler.
 * The exported `handler` is just `_buildHandler` bound to the real DynamoDB
 * fetch, so tests inject a fake fetch (no network) and assert path
 * reconstruction, querystring rebuild, and cache-hit-avoids-second-fetch.
 */

import { Qr } from "./lib/entities.mjs";
import { resolve } from "./lib/resolve.mjs";

/** Warm-cache entry lifetime, milliseconds. */
export const CACHE_TTL_MS = 60_000;

/**
 * Reconstruct the raw request target (`path` + optional `?query`) from an ALB
 * Lambda-target event. ALB delivers the path and the query params separately;
 * `parsePath` wants them recombined. Each key/value is `encodeURIComponent`-ed
 * so the reassembled query round-trips cleanly through `URLSearchParams` in the
 * enrich step.
 *
 * @param {object} event ALB event
 * @returns {string} `path` or `path?k=v&...`
 */
function reconstructPath(event) {
  const path = typeof event?.path === "string" ? event.path : "/";
  const qsp = event?.queryStringParameters;
  if (qsp && typeof qsp === "object") {
    const parts = [];
    for (const [k, v] of Object.entries(qsp)) {
      if (v == null) continue;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    if (parts.length > 0) {
      return `${path}?${parts.join("&")}`;
    }
  }
  return path;
}

/**
 * The real per-code fetch: a single ElectroDB GetItem on the primary index.
 * Returns the item map or `null` on a miss. The warm cache is layered on top of
 * this by `_buildHandler`, so this stays a pure "one read" function.
 *
 * @param {string} code UPPERCASED short code
 * @returns {Promise<object|null>}
 */
async function fetchQr(code) {
  const res = await Qr.get({ code }).go();
  return res?.data ?? null;
}

/**
 * Build the ALB handler around a per-code fetch, wrapping it in the warm cache.
 * Exported for tests so a fake `getQr` can be injected with no AWS.
 *
 * @param {{
 *   getQr: (code: string) => Promise<object|null>,
 *   cacheTtlMs?: number,
 *   now?: () => number,
 * }} deps
 * @returns {(event: object) => Promise<object>} ALB handler
 */
export function _buildHandler({ getQr, cacheTtlMs = CACHE_TTL_MS, now = () => Date.now() }) {
  /** @type {Map<string, { item: object|null, expiresAt: number }>} */
  const cache = new Map();

  const cachedGetQr = async (code) => {
    const t = now();
    const hit = cache.get(code);
    if (hit && hit.expiresAt > t) {
      return hit.item;
    }
    const item = (await getQr(code)) ?? null;
    cache.set(code, { item, expiresAt: t + cacheTtlMs });
    return item;
  };

  return async function handler(event) {
    const path = reconstructPath(event);
    const headers = event?.headers ?? {};
    const nowMs = now();
    return resolve({ path, headers, nowMs }, { getQr: cachedGetQr });
  };
}

/**
 * Lambda entrypoint — ALB target integration. Bound to the real DynamoDB fetch;
 * the warm cache is per-module-instance (survives warm invocations).
 *
 * @param {object} event ALB event
 * @returns {Promise<object>} ALB response
 */
export const handler = _buildHandler({ getQr: fetchQr });
