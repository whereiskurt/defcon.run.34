// abuse-detector Lambda handler (Phase 41 — AD-05 / AD-06 / AD-07).
//
// EventBridge fires this on a cron (dark until schedule_enabled=true). Each
// invocation runs the two Plan 02 Athena detections over the last LOOKBACK_HOURS,
// normalizes every flagged IP into the fixed finding seam, appends findings to
// the daily JSONL report, alerts once-per-UTC-day-per-IP (with escalation
// re-alert) to the REUSED Phase 40 SNS topic, and emits a once-a-day digest.
//
// FAIL-SAFE BY DESIGN (design 5 / T-41-08): the function NEVER throws. Any
// Athena / S3 / SNS error is logged and survived — a crash would break the
// schedule. A failed query just retries on the next cron; a dedup-state write
// failure still counts the alert as sent (a dup email beats a missed attacker).
//
// Runtime AWS SDK v3 packages driven here (provided by the Lambda runtime, never
// bundled, never npm-installed — zero third-party deps): @aws-sdk/client-athena
// and @aws-sdk/client-s3 (via the lib adapters below) and @aws-sdk/client-sns
// (via makeSnsAdapter). Node 20 ESM. See lib/athena.mjs / lib/dedup.mjs.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadTemplate, renderQuery, runQuery, makeAthenaAdapter } from "./lib/athena.mjs";
import { buildFinding, RULES } from "./lib/finding.mjs";
import { stateKey, readState, writeState, shouldAlert, isNotFound, makeS3Adapter } from "./lib/dedup.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

const log = (level, at, extra = {}) =>
  console[level === "error" ? "error" : "log"](
    JSON.stringify({ level, at, ...extra })
  );

// --- default (real) AWS adapters, built once and reused across warm invocations
// (cold-start amortized). Lazy so importing this module never requires the SDK;
// tests inject fakes and this path is never hit. ---
let _deps;
function getDefaultDeps() {
  if (!_deps) {
    _deps = (async () => {
      const [athena, s3, sns] = await Promise.all([
        makeAthenaAdapter(),
        makeS3Adapter(),
        makeSnsAdapter(),
      ]);
      return { athena, s3, sns };
    })();
  }
  return _deps;
}

async function makeSnsAdapter() {
  const { SNSClient, PublishCommand } = await import("@aws-sdk/client-sns");
  const client = new SNSClient({});
  return {
    async send(d) {
      if (d.op === "Publish") {
        return client.send(
          new PublishCommand({
            TopicArn: d.TopicArn,
            Subject: d.Subject,
            Message: d.Message,
          })
        );
      }
      throw new Error(`makeSnsAdapter: unknown op ${d.op}`);
    },
  };
}

// createHandler(injected) — production calls createHandler(); tests inject fake
// { athena, s3, sns } adapters plus optional { env, now, queryDir }.
export function createHandler(injected = {}) {
  return async function handler() {
    const env = { ...process.env, ...(injected.env || {}) };
    const now = injected.now instanceof Date ? injected.now : new Date();
    const utcDate = now.toISOString().slice(0, 10);
    const queryDir =
      injected.queryDir || join(MODULE_DIR, env.QUERY_DIR || "queries");

    const summary = {
      utcDate,
      queriesRun: 0,
      findings: 0,
      alertsSent: 0,
      dedupSkipped: 0,
      digestSent: false,
      errors: 0,
    };

    try {
      let { athena, s3, sns } = injected;
      if (!athena || !s3 || !sns) {
        const d = await getDefaultDeps();
        athena = athena || d.athena;
        s3 = s3 || d.s3;
        sns = sns || d.sns;
      }

      const escalation = Number(env.ESCALATION_MULTIPLIER) || 3;

      const queries = [
        {
          rule: RULES.SUSTAINED,
          file: "q1_sustained_activity.sql",
          params: {
            database: env.GLUE_DATABASE,
            table: env.GLUE_TABLE,
            lookback_hours: env.LOOKBACK_HOURS,
            session_gap_min: env.SESSION_GAP_MIN,
            session_hours: env.SESSION_HOURS,
          },
        },
        {
          rule: RULES.RATE,
          file: "q2_rate_outlier.sql",
          params: {
            database: env.GLUE_DATABASE,
            table: env.GLUE_TABLE,
            lookback_hours: env.LOOKBACK_HOURS,
            posts_per_5min: env.POSTS_PER_5MIN,
            requests_per_5min: env.REQUESTS_PER_5MIN,
          },
        },
      ];

      // 1. Run both detections. A query FAILURE is logged and skipped — retry is
      //    the next cron; one bad query must not abort the whole run (T-41-08).
      const findings = [];
      for (const q of queries) {
        try {
          const sql = renderQuery(loadTemplate(queryDir, q.file), q.params);
          const rows = await runQuery(athena, {
            workgroup: env.ATHENA_WORKGROUP,
            database: env.GLUE_DATABASE,
            sql,
          });
          summary.queriesRun++;
          for (const row of rows) findings.push(buildFinding(q.rule, row, now));
        } catch (err) {
          summary.errors++;
          log("error", "runQuery", { rule: q.rule, msg: String(err?.message || err) });
        }
      }
      summary.findings = findings.length;

      // 2. AD-07: append EVERY finding to abuse/YYYY-MM-DD/findings.jsonl.
      //    read-append-put: the nightly volume is a handful of offenders and the
      //    cron is a single serial invocation, so a naive rewrite is correct and
      //    boring. A report-write failure is logged, not fatal (fail-safe).
      if (findings.length > 0) {
        try {
          await appendFindings(s3, env, utcDate, findings);
        } catch (err) {
          summary.errors++;
          log("error", "appendFindings", { msg: String(err?.message || err) });
        }
      }

      // 3. AD-06: per-new-offender alert; dedup once-per-UTC-day + escalation.
      for (const finding of findings) {
        const key = stateKey(env.STATE_PREFIX, finding.client_ip, utcDate);

        let prev = null;
        try {
          prev = await readState(s3, env.RESULTS_BUCKET, key);
        } catch (err) {
          // fail-safe: unreadable state -> treat as new offender (alert).
          summary.errors++;
          log("error", "readState", { ip: finding.client_ip, msg: String(err?.message || err) });
          prev = null;
        }

        if (!shouldAlert(prev, finding, escalation)) {
          summary.dedupSkipped++;
          continue;
        }

        try {
          await publishAlert(sns, env, finding);
          summary.alertsSent++;
        } catch (err) {
          summary.errors++;
          log("error", "publishAlert", { ip: finding.client_ip, msg: String(err?.message || err) });
          continue; // could not alert — do not record state, so next cron retries
        }

        // Alert already sent: a state-write failure must NOT lose it (fail-safe).
        try {
          await writeState(s3, env.RESULTS_BUCKET, key, {
            count: finding.count,
            ts: finding.ts,
          });
        } catch (err) {
          summary.errors++;
          log("error", "writeState", { ip: finding.client_ip, msg: String(err?.message || err) });
        }
      }

      // 4. AD-07: once-a-day human digest (quiet night = a single line, no
      //    per-offender email is sent for an empty result set).
      if (Number(env.DIGEST_HOUR_UTC) === now.getUTCHours()) {
        try {
          await publishDigest(sns, env, utcDate, findings);
          summary.digestSent = true;
        } catch (err) {
          summary.errors++;
          log("error", "publishDigest", { msg: String(err?.message || err) });
        }
      }

      log("info", "summary", summary);
      return summary;
    } catch (err) {
      // Last-resort guard: the schedule must NEVER crash (design 5).
      summary.errors++;
      log("error", "handler", { fatal: true, msg: String(err?.message || err) });
      return summary;
    }
  };
}

async function appendFindings(s3, env, utcDate, findings) {
  const key = `${env.REPORT_PREFIX}${utcDate}/findings.jsonl`;
  let existing = "";
  try {
    const res = await s3.send({ op: "GetObject", Bucket: env.RESULTS_BUCKET, Key: key });
    existing = res.body || "";
  } catch (err) {
    if (!isNotFound(err)) throw err; // fresh day -> start empty
  }
  const lines = findings.map((f) => JSON.stringify(f)).join("\n") + "\n";
  await s3.send({
    op: "PutObject",
    Bucket: env.RESULTS_BUCKET,
    Key: key,
    Body: existing + lines,
    ContentType: "application/x-ndjson",
  });
}

async function publishAlert(sns, env, finding) {
  const uas = finding.user_agents.join(", ") || "(none)";
  const subject = `[abuse] ${finding.rule} ${finding.client_ip}`.slice(0, 100);
  const message = [
    `Abuse detection: ${finding.rule}`,
    `IP:          ${finding.client_ip}`,
    `User-Agents: ${uas}`,
    `Count:       ${finding.count}`,
    `Peak/5min:   ${finding.peak_5min}`,
    `Window:      ${finding.window.start} -> ${finding.window.end}`,
    `Status mix:  2xx=${finding.status_mix["2xx"]} 4xx=${finding.status_mix["4xx"]} 5xx=${finding.status_mix["5xx"]}`,
    `Top paths:   ${finding.top_paths.join(", ") || "(none)"}`,
    `Detected:    ${finding.ts}`,
  ].join("\n");
  await sns.send({ op: "Publish", TopicArn: env.SNS_TOPIC_ARN, Subject: subject, Message: message });
}

async function publishDigest(sns, env, utcDate, findings) {
  const subject = `[abuse] daily digest ${utcDate}`.slice(0, 100);
  let message;
  if (findings.length === 0) {
    message = `Abuse digest ${utcDate}: quiet night — no findings.`;
  } else {
    const lines = findings.map(
      (f) =>
        `- ${f.rule} ${f.client_ip} count=${f.count} peak5=${f.peak_5min} ua=[${f.user_agents.join("|")}]`
    );
    message = [`Abuse digest ${utcDate}: ${findings.length} finding(s).`, ...lines].join("\n");
  }
  await sns.send({ op: "Publish", TopicArn: env.SNS_TOPIC_ARN, Subject: subject, Message: message });
}

export const handler = createHandler();
