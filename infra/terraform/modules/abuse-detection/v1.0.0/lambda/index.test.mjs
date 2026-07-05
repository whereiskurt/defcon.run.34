// Unit suite for the abuse-detector — Node's BUILT-IN runner only
// (node:test + node:assert/strict). NO third-party framework, NO npm install
// (keeps the phase clear of any package-legitimacy gate, T-41-SC). The AWS SDK
// is never imported: the handler is driven with injected FAKE adapters, so the
// tests run with zero @aws-sdk packages installed.
//
// Run: `cd <lambda> && node --test`  (bare-dir `node --test <dir>/` is
// unsupported on this Node — see Plan 02 SUMMARY deviation 1).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createHandler } from "./index.mjs";
import { renderQuery, loadTemplate } from "./lib/athena.mjs";
import { buildFinding, RULES } from "./lib/finding.mjs";
import { shouldAlert, stateKey } from "./lib/dedup.mjs";

const LAMBDA_DIR = dirname(fileURLToPath(import.meta.url));
const QUERY_DIR = join(LAMBDA_DIR, "queries");

const ENV = {
  ATHENA_WORKGROUP: "dcr-abuse-analysis",
  GLUE_DATABASE: "abuse",
  GLUE_TABLE: "alb_access_logs",
  RESULTS_BUCKET: "dcr-abuse-results",
  REPORT_PREFIX: "abuse/",
  STATE_PREFIX: "abuse/state/",
  SNS_TOPIC_ARN: "arn:aws:sns:us-east-1:111122223333:dcr-admin-reports-tripwire",
  LOOKBACK_HOURS: "3",
  SESSION_HOURS: "2",
  SESSION_GAP_MIN: "15",
  POSTS_PER_5MIN: "30",
  REQUESTS_PER_5MIN: "100",
  ESCALATION_MULTIPLIER: "3",
  DIGEST_HOUR_UTC: "13",
};

// A non-digest hour so per-offender alert counts are not perturbed by the digest.
const NOW = new Date("2026-07-05T09:00:00Z");

function q1Row(overrides = {}) {
  return {
    client_ip: "203.0.113.7",
    user_agents: "[curl/7.1, python-requests/2.31]",
    request_count: "500",
    first_seen: "2026-07-05T06:00:00Z",
    last_seen: "2026-07-05T08:30:00Z",
    max_session_minutes: "150",
    top_paths: "{/api/login=120, /admin=40}",
    status_2xx: "400",
    status_4xx: "80",
    status_5xx: "20",
    ...overrides,
  };
}

// --- fake AWS adapters (descriptor contract: send({ op, ... })) ---

function fakeAthena({ rowsPerQuery = [[], []], failEvery = false } = {}) {
  let qi = -1;
  return {
    startCount: 0,
    async send(d) {
      if (d.op === "StartQueryExecution") {
        qi += 1;
        this.startCount += 1;
        if (failEvery) throw new Error("athena StartQueryExecution boom");
        return { QueryExecutionId: `qid-${qi}` };
      }
      if (d.op === "GetQueryExecution") {
        return { QueryExecution: { Status: { State: "SUCCEEDED" } } };
      }
      if (d.op === "GetQueryResults") {
        const rows = rowsPerQuery[qi] || [];
        const cols = rows.length ? Object.keys(rows[0]) : ["client_ip"];
        const header = { Data: cols.map((c) => ({ VarCharValue: c })) };
        const dataRows = rows.map((r) => ({
          Data: cols.map((c) => ({ VarCharValue: r[c] == null ? null : String(r[c]) })),
        }));
        return {
          ResultSet: {
            ResultSetMetadata: { ColumnInfo: cols.map((c) => ({ Name: c })) },
            Rows: [header, ...dataRows],
          },
        };
      }
      throw new Error(`fakeAthena: unexpected op ${d.op}`);
    },
  };
}

function fakeS3({ store = new Map(), failPutState = false } = {}) {
  return {
    store,
    puts: [],
    async send(d) {
      if (d.op === "GetObject") {
        if (store.has(d.Key)) return { body: store.get(d.Key) };
        const err = new Error("NoSuchKey");
        err.name = "NoSuchKey";
        throw err;
      }
      if (d.op === "PutObject") {
        this.puts.push(d.Key);
        if (failPutState && d.Key.includes("/state/")) {
          throw new Error("s3 PutObject state boom");
        }
        store.set(d.Key, d.Body);
        return {};
      }
      throw new Error(`fakeS3: unexpected op ${d.op}`);
    },
  };
}

function fakeSns() {
  return {
    published: [],
    async send(d) {
      if (d.op === "Publish") {
        this.published.push(d);
        return { MessageId: "mid" };
      }
      throw new Error(`fakeSns: unexpected op ${d.op}`);
    },
  };
}

// =============================== pure units ================================

test("renderQuery resolves the real Q1/Q2 templates with zero residual tokens", () => {
  const q1 = renderQuery(loadTemplate(QUERY_DIR, "q1_sustained_activity.sql"), {
    database: "abuse",
    table: "alb_access_logs",
    lookback_hours: 3,
    session_gap_min: 15,
    session_hours: 2,
  });
  assert.equal(/\{[A-Za-z_][A-Za-z0-9_]*\}/.test(q1), false);
  assert.ok(q1.includes('"abuse"."alb_access_logs"'));

  const q2 = renderQuery(loadTemplate(QUERY_DIR, "q2_rate_outlier.sql"), {
    database: "abuse",
    table: "alb_access_logs",
    lookback_hours: 3,
    posts_per_5min: 30,
    requests_per_5min: 100,
  });
  assert.equal(/\{[A-Za-z_][A-Za-z0-9_]*\}/.test(q2), false);
});

test("renderQuery throws LOUDLY on a template/param mismatch (T-41-13)", () => {
  assert.throws(
    () => renderQuery("SELECT * WHERE h > {lookback_hours} AND x = {missing}", { lookback_hours: 3 }),
    /unresolved placeholder/
  );
});

test("buildFinding emits EXACTLY the schema field set — no extra keys leak", () => {
  const schema = JSON.parse(readFileSync(join(LAMBDA_DIR, "finding.schema.json")));
  const schemaKeys = Object.keys(schema.properties).sort();

  const finding = buildFinding(RULES.SUSTAINED, q1Row(), NOW);
  assert.deepEqual(Object.keys(finding).sort(), schemaKeys);

  // Every finding carries BOTH identifiers (design 3.2).
  assert.ok(finding.client_ip);
  assert.ok(Array.isArray(finding.user_agents) && finding.user_agents.length >= 1);
  // status_mix nested shape matches the seam.
  assert.deepEqual(Object.keys(finding.status_mix).sort(), ["2xx", "4xx", "5xx"]);
});

test("buildFinding caps user_agents (<=5) and top_paths (<=10) so nothing unbounded leaks (T-41-07)", () => {
  const uas = Array.from({ length: 9 }, (_, i) => `ua${i}`);
  const paths = Array.from({ length: 20 }, (_, i) => `/p${i}`);
  const finding = buildFinding(RULES.RATE, { client_ip: "1.1.1.1", user_agents: uas, top_paths: paths }, NOW);
  assert.equal(finding.user_agents.length, 5);
  assert.equal(finding.top_paths.length, 10);
});

test("shouldAlert: null prev -> alert; equal count -> skip; escalation -> re-alert", () => {
  assert.equal(shouldAlert(null, { count: 500 }, 3), true);
  assert.equal(shouldAlert({ count: 500 }, { count: 500 }, 3), false);
  assert.equal(shouldAlert({ count: 10 }, { count: 30 }, 3), true); // 30 >= 10*3
  assert.equal(shouldAlert({ count: 10 }, { count: 29 }, 3), false);
});

// ============================ handler behavior =============================

test("a newly flagged IP publishes exactly one SNS alert; a same-day re-run does not", async () => {
  const s3 = fakeS3(); // shared store across both runs
  const rowsPerQuery = [[q1Row()], []]; // Q1 one offender, Q2 empty

  const sns1 = fakeSns();
  const h1 = createHandler({ athena: fakeAthena({ rowsPerQuery }), s3, sns: sns1, env: ENV, now: NOW, queryDir: QUERY_DIR });
  const r1 = await h1();
  assert.equal(r1.alertsSent, 1);
  assert.equal(sns1.published.length, 1);
  assert.equal(sns1.published[0].TopicArn, ENV.SNS_TOPIC_ARN);
  assert.match(sns1.published[0].Message, /203\.0\.113\.7/);

  const sns2 = fakeSns();
  const h2 = createHandler({ athena: fakeAthena({ rowsPerQuery }), s3, sns: sns2, env: ENV, now: NOW, queryDir: QUERY_DIR });
  const r2 = await h2();
  assert.equal(r2.alertsSent, 0, "second run same UTC day must not re-alert");
  assert.equal(r2.dedupSkipped, 1);
  assert.equal(sns2.published.length, 0);
});

test("an IP crossing ESCALATION_MULTIPLIER x its prior count re-alerts", async () => {
  const key = stateKey(ENV.STATE_PREFIX, "203.0.113.7", "2026-07-05");
  const store = new Map([[key, JSON.stringify({ count: 10, ts: "2026-07-05T07:00:00Z" })]]);
  const s3 = fakeS3({ store });
  const sns = fakeSns();

  // count 30 >= 10 * 3 -> re-alert
  const h = createHandler({
    athena: fakeAthena({ rowsPerQuery: [[q1Row({ request_count: "30" })], []] }),
    s3, sns, env: ENV, now: NOW, queryDir: QUERY_DIR,
  });
  const r = await h();
  assert.equal(r.alertsSent, 1);
  assert.equal(sns.published.length, 1);
});

test("Athena failure does NOT throw — handler resolves with zero alerts (schedule survives, T-41-08)", async () => {
  const s3 = fakeS3();
  const sns = fakeSns();
  const h = createHandler({ athena: fakeAthena({ failEvery: true }), s3, sns, env: ENV, now: NOW, queryDir: QUERY_DIR });

  const r = await h(); // must resolve, not reject
  assert.equal(typeof r, "object");
  assert.equal(r.queriesRun, 0);
  assert.equal(r.findings, 0);
  assert.equal(r.alertsSent, 0);
  assert.equal(sns.published.length, 0);
  assert.ok(r.errors >= 2, "both query failures logged");
});

test("dedup writeState failure is fail-safe: the SNS alert still went out", async () => {
  const s3 = fakeS3({ failPutState: true }); // state PutObject throws; findings PutObject ok
  const sns = fakeSns();
  const h = createHandler({
    athena: fakeAthena({ rowsPerQuery: [[q1Row()], []] }),
    s3, sns, env: ENV, now: NOW, queryDir: QUERY_DIR,
  });

  const r = await h();
  assert.equal(sns.published.length, 1, "alert must be sent even though state write failed");
  assert.equal(r.alertsSent, 1);
  assert.ok(r.errors >= 1, "the state-write failure is logged");
});

test("every finding written to the daily JSONL carries client_ip AND user_agents", async () => {
  const s3 = fakeS3();
  const sns = fakeSns();
  const h = createHandler({
    athena: fakeAthena({ rowsPerQuery: [[q1Row()], []] }),
    s3, sns, env: ENV, now: NOW, queryDir: QUERY_DIR,
  });
  await h();

  const jsonlKey = `${ENV.REPORT_PREFIX}2026-07-05/findings.jsonl`;
  const body = s3.store.get(jsonlKey);
  assert.ok(body, "findings.jsonl was written");
  for (const line of body.trim().split("\n")) {
    const f = JSON.parse(line);
    assert.ok(f.client_ip);
    assert.ok(Array.isArray(f.user_agents) && f.user_agents.length >= 1);
  }
});
