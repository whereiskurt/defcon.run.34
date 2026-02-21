# WAFFAW Design Document

**WAF Testing Platform for DEF CON 34**

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [S3 Control Plane](#s3-control-plane)
4. [Node Agent](#node-agent-agentsh)
5. [Roll Call Consensus Protocol](#roll-call-consensus-protocol)
6. [Traffic Generation](#traffic-generation)
7. [Container Image](#container-image)
8. [Logging & Athena Pipeline](#logging--athena-pipeline)
9. [ConfigUI Integration](#configui-integration)
10. [Terraform Module Structure](#terraform-module-structure)
11. [App Structure](#app-structure)
12. [Cost Estimates](#cost-estimates-spot-pricing)
13. [EC2 Multi-ENI Source IP Binding](#ec2-multi-eni-source-ip-binding)
14. [Key Design Decisions](#key-design-decisions)

---

## Overview

Waffaw is a WAF (Web Application Firewall) testing platform for defensive security testing at DEF CON 34. The name is a playful riff on "WAF" — pronounced like "waffle."

The platform deploys a fleet of EC2 instances and ECS Fargate tasks across AWS regions. Each node gets a unique public IP address for testing WAF detection capabilities. The core insight is that effective WAF testing requires traffic that looks indistinguishable from real users at the protocol level — so waffaw uses headless Chromium via Artillery's Playwright engine, producing real browser TLS fingerprints (JA3/JA4) that WAFs cannot trivially classify as automated.

S3 serves as the sole control plane. There is no SSM, no Lambda, no API Gateway. Nodes poll S3 for commands, upload results to S3, and coordinate with each other through S3's strong read-after-write consistency. This is "RCE by design" — drop a shell script into S3 and every node in the fleet executes it.

The platform is integrated into the existing ConfigUI as a full-width panel in a new "Apps" section, providing fleet management, campaign control, live log streaming, and post-campaign analytics powered by Athena.

---

## Architecture

### Infrastructure

Each waffaw deployment gets its own isolated infrastructure, completely separate from the production defcon.run services:

- **Own VPC per region** with **public subnets only**. There are no private subnets and no NAT gateway. This saves approximately $65/month per region in NAT gateway costs. Traffic generators MUST hit the WAF from the public internet, not through an internal VPC path, so private subnets serve no purpose.
- **Own ECS cluster per region**, dedicated and isolated from the production ECS cluster that runs run.human, run.auth, run.gpx, and run.cms.
- **Single region deployment initially** using the primary region from `site.hcl` (currently `us-east-1`).
- **Multi-region expansion** is supported — the module can be instantiated in `ca-central-1` and `ap-southeast-1` when geographic diversity is needed.

### Two-Tier Fleet

The fleet uses two complementary tiers, each optimized for different testing patterns.

#### Tier 1: EC2 Instances (Stable IPs)

EC2 instances provide stable, persistent IP addresses that survive stop/start cycles. This makes them ideal for:

- **Low-and-slow attacks**: Building up a request history over hours or days from the same IP.
- **Reputation building**: Establishing an IP as "normal" before transitioning to malicious behavior.
- **Persistent sessions**: Maintaining login sessions, cookies, and application state across long campaigns.

Technical details:

- Elastic IPs are attached to each instance and persist across stop/start cycles.
- Optional **multi-ENI** configuration for IP density: a `t4g.medium` supports 3 ENIs with up to 6 IPv4 addresses each, yielding up to 18 unique public IPs per instance.
- Uses **Spot instances by default** for approximately 85% cost savings. The workload is inherently interruption-tolerant — losing a traffic generator mid-campaign is acceptable.
- Deployed via an Auto Scaling Group (ASG) with a **mixed instances policy**. The primary instance type is `t4g.medium` with fallbacks to `t4g.large` and `t3.medium` to maximize Spot availability.
- Spot configuration: `spot_instance_type = "persistent"` with `instance_interruption_behavior = "stop"`. This preserves the Elastic IP association when AWS reclaims the Spot capacity — the instance stops rather than terminates, and can resume when capacity returns.
- **EC2 count can be 0**. Setting `ec2_count = 0` deploys no EC2 instances at all, running the fleet entirely on Fargate. This is the default.

#### Tier 2: ECS Fargate Tasks (Rotating IPs)

Fargate tasks provide ephemeral, rotating IP addresses. Each task gets exactly one ENI (awsvpc networking mode) with `assign_public_ip = true`, giving it one unique public IP. When the task restarts, it gets a new IP. This tests whether the WAF can correlate malicious behavior across IP address changes — detecting the actor rather than just the address.

Technical details:

- Each task = 1 ENI = 1 unique public IP.
- IPs change on every task restart, providing natural IP rotation.
- Uses **FARGATE_SPOT** capacity provider for approximately 70% cost savings over standard Fargate pricing.
- `desired_count = 0` for the fully stopped state (no running tasks, no cost).
- Task sizing options:
  - **1 vCPU / 2 GB**: Runs 1 concurrent headless Chromium browser. This is the default and sufficient for most campaigns.
  - **2 vCPU / 4 GB**: Runs 2 concurrent browsers for higher throughput per task.

### IP Budget

The IP budget depends on fleet configuration:

| Configuration | Unique IPs |
|---|---|
| Default (single region): EC2 0 + Fargate 5 | 5 unique IPs |
| Medium: EC2 3 (single ENI) + Fargate 10 | 13 unique IPs |
| Full (single region): EC2 3 x 3 ENIs (9 stable) + Fargate 10 (rotating) | 19+ unique IPs |
| Multi-region (3 regions x ~20 per region) | 60+ unique IPs |

### AWS Quota Increases Needed

Several AWS service quotas may need to be increased before deploying a full fleet:

| Quota | Default Limit | Recommended Request | Why |
|---|---|---|---|
| Elastic IPs per region | 5 | 25-65 | Multi-ENI EC2 instances consume multiple EIPs each |
| Fargate On-Demand vCPUs | 6 | 30-60 | 10 tasks x 2 vCPU = 20 vCPUs minimum |
| VPCs per region | 5 | 7 | Waffaw needs its own VPC alongside production |

Quota increase requests can be submitted via the AWS Service Quotas console or CLI. They typically take 1-3 business days to process.

---

## S3 Control Plane

S3 is the sole coordination mechanism for the entire fleet. There are no other control plane components — no SSM Run Command, no Lambda functions, no API Gateway endpoints. This is intentionally simple: the control bucket is a filesystem that nodes poll, and dropping a script into the right path is equivalent to remote code execution on every node in the fleet.

### Bucket Structure

```
s3://waffaw-control-${account_id}/
|
+-- campaign-state.json              # One campaign at a time (source of truth)
|   {
|     "status": "idle|running|halted",
|     "campaign": "low-and-slow",
|     "started_at": "2026-02-20T14:30:00Z",
|     "started_by": "configui",
|     "target_url": "https://defcon.run",
|     "log_level": "verbose",
|     "expected_nodes": 5
|   }
|
+-- global/
|   +-- run/                         # Scripts ALL nodes execute
|   |   +-- *.sh                     # Timestamped: 20260220-143000-a1b2.sh
|   +-- halt                         # Touch = emergency stop all nodes
|
+-- consensus/
|   +-- current/                     # Wiped on new campaign start
|       +-- roll-call/               # Phase 1: node check-in
|       |   +-- {ip}.json
|       +-- roster.d/                # Phase 2: confirmed ranks
|           +-- {ip}.json
|
+-- nodes/
|   +-- {ip}/                        # Self-registered per node
|       +-- meta.json                # Identity + capabilities
|       +-- alive.txt                # Heartbeat (30s interval)
|       +-- run/                     # Scripts for THIS node only
|       +-- output/                  # Execution logs uploaded here
|
+-- templates/                       # Campaign YAML templates
|   +-- low-and-slow.yml
|   +-- auth-cycle.yml
|   +-- public-flood.yml
|   +-- crawl-and-probe.yml
|   +-- custom/                      # User-uploaded custom templates
|
+-- scenarios/                       # Playwright .ts building blocks
+-- data/                            # Test data (users.csv, pages.csv)
|
+-- logs/                            # Firehose destination for Athena
    +-- campaign={name}/date={date}/hour={HH}/region={region}/
        +-- *.json.gz
```

### One Campaign at a Time

The system enforces a single-campaign constraint:

- `campaign-state.json` is the single source of truth for campaign status.
- The ConfigUI checks this file before allowing a campaign launch. If `status` is `running`, the Launch Campaign button is disabled and shows the current campaign name and duration.
- To start a new campaign, the operator must first halt the current one.
- Every node checks `campaign-state.json` on every poll cycle and respects the status field.

### Lifecycle Rules

The control bucket has S3 lifecycle rules to prevent unbounded growth:

- `nodes/*/alive.txt`: 1-day expiry (heartbeats are ephemeral).
- `nodes/*/output/`: 7-day expiry (execution logs are short-lived; real logs go to CloudWatch/Firehose).
- `consensus/current/`: Wiped programmatically on each new campaign start, not by lifecycle rule.

---

## Node Agent (agent.sh)

The agent is a bash script that runs as PID 1 (the container/instance entrypoint) on every node in the fleet, both EC2 and Fargate. It is the only long-running process on each node — everything else is launched by the agent in response to scripts dropped into S3.

### Behavior

1. **Discover public IP** via the EC2 Instance Metadata Service (IMDS) at `http://169.254.169.254/latest/meta-data/public-ipv4` or, as a fallback, via `https://checkip.amazonaws.com`. On Fargate, IMDS is available through the task metadata endpoint.

2. **Self-register** by creating `nodes/{ip}/meta.json` in the control bucket:
   ```json
   {
     "ip": "54.210.33.12",
     "region": "us-east-1",
     "node_id": "i-0abc123def",
     "node_type": "fargate",
     "instance_type": "fargate",
     "started_at": "2026-02-20T14:30:00Z",
     "agent_version": "1.0.0"
   }
   ```

3. **Main loop** (every 30 seconds):
   - **Heartbeat**: Updates `nodes/{ip}/alive.txt` with the current ISO 8601 timestamp.
   - **Halt check**: Checks for `global/halt` — if the object exists, kills all child processes immediately (`kill -TERM -- -$$`), updates status, and enters a tight loop waiting for the halt flag to be removed or for the container to be stopped.
   - **Global scripts**: Syncs `global/run/` directory. For each script found, computes its SHA-256 content hash. If the hash (first 12 characters) has not been seen before (tracked in `/tmp/waffaw/executed/`), executes the script in the background and records the hash. Uploads stdout/stderr to `nodes/{ip}/output/{script_name}.{timestamp}.log`.
   - **Node-specific scripts**: Same process for `nodes/{ip}/run/` — scripts targeted at this specific node.

4. **Graceful shutdown**: On receiving SIGTERM or SIGINT, the agent removes the entire `nodes/{ip}/` folder from S3 (deregistration) and exits. This ensures the fleet status in the ConfigUI accurately reflects only live nodes.

### Script Tracking

Script execution is tracked by content hash, not by filename:

- When a script is found in `global/run/` or `nodes/{ip}/run/`, its SHA-256 hash is computed.
- The first 12 characters of the hex digest are used as the tracking key.
- A marker file is created at `/tmp/waffaw/executed/{hash_prefix}` after successful execution.
- This means:
  - The same script content will never run twice, even if the file is renamed.
  - Modifying even one byte of the script produces a new hash, triggering re-execution.
  - Uploading a script with the same name but different content will execute the new version.

### Environment Variables Available to Scripts

Every script executed by the agent has access to these environment variables:

```bash
MY_IP=54.210.33.12              # This node's public IP
REGION=us-east-1                # AWS region
NODE_ID=i-0abc123def            # Instance ID or Fargate hostname
NODE_TYPE=fargate               # "ec2" or "fargate"
INSTANCE_TYPE=fargate           # EC2 instance type (e.g., "t4g.medium") or "fargate"
NODE_RANK=3                     # Position in fleet (1-indexed, assigned by consensus)
NODE_TOTAL=5                    # Total nodes in fleet
NODE_PEERS=3.95.144.87,52.7.211.3,...  # Comma-separated list of all node IPs
CONTROL_BUCKET=waffaw-control-123456789
CAMPAIGN_NAME=low-and-slow
LOG_LEVEL=verbose               # "normal" | "verbose" | "debug"
SCENARIOS_DIR=/opt/waffaw/scenarios
TEMPLATES_DIR=/opt/waffaw/templates
DATA_DIR=/opt/waffaw/data
OUTPUT_DIR=/tmp/waffaw/output
```

These variables enable scripts to implement distributed behavior (e.g., staggering based on `NODE_RANK`, splitting work across `NODE_TOTAL` nodes, targeting different scenarios per node).

---

## Roll Call Consensus Protocol

The roll call consensus protocol gives every node in the fleet a deterministic rank ("I am node X of Y") without requiring leader election, voting rounds, or any coordination mechanism beyond S3.

The protocol relies on S3's **strong read-after-write consistency** (guaranteed since December 2020): after a successful PUT, any subsequent GET or LIST will return the new data.

### Algorithm

#### Phase 1: ROLL CALL

Each node writes its check-in file to the shared roll-call directory:

```
consensus/current/roll-call/{ip}.json
```

Contents include the node's metadata (IP, region, node type, capabilities). Each node then polls the roll-call directory, listing all entries, until one of two conditions is met:

- The count of entries is **>= expected_nodes** (from `campaign-state.json`).
- The **timeout is reached** (default: 90 seconds).

If the timeout fires before all expected nodes check in, the protocol proceeds with whatever nodes are present. This handles cases where a Spot instance was reclaimed or a task failed to start.

#### Phase 2: ROSTER

Once Phase 1 completes (enough nodes or timeout), every node independently computes the roster:

1. List all entries in `consensus/current/roll-call/`.
2. Sort IP addresses **numerically** — split each IP into four octets and compare as integers. For example: `3.95.144.87` < `52.7.211.3` < `54.210.33.12`.
3. Find this node's position in the sorted list. That position (1-indexed) is the node's **rank**.
4. Write the roster entry to `consensus/current/roster.d/{ip}.json`:
   ```json
   {
     "ip": "54.210.33.12",
     "rank": 3,
     "total": 5,
     "roster": ["3.95.144.87", "52.7.211.3", "54.210.33.12", "54.235.99.1", "100.27.44.55"]
   }
   ```

Because the sort is deterministic and all nodes see the same set of roll-call entries (thanks to S3 strong consistency), every node computes the same roster independently. No leader is needed.

#### Phase 3: CONFIRMATION

Each node waits until all peers have written their entries to `roster.d/`. This is a simple poll:

- List `consensus/current/roster.d/`.
- If count == total from Phase 2, consensus is achieved.
- Timeout: 60 seconds. If not all nodes confirm, proceed anyway (the roster is still valid; missing nodes simply did not acknowledge).

Once consensus is achieved, the agent sets `NODE_RANK`, `NODE_TOTAL`, and `NODE_PEERS` environment variables, and the campaign begins.

### Staggering Example

The primary use of node rank is to stagger campaign start times so that all nodes do not hit the target simultaneously at T=0:

```bash
STAGGER_SECONDS=$((NODE_RANK * 30))  # Node 1 at 0s, Node 2 at 30s, Node 3 at 60s, etc.
sleep ${STAGGER_SECONDS}
artillery run campaign.yml
```

This produces a gradual ramp-up that mimics organic traffic growth rather than a sudden burst from N sources simultaneously.

---

## Traffic Generation

### Recording Pipeline

The workflow for creating new attack scenarios follows a record-refactor-store-replay pipeline:

1. **Record**: Use Playwright's codegen tool on a developer's local machine to record a browser session against the target:
   ```bash
   npx playwright codegen https://target.defcon.run
   ```
   This produces a TypeScript file with all clicks, navigations, form fills, and assertions captured as Playwright API calls.

2. **Refactor**: Parameterize the recorded script:
   - Replace hardcoded URLs with `baseURL` from Artillery config.
   - Replace hardcoded credentials with environment variable references (`process.env.TEST_USER`).
   - Add think time between actions to simulate human behavior.
   - Extract reusable functions (login, logout, browse) into the scenarios library.

3. **Store**: Push the refined scenarios and campaign templates to the S3 control bucket:
   ```bash
   aws s3 sync scenarios/ s3://${CONTROL_BUCKET}/scenarios/
   aws s3 sync templates/ s3://${CONTROL_BUCKET}/templates/
   ```

4. **Replay**: Nodes pull scenarios and templates from S3 during campaign startup and execute them via Artillery with the Playwright engine.

### Why Artillery + Playwright

The choice of Artillery with the Playwright engine (rather than raw HTTP load testing tools) is driven by a single critical requirement: **the traffic must be indistinguishable from real browser traffic at the TLS and protocol level**.

- **Real Chromium TLS stack**: Playwright drives an actual Chromium binary. The TLS ClientHello, cipher suites, extensions, and handshake patterns produce authentic JA3 and JA4 fingerprints that match real Chrome browsers. WAFs that use TLS fingerprinting to detect automation tools (curl, Python requests, Go net/http) cannot distinguish waffaw traffic from a real user.
- **Full JavaScript execution**: The browser executes JavaScript, renders the DOM, and supports all browser APIs. WAF JavaScript challenges (like Cloudflare's JS challenge or AWS WAF Bot Control's client-side signals) are handled transparently.
- **Real DOM rendering**: Page loads, resource fetches, and rendering occur exactly as they would in a real browser. This defeats WAFs that look for missing resource loads or abnormal page interaction patterns.
- **Protocol-level tools are trivially detectable**: Tools like curl, k6 (HTTP engine), Python requests, and Go's net/http produce distinctive TLS fingerprints that any modern WAF can identify and block. Using these tools tests the WAF's ability to recognize known automation signatures, which is not particularly interesting. Waffaw tests the WAF's ability to detect malicious *behavior* — which is the harder and more valuable detection problem.
- **Playwright codegen compatibility**: Scripts recorded with `npx playwright codegen` need minimal adaptation to run under Artillery's Playwright engine. The recording workflow is fast and accessible.

### Campaign Templates

Four pre-built campaign templates cover the most common WAF testing scenarios:

#### low-and-slow.yml
- **Rate**: 1 request per second, sustained over 8 hours.
- **Pattern**: Randomly selects from all available scenarios. Includes long think times (10-60 seconds) between actions.
- **Tests**: WAF rate limiting thresholds, behavioral analysis over extended periods, session tracking.
- **Expected outcome**: Well-tuned WAFs should not block this. If they do, the rate limits are too aggressive.

#### auth-cycle.yml
- **Pattern**: Login with valid credentials, browse authenticated pages, logout, pause, repeat.
- **Rate**: 1 cycle per 5 minutes per node.
- **Tests**: Session-based WAF rules, credential stuffing detection, login anomaly detection.
- **Variations**: Some cycles use invalid credentials to test brute-force detection thresholds.

#### public-flood.yml
- **Rate**: High-rate requests (50-200 req/sec aggregate across fleet).
- **Engine**: Uses Artillery's **HTTP engine** (not Playwright) for this template — raw HTTP is sufficient and far more resource-efficient for high-volume public page requests.
- **Tests**: Volumetric rate limiting, DDoS protection thresholds, IP reputation scoring.
- **Note**: This is the one template where the HTTP engine is appropriate because the goal is volume, not stealth.

#### crawl-and-probe.yml
- **Pattern**: Spider the target site, discover pages, then inject light SQLi and XSS probes into form fields and URL parameters.
- **Rate**: Moderate (5-10 req/sec per node).
- **Tests**: WAF signature detection for SQLi/XSS payloads, path traversal detection, anomaly scoring for crawling behavior.
- **Payloads**: Common OWASP test strings, not actual exploits. The goal is to trigger WAF rules, not bypass them.

### Scenario Building Blocks (Playwright TypeScript)

Reusable scenario functions that campaign templates compose into full test flows:

| File | Function | Description |
|---|---|---|
| `login.ts` | `login(page, {url, user, pass})` | Navigate to login page, fill credentials, submit, wait for redirect |
| `logout.ts` | `logout(page)` | Click logout button/link, wait for session teardown |
| `browse-public.ts` | `browsePublic(page, {urls[], thinkTime})` | Visit a list of public URLs with configurable think time between each |
| `click-element.ts` | `clickElement(page, {url, selector, count})` | Navigate to URL and click a specific element N times |
| `form-submit.ts` | `submitForm(page, {url, fields})` | Navigate to URL, fill form fields, submit |
| `index.ts` | *(re-exports)* | Barrel file that re-exports all scenario functions |

### Log Levels

Log verbosity is configurable per campaign via the `log_level` field in `campaign-state.json`:

| Level | What Is Logged |
|---|---|
| **Normal** | Timestamp, URL, HTTP method, status code, response time in milliseconds |
| **Verbose** | Everything in Normal, plus request headers and response headers (especially WAF-related headers like `x-amzn-waf-action`, `x-amzn-trace-id`, `cf-ray`) |
| **Debug** | Everything in Verbose, plus response body (first 1 KB), page title, and browser console errors |

Debug mode produces significantly more data and should only be used for short diagnostic runs.

---

## Container Image

All nodes (EC2 and Fargate) run the same Docker image:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.50.0-noble

# System dependencies
RUN apt-get update && apt-get install -y \
    curl \
    unzip \
    jq \
    && rm -rf /var/lib/apt/lists/*

# AWS CLI v2
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf aws awscliv2.zip

# Artillery + Playwright engine
WORKDIR /opt/waffaw
COPY package.json package-lock.json ./
RUN npm ci --production

# Agent and scenarios
COPY agent.sh consensus.sh ./
COPY scenarios/ ./scenarios/
COPY templates/ ./templates/
COPY plugins/ ./plugins/
COPY data/ ./data/

RUN chmod +x agent.sh consensus.sh

ENTRYPOINT ["/opt/waffaw/agent.sh"]
```

Key specifications:

- **Base image**: Microsoft's official Playwright image, which includes Chromium, Firefox, and WebKit browsers pre-installed.
- **Image size**: Approximately 1.6 GB (Playwright + Chromium is the bulk of this).
- **Fargate pull time**: From same-region ECR, approximately 20 seconds.
- **Minimum task sizing**: 1 vCPU / 2 GB memory for one concurrent browser. Chromium with a single page consumes approximately 300-500 MB of RAM.

On EC2, the Docker image is pulled during instance bootstrap via the userdata script. On Fargate, the ECS agent pulls it automatically from ECR.

---

## Logging & Athena Pipeline

### Flow

```
Artillery (on each node)
  --> stdout NDJSON (one JSON object per line)
    --> CloudWatch Logs (via ECS awslogs driver or CW agent on EC2)
      --> CloudWatch Logs Subscription Filter (matches all log events)
        --> Kinesis Data Firehose delivery stream
          --> S3 (partitioned by campaign/date/hour/region, gzip compressed)
            --> AWS Glue Table (external table over S3 data)
              --> Amazon Athena (SQL queries)
```

The Artillery custom reporter plugin (`waffaw-logger.ts`) formats each request/response cycle as a single NDJSON line on stdout. CloudWatch Logs captures this via the standard container log driver. A subscription filter on the log group forwards matching events to Kinesis Firehose, which buffers, compresses, and writes to S3 with the correct partition structure.

### S3 Partition Scheme

```
s3://waffaw-logs-${account_id}/
  campaign={name}/date={YYYY-MM-DD}/hour={HH}/region={region}/
    *.json.gz
```

This partition scheme enables Athena to prune partitions efficiently:

- Query a single campaign without scanning others.
- Query a specific date range without scanning the full history.
- Query a specific hour for fine-grained analysis.
- Query a specific region to compare WAF behavior across geographies.

### Log Record Schema

Each log record is a JSON object with the following fields:

```json
{
  "timestamp": "2026-02-20T14:35:22.341Z",
  "campaign": "low-and-slow",
  "source_ip": "54.210.33.12",
  "node_rank": 3,
  "node_total": 5,
  "target_url": "https://defcon.run/schedule",
  "method": "GET",
  "status_code": 200,
  "response_time_ms": 342,
  "scenario": "browse-public",
  "engine": "playwright",
  "node_id": "i-0abc123def",
  "node_type": "fargate",
  "region": "us-east-1",
  "request_headers": {},
  "response_headers": {},
  "response_body_preview": "",
  "page_title": "",
  "console_errors": []
}
```

Field presence depends on the log level:

| Field | Normal | Verbose | Debug |
|---|---|---|---|
| `timestamp`, `campaign`, `source_ip`, `node_rank`, `node_total` | Yes | Yes | Yes |
| `target_url`, `method`, `status_code`, `response_time_ms` | Yes | Yes | Yes |
| `scenario`, `engine`, `node_id`, `node_type`, `region` | Yes | Yes | Yes |
| `request_headers` | No | Yes | Yes |
| `response_headers` | No | Yes | Yes |
| `response_body_preview` (first 1 KB) | No | No | Yes |
| `page_title` | No | No | Yes |
| `console_errors` | No | No | Yes |

### Pre-Built Athena Named Queries

Five named queries are created as part of the Terraform module and appear in the Athena console (and are callable from the ConfigUI Intel tab):

#### 1. Campaign Summary

```sql
SELECT
  campaign,
  COUNT(*) AS total_requests,
  COUNT(DISTINCT source_ip) AS unique_ips,
  MIN(timestamp) AS started,
  MAX(timestamp) AS ended,
  date_diff('minute', MIN(timestamp), MAX(timestamp)) AS duration_minutes,
  AVG(response_time_ms) AS avg_response_ms,
  COUNT(CASE WHEN status_code = 403 THEN 1 END) AS blocked,
  ROUND(COUNT(CASE WHEN status_code = 403 THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct
FROM waffaw_logs
WHERE campaign = '{campaign}'
GROUP BY campaign
```

Provides a single-row summary of the campaign: total volume, IP diversity, duration, and overall block rate.

#### 2. Time to Detection

```sql
SELECT
  source_ip,
  node_type,
  MIN(timestamp) AS first_request,
  MIN(CASE WHEN status_code = 403 THEN timestamp END) AS first_block,
  date_diff('minute',
    MIN(timestamp),
    MIN(CASE WHEN status_code = 403 THEN timestamp END)
  ) AS minutes_to_detect,
  COUNT(*) AS total_requests,
  COUNT(CASE WHEN status_code = 403 THEN 1 END) AS blocked_requests
FROM waffaw_logs
WHERE campaign = '{campaign}'
GROUP BY source_ip, node_type
ORDER BY minutes_to_detect ASC NULLS LAST
```

For each IP: when did it first appear, when was it first blocked, and how many minutes elapsed. IPs that were never blocked appear at the bottom with NULL detection time. This directly answers "how long does it take the WAF to catch a bad actor?"

#### 3. Block Rate by Scenario

```sql
SELECT
  scenario,
  COUNT(*) AS total,
  COUNT(CASE WHEN status_code = 403 THEN 1 END) AS blocked,
  ROUND(COUNT(CASE WHEN status_code = 403 THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct
FROM waffaw_logs
WHERE campaign = '{campaign}'
GROUP BY scenario
ORDER BY block_rate_pct DESC
```

Shows which attack patterns get caught and which slip through. A scenario with 0% block rate indicates a WAF gap.

#### 4. Hourly Volume

```sql
SELECT
  date_format(timestamp, '%Y-%m-%d %H:00') AS hour,
  COUNT(*) AS requests,
  COUNT(CASE WHEN status_code = 403 THEN 1 END) AS blocked,
  ROUND(COUNT(CASE WHEN status_code = 403 THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct
FROM waffaw_logs
WHERE campaign = '{campaign}'
GROUP BY date_format(timestamp, '%Y-%m-%d %H:00')
ORDER BY hour
```

Shows request volume and block rate hour-by-hour. Useful for observing WAF learning behavior — does the block rate increase over time as the WAF builds confidence?

#### 5. Cross-IP Correlation

```sql
SELECT
  node_type,
  COUNT(DISTINCT source_ip) AS unique_ips,
  COUNT(*) AS total_requests,
  COUNT(CASE WHEN status_code = 403 THEN 1 END) AS blocked,
  ROUND(COUNT(CASE WHEN status_code = 403 THEN 1 END) * 100.0 / COUNT(*), 1) AS block_rate_pct
FROM waffaw_logs
WHERE campaign = '{campaign}'
GROUP BY node_type
```

Compares block rates between EC2 (stable IPs) and Fargate (rotating IPs). If Fargate nodes with rotating IPs have a high block rate, the WAF is likely performing behavioral detection (correlating activity patterns across IP changes) rather than simple IP reputation blocking.

---

## ConfigUI Integration

### New Section: Apps

The ConfigUI gains a new top-level section called **Apps**, positioned below the existing Core, Infrastructure, and Services sections. This section uses full-width panels (`md:col-span-2` in the Tailwind grid) and follows the same collapse/expand pattern as existing sections.

The Apps section is designed to host multiple application-specific control panels. Waffaw is the first.

### Waffaw Panel (module-num: A1)

The waffaw panel is a full-width panel with a tabbed interface. It uses `module-num: A1` in the section numbering scheme (A for Apps, 1 for the first panel).

The panel has 4 tabs:

```
+--------+-----------+-------+---------+
| Fleet  | Campaign  | Logs  | Intel   |
+--------+-----------+-------+---------+
```

### Tab: Fleet

The Fleet tab manages the infrastructure configuration and displays live node status.

**Form Fields (Terraform Inputs)**:

| Field | Type | Default | Description |
|---|---|---|---|
| `ec2_count` | number | 0 | Number of EC2 instances (0 = none) |
| `ec2_instance_type` | dropdown | t4g.medium | EC2 instance type |
| `ec2_use_spot` | toggle | true | Use Spot instances |
| `ec2_multi_eni` | toggle | false | Attach extra ENIs for IP density |
| `ecs_desired_count` | number | 0 | Number of Fargate tasks (0 = stopped) |
| `ecs_use_spot` | toggle | true | Use FARGATE_SPOT capacity provider |
| `ecs_task_cpu` | dropdown | 1024 | Task CPU (1024 or 2048) |
| `ecs_task_memory` | dropdown | 2048 | Task memory (2048 or 4096) |

**Active Nodes Table**:

The table polls the S3 control bucket every 30 seconds via HTMX (`hx-trigger="every 30s"`) and displays all registered nodes:

| Column | Description |
|---|---|
| ## | Row number |
| Flag | Country flag emoji derived from AWS region (see mapping below) |
| IP Address | Node's public IP |
| Type | `ec2` or `fargate` |
| Status | `online` (alive.txt < 2 min old) or `stale` (alive.txt >= 2 min old) |
| Rank | X/Y from consensus (e.g., "3/5") |
| Uptime | Duration since `meta.json` `started_at` |
| Actions | Clipboard icon (copy IP), upload icon (send script to this node's `run/` path) |

**Region-to-Flag Mapping**:

| Region | Flag |
|---|---|
| us-east-1 | US |
| us-east-2 | US |
| us-west-1 | US |
| us-west-2 | US |
| ca-central-1 | CA |
| eu-west-1 | IE |
| eu-west-2 | GB |
| eu-central-1 | DE |
| ap-southeast-1 | SG |
| ap-southeast-2 | AU |
| ap-northeast-1 | JP |
| ap-northeast-2 | KR |
| ap-south-1 | IN |
| sa-east-1 | BR |

**Stale Detection**: A node is considered stale if its `alive.txt` timestamp is more than 2 minutes old. Stale nodes are displayed with a dimmed row and a warning indicator. Stale nodes are NOT automatically removed — they may recover (e.g., a Spot instance being resumed).

### Tab: Campaign

The Campaign tab controls campaign lifecycle.

**Form Fields**:

| Field | Type | Options |
|---|---|---|
| Template | dropdown | Low & Slow, Auth Cycle, Public Flood, Crawl & Probe, Custom (triggers file upload) |
| Log Level | dropdown | Normal, Verbose (+ headers), Debug (+ response body) |
| Target URL | text input | e.g., `https://defcon.run` |

**Buttons**:

- **Launch Campaign**: Writes `campaign-state.json` with `status: "running"`, clears `consensus/current/`, and uploads the selected template to `global/run/`. Disabled (grayed out, with tooltip) if a campaign is already running.
- **Halt Campaign**: Creates the `global/halt` object in S3. Updates `campaign-state.json` to `status: "halted"`. All nodes detect the halt flag on their next poll cycle and kill running work.

**Status Display**: Shows the current campaign state:
- **Idle**: "No campaign running" — Launch button enabled.
- **Running**: "Campaign '{name}' running for {duration}" — Launch disabled, Halt enabled.
- **Halted**: "Campaign '{name}' halted at {time}" — Launch enabled (after clearing halt flag).

### Tab: Logs

The Logs tab provides a live log viewer using Server-Sent Events (SSE), following the same pattern as the existing terminal streaming in ConfigUI.

**Data Source**: CloudWatch Logs `FilterLogEvents` API, called from the Go backend. The backend tails the waffaw log group and streams matching events to the browser via SSE.

**Controls**:

| Control | Type | Description |
|---|---|---|
| Node Filter | dropdown | "All Nodes" or specific IP address |
| Auto-scroll | toggle | When enabled, the log view scrolls to the bottom on each new event |

**Log Line Format**:

Each log line displays:
```
14:35:22.341  US 54.210.33.12  [3/5]  GET  /schedule  200  342ms
```

- Timestamp (HH:MM:SS.mmm)
- Flag emoji + source IP
- Rank in brackets [rank/total]
- HTTP method
- URL path
- Status code (color-coded: 2xx green, 3xx blue, 4xx yellow, 403 red, 5xx red)
- Response time

In verbose mode, each line is expandable (click to reveal):
- Request headers (formatted as key: value pairs)
- Response headers (with WAF-specific headers highlighted)

In debug mode, expandable sections also include:
- Response body preview (first 1 KB, syntax-highlighted if HTML/JSON)
- Page title
- Browser console errors

**Footer**: Shows a live indicator (pulsing dot), request rate (req/sec), and block percentage (e.g., "12.3% blocked").

**SSE Lifecycle**: The SSE connection is established when the Logs tab is activated and closed when the user switches to another tab. This prevents unnecessary CloudWatch API calls when the logs are not being viewed.

### Tab: Intel (Athena Dashboard)

The Intel tab provides post-campaign analytics powered by Athena.

**Workflow**:

1. User clicks "Run Analysis" button.
2. The Go backend (`handleWAFIntel`) submits all 5 named queries in parallel via `athena.StartQueryExecution`.
3. Backend polls each query's status via `athena.GetQueryExecution` until completion (typical time: 2-8 seconds on small datasets).
4. Backend retrieves results via `athena.GetQueryResults` and returns them as JSON.
5. Frontend renders the dashboard.

**Dashboard Sections**:

#### 1. Summary Cards

Four cards displayed in a horizontal row:

| Card | Value | Color Logic |
|---|---|---|
| Total Requests | e.g., "12,847" | Neutral |
| Unique IPs | e.g., "5" | Neutral |
| Duration | e.g., "4h 23m" | Neutral |
| Block Rate | e.g., "8.3%" | Green (< 5%), Yellow (5-20%), Red (> 20%) |

#### 2. Time to Detection Table

| Source IP | Type | First Request | First Block | Minutes to Detect | Status |
|---|---|---|---|---|---|
| 54.210.33.12 | fargate | 14:30:00 | 14:47:22 | 17 | Detected |
| 3.95.144.87 | ec2 | 14:30:00 | -- | -- | Undetected |

Status is "Detected" (with red badge) if `first_block` is non-null, "Undetected" (with green badge) if null.

#### 3. Block Rate by Scenario

Horizontal bar chart rendered with inline CSS (no charting library). Each scenario gets a row:

```
browse-public   |====                | 4.2%
auth-cycle      |========            | 8.1%
crawl-and-probe |==================  | 92.3%
form-submit     |===========         | 11.7%
```

Bars are color-coded: green for low block rate, red for high.

#### 4. Hourly Volume

Table with inline sparkline bars (rendered as CSS `background-size` on a div):

| Hour | Requests | Blocked | Block Rate | Volume |
|---|---|---|---|---|
| 14:00 | 1,203 | 12 | 1.0% | [green bar] [tiny red bar] |
| 15:00 | 1,547 | 89 | 5.8% | [green bar] [red bar] |
| 16:00 | 1,612 | 234 | 14.5% | [green bar] [larger red bar] |

The visual trend reveals whether the WAF's detection improves over time (increasing block rate).

#### 5. Cross-IP Correlation

Compares EC2 (stable IPs) vs Fargate (rotating IPs):

| Node Type | Unique IPs | Total Requests | Blocked | Block Rate |
|---|---|---|---|---|
| ec2 | 3 | 4,521 | 892 | 19.7% |
| fargate | 8 | 8,326 | 1,403 | 16.8% |

Below the table, an automated assessment:
- If Fargate block rate is high (> 10%): **"Behavioral detection likely"** — the WAF is detecting the malicious behavior pattern even across IP address changes.
- If Fargate block rate is low but EC2 is high: **"IP reputation based"** — the WAF is blocking based on IP history, not behavior.
- If both are low: **"WAF may not be detecting this campaign pattern."**

**Footer**: "Refresh" button with a "Last run: {timestamp}" label.

### Go Backend Additions

#### waftest.go

A new file `apps/configui/waftest.go` containing all waffaw-related HTTP handlers:

| Handler | Method | Path | Description |
|---|---|---|---|
| `handleWAFFleetStatus` | GET | `/api/waf/fleet` | Lists nodes from S3, returns HTML partial for HTMX |
| `handleWAFCommand` | POST | `/api/waf/command` | Uploads script to `global/run/` or `nodes/{ip}/run/` |
| `handleWAFCampaign` | POST | `/api/waf/campaign` | Starts or halts a campaign |
| `handleWAFLogs` | GET | `/api/waf/logs` | SSE stream from CloudWatch Logs |
| `handleWAFIntel` | POST | `/api/waf/intel` | Runs Athena queries, returns JSON results |

**Config Struct**:

```go
type WaffawConfig struct {
    Enabled         bool   `json:"enabled"`
    EC2Count        int    `json:"ec2_count"`
    EC2MaxCount     int    `json:"ec2_max_count"`
    EC2InstanceType string `json:"ec2_instance_type"`
    EC2UseSpot      bool   `json:"ec2_use_spot"`
    EC2MultiENI     bool   `json:"ec2_multi_eni"`
    ECSDesiredCount int    `json:"ecs_desired_count"`
    ECSUseSpot      bool   `json:"ecs_use_spot"`
    ECSTaskCPU      int    `json:"ecs_task_cpu"`
    ECSTaskMemory   int    `json:"ecs_task_memory"`
}
```

**Region-to-Flag Mapping** (Go):

```go
var regionFlags = map[string]string{
    "us-east-1":      "\U0001F1FA\U0001F1F8",
    "us-east-2":      "\U0001F1FA\U0001F1F8",
    "us-west-1":      "\U0001F1FA\U0001F1F8",
    "us-west-2":      "\U0001F1FA\U0001F1F8",
    "ca-central-1":   "\U0001F1E8\U0001F1E6",
    "eu-west-1":      "\U0001F1EE\U0001F1EA",
    "eu-west-2":      "\U0001F1EC\U0001F1E7",
    "eu-central-1":   "\U0001F1E9\U0001F1EA",
    "ap-southeast-1": "\U0001F1F8\U0001F1EC",
    "ap-southeast-2": "\U0001F1E6\U0001F1FA",
    "ap-northeast-1": "\U0001F1EF\U0001F1F5",
    "ap-northeast-2": "\U0001F1F0\U0001F1F7",
    "ap-south-1":     "\U0001F1EE\U0001F1F3",
    "sa-east-1":      "\U0001F1E7\U0001F1F7",
}
```

**Athena Client**: Uses the AWS SDK v2 Athena client. Queries are submitted with `StartQueryExecution`, polled with `GetQueryExecution` (100ms interval, 30-second timeout), and results retrieved with `GetQueryResults`. The workgroup is `waffaw` (created by Terraform) and the output location is `s3://waffaw-logs-${account_id}/athena-results/`.

### Frontend Additions (app.js)

New JavaScript functions added to `apps/configui/static/app.js`:

| Function | Description |
|---|---|
| `switchWaffawTab(tabName)` | Shows/hides tab content, updates tab button styling, manages SSE lifecycle |
| `sendWAFCommand(targetIP)` | Prompts for script content, POSTs to `/api/waf/command` with target IP (or 'global') |
| `launchWAFCampaign()` | Collects form values, POSTs to `/api/waf/campaign` with action='start' |
| `haltWAFFleet()` | POSTs to `/api/waf/campaign` with action='halt', confirms with dialog first |
| `startWAFLogStream()` | Opens EventSource to `/api/waf/logs`, appends log lines to viewer |
| `stopWAFLogStream()` | Closes the EventSource connection |
| `runWAFIntel()` | POSTs to `/api/waf/intel`, renders dashboard sections from JSON response |

---

## Terraform Module Structure

```
infra/terraform/modules/waffaw/v1.0.0/
+-- network.tf              # VPC (public-only), subnets, IGW, route tables, security groups
+-- ec2.tf                  # Launch template, ASG with mixed instances policy (spot)
+-- ec2-userdata.sh.tpl     # Bootstrap: install Docker, pull ECR image, start agent
+-- ecs.tf                  # ECS cluster (FARGATE_SPOT), task definition, service
+-- s3-control.tf           # Control bucket, lifecycle rules, bucket policy
+-- s3-logs.tf              # Log bucket (Firehose destination), lifecycle rules
+-- iam.tf                  # IAM roles: node role (S3 rw, CW Logs), Firehose role, Athena role
+-- logging.tf              # CloudWatch log group, subscription filter, Firehose delivery stream
+-- athena.tf               # Glue database, Glue table, Athena workgroup, 5 named queries
+-- variables.tf            # All input variables
+-- outputs.tf              # Control bucket name, log bucket name, VPC ID, node role ARN
```

### File Details

#### network.tf

- VPC with a `/16` CIDR (e.g., `10.100.0.0/16`).
- Public subnets only — one per AZ (typically 2-3 per region).
- Internet Gateway attached to the VPC.
- Route table with `0.0.0.0/0 -> IGW` for all subnets.
- Security groups:
  - **Node SG**: Egress all (nodes need to reach the internet). No ingress (nodes initiate all connections).
  - No NAT gateway. No private subnets. No VPC endpoints (S3 and CloudWatch are accessed via public endpoints).

#### ec2.tf

- Launch template with the waffaw Docker image URI, IAM instance profile, and security group.
- ASG with mixed instances policy:
  ```hcl
  mixed_instances_policy {
    instances_distribution {
      on_demand_base_capacity                  = 0
      on_demand_percentage_above_base_capacity = var.waffaw.ec2_use_spot ? 0 : 100
      spot_allocation_strategy                 = "capacity-optimized"
    }
    launch_template {
      launch_template_specification { ... }
      override {
        instance_type = var.waffaw.ec2_instance_type
      }
      override {
        instance_type = "t4g.large"
      }
      override {
        instance_type = "t3.medium"
      }
    }
  }
  ```
- `min_size = 0`, `max_size = var.waffaw.ec2_max_count`, `desired_capacity = var.waffaw.ec2_count`.
- Conditional on `var.waffaw.ec2_count > 0` (uses `count`).

#### ec2-userdata.sh.tpl

```bash
#!/bin/bash
set -euo pipefail

# Install Docker
yum install -y docker
systemctl enable --now docker

# Login to ECR
aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${ecr_repo}

# Pull and run the waffaw agent
docker pull ${image_uri}
docker run -d \
  --restart=always \
  --name waffaw-agent \
  -e CONTROL_BUCKET=${control_bucket} \
  -e REGION=${region} \
  -e NODE_TYPE=ec2 \
  -e LOG_LEVEL=${log_level} \
  ${image_uri}
```

#### ecs.tf

- ECS cluster with `FARGATE_SPOT` as the default capacity provider (when `var.waffaw.ecs_use_spot = true`), falling back to `FARGATE` otherwise.
- Task definition:
  - `network_mode = "awsvpc"` (required for Fargate, gives each task its own ENI).
  - `cpu = var.waffaw.ecs_task_cpu`, `memory = var.waffaw.ecs_task_memory`.
  - Container definition with the waffaw image, environment variables, and log configuration pointing to the CloudWatch log group.
- Service:
  - `desired_count = var.waffaw.ecs_desired_count`.
  - `assign_public_ip = true` in the network configuration.
  - Subnets from the waffaw VPC public subnets.
  - Security group from `network.tf`.

#### s3-control.tf

- Bucket: `waffaw-control-${data.aws_caller_identity.current.account_id}`.
- Server-side encryption (AES-256).
- Lifecycle rules:
  - `nodes/*/alive.txt`: expire after 1 day.
  - `nodes/*/output/`: expire after 7 days.
- Bucket policy: allow the node IAM role to read/write.
- Versioning disabled (not needed, adds cost).

#### s3-logs.tf

- Bucket: `waffaw-logs-${data.aws_caller_identity.current.account_id}`.
- Lifecycle rules: transition to Glacier after 30 days, expire after 90 days.
- Bucket policy: allow Firehose delivery role to write.

#### iam.tf

Three IAM roles:

1. **Node Role** (used by both EC2 instance profile and ECS task role):
   - `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on the control bucket.
   - `logs:CreateLogStream`, `logs:PutLogEvents` on the waffaw log group.
   - `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage` for pulling the Docker image.

2. **Firehose Delivery Role**:
   - `s3:PutObject`, `s3:GetBucketLocation` on the logs bucket.
   - `logs:GetLogEvents` on the waffaw log group.

3. **Athena/Glue Role** (used by ConfigUI):
   - `athena:StartQueryExecution`, `athena:GetQueryExecution`, `athena:GetQueryResults`.
   - `glue:GetTable`, `glue:GetDatabase`.
   - `s3:GetObject`, `s3:ListBucket` on the logs bucket.
   - `s3:PutObject` on the Athena results prefix.

#### logging.tf

- CloudWatch log group: `/waffaw/${var.region}` with 7-day retention.
- Subscription filter: matches all events in the log group, forwards to Firehose.
- Kinesis Firehose delivery stream:
  - Buffer: 60 seconds or 5 MB (whichever comes first).
  - Compression: GZIP.
  - S3 prefix: `campaign=!{partitionKeyFromQuery:campaign}/date=!{timestamp:yyyy-MM-dd}/hour=!{timestamp:HH}/region=${var.region}/`.
  - Dynamic partitioning enabled with JQ expression to extract `campaign` from log records.

#### athena.tf

- Glue database: `waffaw`.
- Glue table: `waffaw_logs` with columns matching the log record schema, partitioned by `campaign`, `date`, `hour`, and `region`. Storage descriptor points to the S3 logs bucket with `org.openx.data.jsonserde.JsonSerDe`.
- Athena workgroup: `waffaw` with output location `s3://waffaw-logs-${account_id}/athena-results/`, engine version Athena v3.
- 5 named queries (as described in the Athena section above).

### Variables

```hcl
variable "waffaw" {
  description = "WAF testing platform configuration"
  type = object({
    enabled           = bool           # Deploy/destroy the entire waffaw stack
    ec2_count         = number         # Number of EC2 instances. 0 = no EC2 at all.
    ec2_max_count     = number         # ASG maximum size
    ec2_instance_type = string         # EC2 instance type
    ec2_use_spot      = bool           # Use Spot instances (85% savings)
    ec2_multi_eni     = bool           # Attach extra ENIs for IP density
    ecs_desired_count = number         # Number of Fargate tasks. 0 = stopped.
    ecs_use_spot      = bool           # Use FARGATE_SPOT capacity provider (70% savings)
    ecs_task_cpu      = number         # Task CPU in units (1024 = 1 vCPU)
    ecs_task_memory   = number         # Task memory in MiB
  })
  default = {
    enabled           = false
    ec2_count         = 0
    ec2_max_count     = 10
    ec2_instance_type = "t4g.medium"
    ec2_use_spot      = true
    ec2_multi_eni     = false
    ecs_desired_count = 0
    ecs_use_spot      = true
    ecs_task_cpu      = 1024
    ecs_task_memory   = 2048
  }
}
```

The `enabled = false` default means the entire waffaw stack is not deployed unless explicitly opted in. When `enabled = true` but both counts are 0, the infrastructure (VPC, ECS cluster, S3 buckets, Firehose, Athena) exists but no compute is running and costs are near zero.

---

## App Structure

### Waffaw Application

```
apps/waffaw/
+-- DESIGN.md                 # This document
+-- Dockerfile                # Container image (Playwright + Artillery + agent)
+-- agent.sh                  # S3 polling daemon (container entrypoint)
+-- consensus.sh              # Roll call consensus protocol implementation
+-- scenarios/
|   +-- login.ts              # login(page, {url, user, pass})
|   +-- logout.ts             # logout(page)
|   +-- browse-public.ts      # browsePublic(page, {urls[], thinkTime})
|   +-- click-element.ts      # clickElement(page, {url, selector, count})
|   +-- form-submit.ts        # submitForm(page, {url, fields})
|   +-- index.ts              # Barrel re-export of all scenarios
+-- templates/
|   +-- low-and-slow.yml      # 1 req/sec over 8 hours
|   +-- auth-cycle.yml        # Login/browse/logout loops
|   +-- public-flood.yml      # High-rate HTTP engine
|   +-- crawl-and-probe.yml   # Spider + SQLi/XSS probes
+-- plugins/
|   +-- waffaw-logger.ts      # Artillery reporter plugin (NDJSON output)
+-- data/
|   +-- users.csv             # Test credentials
|   +-- pages.csv             # Target URL list
+-- package.json              # Artillery + Playwright engine dependencies
+-- build.sh                  # Build and push Docker image to ECR
```

### ConfigUI Additions

```
apps/configui/
+-- waftest.go                # NEW: all waffaw API handlers
+-- templates/partials/
|   +-- waffaw.html           # Main panel (tabs container + section header)
|   +-- waffaw-fleet.html     # Fleet tab content
|   +-- waffaw-campaign.html  # Campaign tab content
|   +-- waffaw-logs.html      # Log viewer tab content
|   +-- waffaw-intel.html     # Athena dashboard tab content
+-- static/app.js             # + waffaw JavaScript functions appended
```

### Terragrunt Live Config

```
infra/terraform/live/site/
+-- region/{region}/waffaw/
    +-- terragrunt.hcl        # Sources modules/waffaw/v1.0.0, reads waffaw config from site.hcl
```

The Terragrunt configuration follows the existing pattern for regional resources. It reads the `waffaw` variable from the site-level configuration (or defaults) and passes it to the module.

---

## Cost Estimates (Spot Pricing)

All estimates use Spot pricing for the `us-east-1` region as of early 2026.

| Configuration | Per Hour | 8-Hour Campaign | Notes |
|---|---:|---:|---|
| 5 Fargate Spot tasks (1 vCPU / 2 GB each) | ~$0.075 | ~$0.60 | Default starting configuration |
| 10 Fargate Spot tasks | ~$0.15 | ~$1.20 | Double the IP diversity |
| 3 EC2 t4g.medium Spot + 5 Fargate Spot | ~$0.09 | ~$0.72 | Mixed stable + rotating IPs |
| Heavy: 3 EC2 Spot + 20 Fargate Spot | ~$0.32 | ~$2.52 | Full campaign configuration |
| Fully idle (all counts = 0, infra exists) | ~$0 | ~$0 | VPC, S3, Athena are free at rest |

Additional costs not in the per-hour estimate:
- **S3 storage**: Negligible (control plane data is tiny, logs are compressed).
- **CloudWatch Logs**: ~$0.50/GB ingested. A verbose 8-hour campaign might produce 100-500 MB.
- **Athena queries**: $5 per TB scanned. Typical campaign dataset is < 1 GB = $0.005 per query.
- **Elastic IPs**: Free while attached to a running instance. $0.005/hour when attached to a stopped instance.
- **ECR storage**: ~$0.10/GB/month. The waffaw image is ~1.6 GB.

---

## EC2 Multi-ENI Source IP Binding

When `ec2_multi_eni = true`, EC2 instances get additional ENIs attached, each with its own Elastic IP. To use these additional IPs as source addresses for browser traffic, Linux network namespaces are used to bind each browser process to a specific ENI.

### Implementation

```bash
# Create a network namespace for each additional ENI
ip netns add ns1
ip link set eth1 netns ns1
ip netns exec ns1 ip addr add 10.100.1.x/24 dev eth1
ip netns exec ns1 ip link set eth1 up
ip netns exec ns1 ip route add default via 10.100.1.1

# Run a browser process inside the namespace (traffic exits via eth1's EIP)
ip netns exec ns1 chromium --headless --no-sandbox ...
```

Each browser process lives in its own network namespace, bound to a specific ENI and therefore a specific public IP. From the WAF's perspective, each namespace appears as a completely independent source.

The agent handles namespace setup during initialization when it detects multiple ENIs. The `NODE_RANK` variable is extended to include sub-ranks for multi-ENI nodes (e.g., node 2 with 3 ENIs reports ranks 2a, 2b, 2c — but for simplicity in the consensus protocol, only the primary ENI participates in roll call).

---

## Key Design Decisions

1. **S3 as sole control plane** — No SSM, Lambda, or API Gateway. S3 polling is simple, reliable, and requires no additional infrastructure. The 30-second poll interval is acceptable for a testing tool (not real-time orchestration). This avoids the complexity of managing SSM agents, Lambda concurrency, or API Gateway endpoints.

2. **Content-hash tracking for script execution idempotency** — Using SHA-256 hashes of script content (rather than filenames or timestamps) ensures that the same script never runs twice, even if re-uploaded. Modified scripts automatically re-execute because their hash changes. This is simpler than maintaining a "last executed" pointer or sequence number.

3. **Artillery + Playwright for real browser TLS fingerprints (JA3/JA4)** — The entire value proposition of waffaw depends on generating traffic that WAFs cannot distinguish from real users at the protocol level. HTTP-only tools produce detectable TLS fingerprints. Playwright drives real Chromium, producing authentic fingerprints. Artillery provides the load generation harness and scenario composition.

4. **Spot instances everywhere (EC2 + Fargate)** — WAF testing is the ideal Spot workload: fully interruption-tolerant (losing a node mid-campaign is acceptable), stateless (all state is in S3), and burst-oriented (campaigns run for hours, not months). Spot pricing provides 70-85% savings.

5. **Public-only VPC** — No NAT gateway, no private subnets. Traffic generators MUST exit via public IPs to hit the WAF from the internet (not internal AWS paths). A NAT gateway would funnel all traffic through a single IP (defeating the multi-IP strategy) and cost ~$65/month for zero benefit.

6. **One campaign at a time enforced via campaign-state.json** — Simplifies reasoning about fleet state. Multiple concurrent campaigns would require per-campaign node assignment, resource partitioning, and log separation. The single-campaign constraint eliminates this complexity. Sequential campaigns are fine for a testing tool.

7. **Roll call consensus for node ordering without leader election** — Every node independently computes the same roster by sorting IPs numerically. S3 strong read-after-write consistency guarantees that all nodes see the same roll-call entries. No leader, no voting, no coordination beyond S3. The protocol handles late-joining nodes and missing nodes via timeouts.

8. **HTMX polling (30s) for fleet status, SSE for log streaming** — Fleet status changes slowly (nodes join/leave over minutes) so 30-second HTMX polling is appropriate and simple. Log data arrives continuously during campaigns, so SSE provides a true streaming experience without polling overhead. This matches the existing ConfigUI patterns.

9. **Athena for post-campaign analytics with pre-built named queries** — Athena is serverless (no infrastructure to manage), pay-per-query ($5/TB), and supports standard SQL. Pre-built named queries provide instant answers to the five key WAF testing questions without requiring the operator to write SQL. The Glue table over partitioned S3 data means no ETL pipeline is needed.

10. **ConfigUI "Apps" section** — A new section type with full-width panels and tabs. This establishes a pattern for future application-specific control panels beyond waffaw. The tabbed interface keeps the fleet management, campaign control, log viewing, and analytics in a single cohesive panel rather than spreading across multiple pages or modals.
