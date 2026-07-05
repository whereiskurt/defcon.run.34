// finding.mjs — normalize an Athena result row into the fixed WAF/Impart
// finding seam (see ../finding.schema.json).
//
// buildFinding emits ONLY the allow-listed schema fields by constructing a fresh
// object literal — no extra column from the Athena row can leak through. All
// attacker-controlled strings (User-Agent / URL) are count-capped and
// length-capped so nothing unbounded reaches the SNS email or findings.jsonl
// (threat T-41-07). Pure module: no I/O, no AWS SDK.

export const RULES = {
  SUSTAINED: "sustained_activity",
  RATE: "rate_outlier",
};

const MAX_USER_AGENTS = 5;
const MAX_TOP_PATHS = 10;
const MAX_STR = 512;
const MAX_UA = 256;
const MAX_IP = 64;
const MAX_TS = 64;

function capStr(v, max = MAX_STR) {
  return String(v ?? "").slice(0, max);
}

function toInt(...candidates) {
  for (const c of candidates) {
    if (c === undefined || c === null || c === "") continue;
    const n = parseInt(c, 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

// Tolerant parse of an Athena array/map serialization into a string[].
// Accepts a real JS array, a Presto array literal "[a, b]", a Presto map literal
// "{k=v, ...}" (keys kept), or a scalar. Never throws.
export function parseList(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  let s = String(v).trim();
  if (s === "" || s === "[]" || s === "{}") return [];
  const wrapped =
    (s.startsWith("[") && s.endsWith("]")) ||
    (s.startsWith("{") && s.endsWith("}"));
  if (wrapped) s = s.slice(1, -1);
  if (s.trim() === "") return [];
  return s
    .split(",")
    .map((part) => part.trim())
    // Presto map entries render as "key=value" — keep the key (the path/UA).
    .map((part) =>
      part.includes("=") ? part.slice(0, part.lastIndexOf("=")).trim() : part
    )
    .filter((part) => part.length > 0);
}

// Map a query result row (columns keyed by name; Q1 or Q2 shape) into the fixed
// finding schema. `now` stamps the detection time; window falls back to the
// peak-bucket boundary for Q2 which has no first/last-seen columns.
export function buildFinding(rule, row = {}, now = new Date()) {
  const userAgents = parseList(row.user_agents)
    .map((ua) => capStr(ua, MAX_UA))
    .slice(0, MAX_USER_AGENTS);

  const topPaths = parseList(row.top_paths)
    .map((p) => capStr(p, MAX_STR))
    .slice(0, MAX_TOP_PATHS);

  const start = row.first_seen ?? row.peak_5min_bucket ?? null;
  const end = row.last_seen ?? row.peak_5min_bucket ?? null;

  // EXACT allow-list. A fresh literal guarantees no unexpected key from `row`
  // ever reaches the seam file or the operator email.
  return {
    ts: now.toISOString(),
    rule,
    client_ip: capStr(row.client_ip, MAX_IP),
    user_agents: userAgents,
    count: toInt(row.request_count, row.peak_requests_5min),
    window: {
      start: start == null ? null : capStr(start, MAX_TS),
      end: end == null ? null : capStr(end, MAX_TS),
    },
    peak_5min: toInt(row.peak_requests_5min, row.peak_5min),
    top_paths: topPaths,
    status_mix: {
      "2xx": toInt(row.status_2xx),
      "4xx": toInt(row.status_4xx),
      "5xx": toInt(row.status_5xx),
    },
  };
}
