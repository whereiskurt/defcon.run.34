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
  if (!secret) throw new Error(`secret not found at ${secretPath}`);

  const res = await fetch(syncUrl, {
    method: "POST",
    headers: { "x-internal-secret": secret },
  });
  const body = await res.text();
  console.log(`[heatmap-build] ${res.status} ${body.slice(0, 500)}`);
  if (!res.ok) {
    throw new Error(`sync endpoint returned ${res.status}`);
  }
  return { statusCode: res.status, body };
};
