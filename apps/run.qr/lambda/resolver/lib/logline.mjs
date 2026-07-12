/**
 * Structured log-line builders for the q.defcon.run resolver Lambda.
 *
 * The resolver emits exactly ONE structured JSON line per scan. The rollup
 * Lambda later reads these lines from CloudWatch Logs Insights to build the
 * `Qrstat` counters — so the field names here are a load-bearing contract
 * with `apps/run.qr/lambda/rollup/lib/aggregate.mjs`.
 *
 * These builders are PURE — they return the plain object. `emit` is the only
 * side-effecting function (a single `console.log`), kept separate so the
 * shapes stay trivially testable.
 *
 * LOG-HYGIENE INVARIANT (do not weaken): a CTF hand-off line must NEVER carry
 * the submitted answer value. The resolver forwards guesses to run.defcon.run
 * without ever inspecting them, and leaving the raw guess in CloudWatch would
 * both leak answers and pollute the counters. `ctfHandoffLog` structurally
 * cannot leak it — it does not accept a `value` argument at all.
 */

/**
 * Build the log record for a resolved redirect.
 *
 * @param {{
 *   code: string,
 *   param: string|null,
 *   matchedRule: object|string,
 *   destHost: string,
 *   region: "use1"|"cac1",
 *   ua: string,
 *   geo: string,
 * }} fields
 * @returns {object}
 */
export function redirectLog({ code, param, matchedRule, destHost, region, ua, geo }) {
  return { type: "redirect", code, param, matchedRule, destHost, region, ua, geo };
}

/**
 * Build the log record for a CTF hand-off.
 *
 * NOTE the signature: it takes ONLY `challenge` and `region`. There is no
 * `value` parameter and there is no `value` key in the output — this is the
 * enforcement point for the log-hygiene invariant above. `result` is a fixed
 * `"handoff"` marker so the rollup can distinguish forwarded scans from any
 * future scored outcome without ever seeing the guess itself.
 *
 * @param {{ challenge: string, region: "use1"|"cac1" }} fields
 * @returns {object}
 */
export function ctfHandoffLog({ challenge, region }) {
  return { type: "ctf-handoff", challenge, region, result: "handoff" };
}

/**
 * Emit a log record as a single JSON line to stdout. This is the only I/O in
 * the module; `resolve.mjs` injects it as `log` so tests can substitute a
 * spy.
 *
 * @param {object} obj
 * @returns {void}
 */
export function emit(obj) {
  console.log(JSON.stringify(obj));
}
