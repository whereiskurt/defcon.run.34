/**
 * QR analytics ROLLUP Lambda — thin handler.
 *
 * Invoked on an EventBridge cron (no headers) or via a header-guarded manual
 * flush. On each run it:
 *   1. reads the watermark (last processed timestamp),
 *   2. runs a CloudWatch Logs Insights query over the resolver log group for
 *      the window [watermark, now),
 *   3. parses + aggregates the redirect / ctf-handoff lines into Qrstat deltas,
 *   4. upserts each delta and advances the watermark.
 *
 * All real logic is pure and lives in `lib/query.mjs` + `lib/aggregate.mjs`.
 * Every AWS touchpoint is an INJECTABLE seam on the `deps` argument, so the
 * handler is fully testable without AWS (tests pass in-memory fakes). The
 * default deps wire up the real CloudWatch Logs + DynamoDB clients.
 */

import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

import { buildInsightsQuery, parseResultRows } from "./lib/query.mjs";
import { aggregate, nextWatermark } from "./lib/aggregate.mjs";
import { Qrstat } from "./lib/entities.mjs";

// ---------------------------------------------------------------------------
// Cold-start-cached CloudWatch Logs client (real deps only)
// ---------------------------------------------------------------------------

const cwClient = new CloudWatchLogsClient({
  region: process.env.AWS_REGION || process.env.REGION_LABEL || "us-east-1",
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Default (real AWS) dependency implementations
// ---------------------------------------------------------------------------

/**
 * Run a Logs Insights query and return the raw GetQueryResults response.
 * StartQuery scopes results by the absolute [startTime,endTime] epoch-second
 * window; we then poll GetQueryResults until the query leaves a running state.
 */
async function defaultRunQuery({ query, startTime, endTime }) {
  const { queryId } = await cwClient.send(
    new StartQueryCommand({
      logGroupName: process.env.QR_LOG_GROUP,
      startTime,
      endTime,
      queryString: query,
      limit: 10000,
    })
  );

  // Poll until Complete / Failed / Cancelled. Bounded so a stuck query can't
  // hang the invocation for the full Lambda timeout.
  for (let i = 0; i < 60; i++) {
    const res = await cwClient.send(new GetQueryResultsCommand({ queryId }));
    if (res.status && res.status !== "Running" && res.status !== "Scheduled") {
      return res;
    }
    await sleep(1000);
  }
  return { results: [] };
}

/** Read the watermark meta row → epoch ms (default 0 when absent). */
async function defaultReadWatermark() {
  const res = await Qrstat.get({ code: "_meta", bucket: "watermark" }).go();
  const iso = res?.data?.lastSeen;
  return iso ? Date.parse(iso) : 0;
}

/** Upsert one Qrstat counter delta. */
async function defaultWriteStat({ code, bucket, countDelta, lastSeen }) {
  await Qrstat.update({ code, bucket })
    .add({ count: countDelta })
    .set({ lastSeen })
    .go();
}

/** Persist the advanced watermark as an ISO string on the meta row. */
async function defaultWriteWatermark(watermarkMs) {
  await Qrstat.update({ code: "_meta", bucket: "watermark" })
    .set({ lastSeen: new Date(watermarkMs).toISOString() })
    .go();
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * @param {object} event   ALB/EventBridge event; flush carries
 *                         `headers["x-qr-flush-token"]`.
 * @param {object} deps    Injectable seams (defaults use real AWS):
 *                         `{ runQuery, readWatermark, writeStat,
 *                            writeWatermark, now }`.
 * @returns {Promise<{ok:boolean, processed?:number, watermark?:number, reason?:string}>}
 */
export const handler = async (event = {}, deps = {}) => {
  const {
    runQuery = defaultRunQuery,
    readWatermark = defaultReadWatermark,
    writeStat = defaultWriteStat,
    writeWatermark = defaultWriteWatermark,
    now = Date.now,
  } = deps;

  // Flush-token guard: cron invocations carry NO header and are always
  // allowed. If a flush token IS present it must match QR_FLUSH_TOKEN.
  const token = event?.headers?.["x-qr-flush-token"];
  if (token !== undefined && token !== process.env.QR_FLUSH_TOKEN) {
    return { ok: false, reason: "forbidden" };
  }

  const nowMs = now();
  const watermark = (await readWatermark()) || 0;

  const query = buildInsightsQuery({ sinceMs: watermark, untilMs: nowMs });
  const rawResults = await runQuery({
    query,
    startTime: Math.floor(watermark / 1000),
    endTime: Math.floor(nowMs / 1000),
  });

  const logObjs = parseResultRows(rawResults);
  const stats = aggregate(logObjs);

  for (const stat of stats) {
    await writeStat(stat);
  }

  const newWatermark = nextWatermark(logObjs, watermark);
  await writeWatermark(newWatermark);

  return { ok: true, processed: logObjs.length, watermark: newWatermark };
};
