/**
 * CloudWatch Logs Insights query construction + result normalization for the
 * QR analytics rollup Lambda.
 *
 * The resolver Lambda emits one JSON line per redirect / ctf-handoff
 * (`lib/logline.mjs`: `{type:"redirect",code,param,...}` and
 * `{type:"ctf-handoff",challenge,region,result}`). The rollup periodically
 * sweeps those lines via a Logs Insights query, parses them back into objects,
 * and folds them into the Qrstat counters.
 *
 * Both functions here are PURE — no AWS, no clock — so they unit-test without
 * any network. The actual StartQuery/GetQueryResults dance lives behind an
 * injectable seam in `index.mjs`.
 */

/**
 * Build the Logs Insights query string.
 *
 * NOTE: Logs Insights scopes results to an absolute time window via the
 * `startTime`/`endTime` parameters passed to `StartQuery` — NOT via the query
 * text. The caller (index.mjs) derives those epoch-second bounds from the
 * watermark (`sinceMs`) and now (`untilMs`). We still emit an explicit
 * ascending sort so `nextWatermark` sees the batch in chronological order, and
 * a generous `limit` so a busy sweep window is not silently truncated.
 *
 * `sinceMs`/`untilMs` are accepted for symmetry/documentation but the query is
 * the same regardless of their values (the window is applied at the API level).
 *
 * @param {{sinceMs?:number, untilMs?:number}} _range
 * @returns {string}
 */
export function buildInsightsQuery(_range = {}) {
  return [
    "fields @message, @timestamp",
    "sort @timestamp asc",
    "limit 10000",
  ].join(" | ");
}

/**
 * Coerce a Logs Insights `@timestamp` value into epoch milliseconds.
 *
 * GetQueryResults returns `@timestamp` as a string. Depending on the source it
 * is either already an epoch value (`"1752278400000"`) or the Insights display
 * format `"YYYY-MM-DD HH:mm:ss.SSS"` — which is UTC but carries no timezone
 * marker, so naive `Date.parse` would read it as local time. We normalize to a
 * proper ISO-8601 UTC instant before parsing.
 *
 * @param {*} v
 * @returns {number} epoch ms, or NaN if uninterpretable
 */
function toMs(v) {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return Number(s);
  let iso = s.includes("T") ? s : s.replace(" ", "T");
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(iso)) iso += "Z";
  return Date.parse(iso);
}

/**
 * Normalize a GetQueryResults payload into parsed log objects.
 *
 * Accepts either the full `GetQueryResults` response (`{results: [...]}`) or a
 * bare `results` array. Each row is `Array<{field,value}>`; we locate the
 * `@message` field, `JSON.parse` it, and attach the row's `@timestamp` as
 * `_ts` (epoch ms). Rows whose `@message` is missing or not valid JSON are
 * skipped (defensive — a malformed line must not abort the whole sweep).
 *
 * @param {{results?:Array}|Array} insightsResults
 * @returns {Array<object>} parsed `{...logObj, _ts}` entries
 */
export function parseResultRows(insightsResults) {
  const rows = Array.isArray(insightsResults)
    ? insightsResults
    : insightsResults?.results ?? [];

  const out = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    let message;
    let ts;
    for (const cell of row) {
      if (!cell || typeof cell.field !== "string") continue;
      if (cell.field === "@message") message = cell.value;
      else if (cell.field === "@timestamp") ts = cell.value;
    }
    if (message == null) continue;
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch {
      continue;
    }
    if (parsed == null || typeof parsed !== "object") continue;
    out.push({ ...parsed, _ts: toMs(ts) });
  }
  return out;
}
