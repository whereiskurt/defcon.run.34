/**
 * copy-core — the CLIENT-SAFE heart of the run.bib copy toolkit (Phase 36-01).
 *
 * This module is deliberately pure: NO env reads, NO `server-only`, NO react, NO
 * network. Both the server resolver (copy.ts) and Plan 03's client `CopyProvider`
 * import `t`/`interpolate` from HERE so there is exactly ONE lookup path shared by
 * server and client. Every `t(key)` read is an in-memory O(1) map lookup — never a
 * fetch (SC-1).
 */

/** A resolved, already-merged locale map: dotted key -> copy string. */
export type CopyMap = Record<string, string>;

/**
 * Replace every `{placeholder}` token in `value` with the matching entry from
 * `vars`. Tokens with no matching var are left intact (so a missing var surfaces
 * visibly rather than blanking the string).
 */
export function interpolate(
  value: string,
  vars?: Record<string, string | number>
): string {
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

/**
 * Pure O(1) copy lookup: `map[key]` interpolated with `vars`. When the key is
 * absent the key itself is echoed as the last resort (never a blank), matching
 * the fallback contract (FALL-04) — a missing key is visible, not empty.
 */
export function t(
  map: CopyMap,
  key: string,
  vars?: Record<string, string | number>
): string {
  const value = map[key] ?? key;
  return interpolate(value, vars);
}
