/**
 * waffaw-logger — Artillery processor module
 * Exports afterResponse hook for NDJSON logging to stdout (CloudWatch Logs ingestion).
 * Respects LOG_LEVEL: normal | verbose | debug
 *
 * Usage in Artillery YAML:
 *   config:
 *     processor: "../plugins/artillery-plugin-waffaw-logger/index.js"
 *   scenarios:
 *     - afterResponse: "waffawLog"
 */

var logLevel = process.env.LOG_LEVEL || "normal";
var campaign = process.env.CAMPAIGN_NAME || "unknown";
var sourceIp = process.env.MY_IP || "0.0.0.0";
var nodeRank = parseInt(process.env.NODE_RANK || "0", 10);
var nodeTotal = parseInt(process.env.NODE_TOTAL || "0", 10);
var nodeId = process.env.NODE_ID || "unknown";
var nodeType = process.env.NODE_TYPE || "unknown";
var region = process.env.REGION || "unknown";

/**
 * afterResponse processor hook — called for each HTTP response.
 * Signature: (requestParams, response, context, ee, next)
 */
function waffawLog(requestParams, response, context, ee, next) {
  var record = {
    timestamp: new Date().toISOString(),
    campaign: campaign,
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
    region: region,
  };

  if (logLevel === "verbose" || logLevel === "debug") {
    record.request_headers = (requestParams && requestParams.headers) || {};
    record.response_headers = (response && response.headers) || {};
  }

  if (logLevel === "debug") {
    var body = (response && response.body) || "";
    record.response_body_preview =
      typeof body === "string" ? body.slice(0, 1024) : JSON.stringify(body).slice(0, 1024);
  }

  process.stdout.write(JSON.stringify(record) + "\n");
  return next(null);
}

module.exports = { waffawLog: waffawLog };
