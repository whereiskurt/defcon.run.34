import { Page } from "playwright";

export { login } from "./login";
export { logout } from "./logout";
export { browsePublic } from "./browse-public";
export { clickElement } from "./click-element";
export { submitForm } from "./form-submit";

/**
 * Shared env vars for NDJSON records (HTTP + Playwright).
 */
const logLevel = process.env.LOG_LEVEL || "normal";
const campaign = process.env.CAMPAIGN_NAME || "unknown";
const sourceIp = process.env.MY_IP || "0.0.0.0";
const nodeRank = parseInt(process.env.NODE_RANK || "0", 10);
const nodeTotal = parseInt(process.env.NODE_TOTAL || "0", 10);
const nodeId = process.env.NODE_ID || "unknown";
const nodeType = process.env.NODE_TYPE || "unknown";
const region = process.env.REGION || "unknown";

const TRACKED_TYPES = new Set(["document", "xhr", "fetch"]);

/**
 * Instrument a Playwright page to emit NDJSON for every document/xhr/fetch response.
 * Call at the top of each flowFunction. Safe to call multiple times — no-ops if already attached.
 */
export function instrumentPage(page: Page, scenarioName: string) {
  if ((page as any).__waffawInstrumented) return;
  (page as any).__waffawInstrumented = true;

  page.on("response", (resp) => {
    if (!TRACKED_TYPES.has(resp.request().resourceType())) return;

    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      campaign,
      source_ip: sourceIp,
      node_rank: nodeRank,
      node_total: nodeTotal,
      target_url: resp.url(),
      method: resp.request().method(),
      status_code: resp.status(),
      response_time_ms: 0,
      scenario: scenarioName,
      engine: "playwright",
      node_id: nodeId,
      node_type: nodeType,
      region,
    };

    process.stdout.write(JSON.stringify(record) + "\n");
  });
}

/**
 * afterResponse hook for HTTP scenarios in mixed templates (e.g. crawl-and-probe).
 * Writes NDJSON to stdout for CloudWatch Logs ingestion.
 */

export function waffawLog(
  requestParams: any,
  response: any,
  context: any,
  ee: any,
  next: (err?: Error | null) => void
) {
  const record: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    campaign,
    source_ip: sourceIp,
    node_rank: nodeRank,
    node_total: nodeTotal,
    target_url: (requestParams && requestParams.url) || "",
    method: (requestParams && requestParams.method) || "GET",
    status_code: (response && response.statusCode) || 0,
    response_time_ms:
      (response && response.timings && response.timings.phases && response.timings.phases.firstByte) || 0,
    scenario:
      (context && context.scenario && context.scenario.name) ||
      (context && context._scenario && context._scenario.name) ||
      "unknown",
    engine: "http",
    node_id: nodeId,
    node_type: nodeType,
    region,
  };

  if (logLevel === "verbose" || logLevel === "debug") {
    record.request_headers = (requestParams && requestParams.headers) || {};
    record.response_headers = (response && response.headers) || {};
  }

  if (logLevel === "debug") {
    const body = (response && response.body) || "";
    record.response_body_preview =
      typeof body === "string" ? body.slice(0, 1024) : JSON.stringify(body).slice(0, 1024);
  }

  process.stdout.write(JSON.stringify(record) + "\n");
  return next(null);
}
