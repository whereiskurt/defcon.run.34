/**
 * waffaw-logger — Artillery reporter plugin
 * Outputs NDJSON to stdout for CloudWatch Logs ingestion.
 * Respects LOG_LEVEL: normal | verbose | debug
 */

class WaffawLogger {
  constructor(config, events) {
    this.logLevel = config.logLevel || process.env.LOG_LEVEL || "normal";
    this.campaign = process.env.CAMPAIGN_NAME || "unknown";
    this.sourceIp = process.env.MY_IP || "0.0.0.0";
    this.nodeRank = parseInt(process.env.NODE_RANK || "0", 10);
    this.nodeTotal = parseInt(process.env.NODE_TOTAL || "0", 10);
    this.nodeId = process.env.NODE_ID || "unknown";
    this.nodeType = process.env.NODE_TYPE || "unknown";
    this.region = process.env.REGION || "unknown";

    events.on("request", this.onRequest.bind(this));
    events.on("error", this.onError.bind(this));
  }

  onRequest(requestParams, response, context, events) {
    var record = {
      timestamp: new Date().toISOString(),
      campaign: this.campaign,
      source_ip: this.sourceIp,
      node_rank: this.nodeRank,
      node_total: this.nodeTotal,
      target_url: (response && response.request && response.request.uri && response.request.uri.href) || (requestParams && requestParams.url) || "",
      method: (requestParams && requestParams.method) || "GET",
      status_code: (response && response.statusCode) || 0,
      response_time_ms: (response && response.timings && response.timings.phases && response.timings.phases.total) || 0,
      scenario: (context && context._scenario && context._scenario.name) || "unknown",
      engine: (context && context._engineName) || "http",
      node_id: this.nodeId,
      node_type: this.nodeType,
      region: this.region,
    };

    if (this.logLevel === "verbose" || this.logLevel === "debug") {
      record.request_headers = (response && response.request && response.request.headers) || {};
      record.response_headers = (response && response.headers) || {};
    }

    if (this.logLevel === "debug") {
      var body = (response && response.body) || "";
      record.response_body_preview =
        typeof body === "string" ? body.slice(0, 1024) : JSON.stringify(body).slice(0, 1024);
      record.page_title = (context && context._pageTitle) || "";
      record.console_errors = (context && context._consoleErrors) || [];
    }

    process.stdout.write(JSON.stringify(record) + "\n");
  }

  onError(error) {
    var record = {
      timestamp: new Date().toISOString(),
      campaign: this.campaign,
      source_ip: this.sourceIp,
      node_rank: this.nodeRank,
      node_total: this.nodeTotal,
      target_url: "",
      method: "",
      status_code: 0,
      response_time_ms: 0,
      scenario: "error",
      engine: "unknown",
      node_id: this.nodeId,
      node_type: this.nodeType,
      region: this.region,
      error: (error && error.message) || String(error),
    };
    process.stdout.write(JSON.stringify(record) + "\n");
  }
}

module.exports = WaffawLogger;
