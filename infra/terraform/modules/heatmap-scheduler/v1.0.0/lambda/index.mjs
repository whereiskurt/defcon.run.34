// heatmap-scheduler invoker Lambda (Phase 71).
//
// EventBridge Scheduler fires this on a cron; it reads the shared internal secret from
// SSM and POSTs the run.gpx internal heat-map build endpoint (which does the actual
// rescan, assembly and artifact write). Keeping the schedule → HTTP hop in a tiny Lambda
// avoids exposing the worker publicly and matches the repo's Lambda-per-concern
// convention (see strava-sync-scheduler / bib-reconcile-lambda).
//
// Node.js 20.x ES module. No bundler; only the AWS SDK v3 (available in the runtime).

import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});

export const handler = async () => {
  const syncUrl = process.env.SYNC_URL;
  const secretPath = process.env.INTERNAL_SYNC_SECRET_SSM_PATH;
  if (!syncUrl || !secretPath) {
    throw new Error("SYNC_URL and INTERNAL_SYNC_SECRET_SSM_PATH are required");
  }

  const param = await ssm.send(
    new GetParameterCommand({ Name: secretPath, WithDecryption: true })
  );
  const secret = param.Parameter?.Value;
  // Deliberately does NOT interpolate secretPath. The path is not itself a
  // secret, but it is a pointer to one, and this throw surfaces in CloudWatch
  // AND in the EventBridge Scheduler failure record.
  if (!secret) throw new Error("secret not found at the configured SSM path");

  // TIMEOUT CHAIN — three bounds, STRICTLY increasing, never equal:
  //   240 s  the build route's own deadline (BUILD_BUDGET_MS in
  //          apps/run.gpx/webapp/src/lib/heatmap-build.ts) — the innermost
  //          bound and the only one the build itself enforces.
  //   300 s  FETCH_TIMEOUT_MS below — this invoker bounds its own wait so it
  //          OBSERVES the builder's failure instead of being killed holding it.
  //   420 s  the Lambda's function timeout (var.lambda_timeout), which must
  //          also absorb the SSM round trip, cold start, DNS and connect.
  // Each must be strictly greater than the one inside it. If they are equal (or
  // inverted) a slow build kills the invoker mid-flight, the invoker throws, and
  // retry_policy { maximum_retry_attempts = 2 } retries the build INTO ITSELF.
  const FETCH_TIMEOUT_MS = 300_000;

  let res;
  try {
    res = await fetch(syncUrl, {
      method: "POST",
      headers: { "x-internal-secret": secret },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error(
        `[heatmap-build] build did not respond within the ${FETCH_TIMEOUT_MS} ms fetch bound — aborted (the builder's own deadline is lower, so it should have failed first)`
      );
    }
    throw err;
  }

  const body = await res.text();
  if (!res.ok) {
    // Non-2xx only: the truncated body is diagnostically necessary here. On the
    // success path it would be 500 bytes of whatever the endpoint returned,
    // which is arbitrary content if SYNC_URL is ever wrong.
    console.log(`[heatmap-build] ${res.status} ${body.slice(0, 500)}`);
    throw new Error(`sync endpoint returned ${res.status}`);
  }
  console.log(`[heatmap-build] ${res.status} ${body.length} bytes`);
  return { statusCode: res.status, body };
};
