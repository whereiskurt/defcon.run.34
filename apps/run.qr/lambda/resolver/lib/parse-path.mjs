/**
 * Request-target parser for the q.defcon.run resolver.
 *
 * The resolver front-door receives a raw path (plus optional query string) and
 * must classify it into one of five shapes before any DynamoDB lookup:
 *
 *   - `empty`    — the bare root (`/`); nothing to resolve → 404 upstream.
 *   - `flush`    — the reserved `/_flush` trigger for the rollup path.
 *   - `ogimage`  — the reserved `/_og/<theme>.png` unfurl preview image.
 *   - `ctf`      — the reserved `/ctf/<challenge>/<value...>` submission form.
 *   - `award`    — the reserved `/a/<nonce>` single-use bot-award claim link.
 *   - `redirect` — everything else: `/<CODE>[/<param>]` short-link lookups.
 *
 * `ctf`, `award`, `_flush`, and `_og` are RESERVED namespaces: they can never be
 * classified as a redirect code, so an operator can never mint a short link that
 * shadows them (a code is the first segment UPPERCASED, and `_`-prefixed segments
 * are intercepted first). That interception order is load-bearing for `award`:
 * `/a/` must be un-shadowable by any `Qr` row, because every mesh bot award link
 * points there. The award LETTER alone is matched case-insensitively — `/a/` and
 * `/A/` both reserve — because award links are TRANSCRIBED BY HAND: a player reads
 * one off a Meshtastic device screen and types it into a phone, where the keyboard
 * autocapitalizes the first letter. The nonce keeps its case here; run.human's
 * claim page lowercases that half. Both `A` and `a` were free as short codes, so
 * reserving the pair shadows nothing live.
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
 *   | { kind: "award",    nonce: string, query: string }
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

  // Reserved: single-use bot-award claim.
  //
  // The LETTER is matched case-insensitively. The failure this prevents is not a
  // buggy client — it is a PLAYER READING THE AWARD URL OFF A RADIO SCREEN and
  // typing it into a phone browser, where mobile keyboards autocapitalize the
  // first letter. `/A/k7m3…` would otherwise fall through to a short-code lookup
  // for `A`, miss, and 404 the player's award — and the claim page's `?nonce`
  // lowercasing would never get the chance to help, making it dead code. Both
  // `A` and `a` were free as codes, so reserving the pair shadows nothing live.
  //
  // The NONCE stays verbatim (case kept, unlike a redirect code) — not trimmed,
  // cased or validated here. This parser stays purely lexical; shape validation
  // belongs to run.human's pending-row lookup, which simply misses on garbage.
  // A bare `/a` has nothing to claim → `empty`, the same short-path rule as `ctf`.
  if (first.toLowerCase() === "a") {
    if (segments.length < 2) {
      return { kind: "empty", query };
    }
    return { kind: "award", nonce: segments[1], query };
  }

  // Ordinary short-link redirect.
  const code = first.toUpperCase();
  const param = segments.length >= 2 ? segments[1] : null;
  return { kind: "redirect", code, param, query };
}
