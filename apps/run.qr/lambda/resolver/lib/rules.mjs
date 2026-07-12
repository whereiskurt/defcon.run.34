/**
 * Destination resolution for a single QR short-link item.
 *
 * A `Qr` item carries a base `destination` plus an optional ordered `rules`
 * list. `resolveDestination` picks the effective destination at request time by
 * a fixed precedence:
 *
 *   1. TIME rules first — in array order, the first rule whose half-open window
 *      `[from, to)` contains `nowMs` wins. This lets a code point somewhere
 *      special only during the event window and revert automatically after.
 *   2. PARAM rules next — in array order, the first rule whose `match` equals
 *      the (stringified) `param`, or is the wildcard `"*"`, wins. `"*"` matches
 *      any non-null param; a null param matches nothing (not even `"*"`).
 *   3. FALLBACK — the item's own `destination`.
 *
 * Time always beats param: an active time rule wins even when a param rule
 * would also match. The caller is assumed to have already checked `enabled`.
 *
 * A rule with no usable `dest` (empty/null — e.g. saved without a destination)
 * is SKIPPED, not honored: resolution falls through to the next rule / the base
 * destination rather than returning a blank dest that would produce a broken
 * empty-`Location` redirect (which the ALB rejects with a 502).
 *
 * Pure and total — no I/O, never throws on well-formed input.
 */

/** A destination is only usable if it's a non-empty (trimmed) string. */
function usableDest(dest) {
  return typeof dest === "string" && dest.trim() !== "";
}

/**
 * @typedef {{ kind:"time",  from:string, to:string, dest:string }} TimeRule
 * @typedef {{ kind:"param", match:string, dest:string }}           ParamRule
 * @typedef {{ destination:string, rules?:Array<TimeRule|ParamRule>, enabled?:boolean }} QrItem
 */

/**
 * Resolve the effective destination for a QR item.
 *
 * @param {QrItem} qrItem
 * @param {{ param: string|number|null, nowMs: number }} ctx
 * @returns {{ destination: string, matchedRule: TimeRule|ParamRule|"default" }}
 */
export function resolveDestination(qrItem, { param, nowMs }) {
  const rules = Array.isArray(qrItem?.rules) ? qrItem.rules : [];

  // (1) Time rules take precedence, evaluated in array order.
  for (const rule of rules) {
    if (rule?.kind !== "time") continue;
    const from = Date.parse(rule.from);
    const to = Date.parse(rule.to);
    if (Number.isNaN(from) || Number.isNaN(to)) continue;
    if (nowMs >= from && nowMs < to && usableDest(rule.dest)) {
      return { destination: rule.dest, matchedRule: rule };
    }
  }

  // (2) Param rules, evaluated in array order. Only when param is non-null;
  //     "*" is the wildcard for any non-null param.
  if (param != null) {
    const paramStr = String(param);
    for (const rule of rules) {
      if (rule?.kind !== "param") continue;
      if ((rule.match === "*" || rule.match === paramStr) && usableDest(rule.dest)) {
        return { destination: rule.dest, matchedRule: rule };
      }
    }
  }

  // (3) Fallback to the item's base destination.
  return { destination: qrItem.destination, matchedRule: "default" };
}
