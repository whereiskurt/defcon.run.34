/**
 * Request-target parser for the q.defcon.run resolver.
 *
 * The resolver front-door receives a raw path (plus optional query string) and
 * must classify it into one of four shapes before any DynamoDB lookup:
 *
 *   - `empty`    — the bare root (`/`); nothing to resolve → 404 upstream.
 *   - `flush`    — the reserved `/_flush` trigger for the rollup path.
 *   - `ogimage`  — the reserved `/_og/<theme>.png` unfurl preview image.
 *   - `ctf`      — the reserved `/ctf/<challenge>/<value...>` submission form.
 *   - `redirect` — everything else: `/<CODE>[/<param>]` short-link lookups.
 *
 * `ctf`, `_flush`, and `_og` are RESERVED namespaces: they can never be
 * classified as a redirect code, so an operator can never mint a short link that
 * shadows them (a code is the first segment UPPERCASED, and `_`-prefixed segments
 * are intercepted first).
 *
 * The parse is purely lexical — no I/O, no validation of whether a code exists.
 * It never throws; malformed input degrades to `empty`.
 */

/**
 * @typedef {(
 *   | { kind: "empty",    query: string }
 *   | { kind: "flush",    query: string }
 *   | { kind: "ogimage",  theme: string, query: string }
 *   | { kind: "ctf",      challenge: string, value: string, query: string }
 *   | { kind: "redirect", code: string, param: string|null, query: string }
 * )} ParseResult
 */

/**
 * Parse a raw request target (`path` + optional `?query`) into a ParseResult.
 *
 * Query handling: everything after the FIRST `?` is the query, returned without
 * the leading `?` (any subsequent `?` stays verbatim inside the query). Absent
 * or empty query → `""`.
 *
 * Path handling: leading/trailing slashes are stripped and the path is split on
 * `/` into non-empty segments. `code` is the first segment UPPERCASED (lookups
 * are case-insensitive); `param` is the verbatim second segment or null; extra
 * segments are ignored for redirects.
 *
 * @param {string} rawPathAndQuery
 * @returns {ParseResult}
 */
export function parsePath(rawPathAndQuery) {
  const raw = typeof rawPathAndQuery === "string" ? rawPathAndQuery : "";

  // Split off the query at the first '?'. Everything after is the query.
  const qIdx = raw.indexOf("?");
  const pathPart = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const query = qIdx === -1 ? "" : raw.slice(qIdx + 1);

  // Non-empty path segments (strips leading/trailing/duplicate slashes).
  const segments = pathPart.split("/").filter((s) => s.length > 0);

  if (segments.length === 0) {
    return { kind: "empty", query };
  }

  const first = segments[0];

  // Reserved: rollup flush trigger.
  if (first === "_flush") {
    return { kind: "flush", query };
  }

  // Reserved: unfurl preview image. `/_og/<theme>.png` → theme (lowercased, with
  // any `.png` suffix stripped). A missing/blank theme falls through to "" and
  // the resolver 404s it via the theme registry.
  if (first === "_og") {
    const file = segments.length >= 2 ? segments[1] : "";
    const theme = file.toLowerCase().replace(/\.png$/, "");
    return { kind: "ogimage", theme, query };
  }

  // Reserved: CTF submission. challenge = 2nd segment (verbatim, case-kept),
  // value = remaining segments joined by '/' (verbatim, may be "").
  if (first === "ctf") {
    if (segments.length < 2) {
      return { kind: "empty", query };
    }
    const challenge = segments[1];
    const value = segments.slice(2).join("/");
    return { kind: "ctf", challenge, value, query };
  }

  // Ordinary short-link redirect.
  const code = first.toUpperCase();
  const param = segments.length >= 2 ? segments[1] : null;
  return { kind: "redirect", code, param, query };
}
