/**
 * waffaw-logger — Artillery reporter plugin
 * Outputs NDJSON to stdout for CloudWatch Logs ingestion.
 * Respects LOG_LEVEL: normal | verbose | debug
 */

interface WaffawLogRecord {
  timestamp: string;
  campaign: string;
  source_ip: string;
  node_rank: number;
  node_total: number;
  target_url: string;
  method: string;
  status_code: number;
  response_time_ms: number;
  scenario: string;
  engine: string;
  node_id: string;
  node_type: string;
  region: string;
  request_headers?: Record<string, string>;
  response_headers?: Record<string, string>;
  response_body_preview?: string;
  page_title?: string;
  console_errors?: string[];
}

type LogLevel = "normal" | "verbose" | "debug";

class WaffawLogger {
  private logLevel: LogLevel;
  private campaign: string;
  private sourceIp: string;
  private nodeRank: number;
  private nodeTotal: number;
  private nodeId: string;
  private nodeType: string;
  private region: string;

  constructor(config: { logLevel?: string }, events: any) {
    this.logLevel = (config.logLevel || process.env.LOG_LEVEL || "normal") as LogLevel;
    this.campaign = process.env.CAMPAIGN_NAME || "unknown";
    this.sourceIp = process.env.MY_IP || "0.0.0.0";
    this.nodeRank = parseInt(process.env.NODE_RANK || "0", 10);
    this.nodeTotal = parseInt(process.env.NODE_TOTAL || "0", 10);
    this.nodeId = process.env.NODE_ID || "unknown";
    this.nodeType = process.env.NODE_TYPE || "unknown";
    this.region = process.env.REGION || "unknown";

    // Hook into Artillery events
    events.on("request", this.onRequest.bind(this));
    events.on("error", this.onError.bind(this));
  }

  private onRequest(requestParams: any, response: any, context: any, events: any) {
    const record: WaffawLogRecord = {
      timestamp: new Date().toISOString(),
      campaign: this.campaign,
      source_ip: this.sourceIp,
      node_rank: this.nodeRank,
      node_total: this.nodeTotal,
      target_url: response?.request?.uri?.href || requestParams?.url || "",
      method: requestParams?.method || "GET",
      status_code: response?.statusCode || 0,
      response_time_ms: response?.timings?.phases?.total || 0,
      scenario: context?._scenario?.name || "unknown",
      engine: context?._engineName || "http",
      node_id: this.nodeId,
      node_type: this.nodeType,
      region: this.region,
    };

    // Verbose: add headers
    if (this.logLevel === "verbose" || this.logLevel === "debug") {
      record.request_headers = response?.request?.headers || {};
      record.response_headers = response?.headers || {};
    }

    // Debug: add body preview, page title, console errors
    if (this.logLevel === "debug") {
      const body = response?.body || "";
      record.response_body_preview =
        typeof body === "string" ? body.slice(0, 1024) : JSON.stringify(body).slice(0, 1024);
      record.page_title = context?._pageTitle || "";
      record.console_errors = context?._consoleErrors || [];
    }

    // NDJSON to stdout
    process.stdout.write(JSON.stringify(record) + "\n");
  }

  private onError(error: any) {
    const record = {
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
      error: error?.message || String(error),
    };
    process.stdout.write(JSON.stringify(record) + "\n");
  }
}

module.exports = WaffawLogger;
