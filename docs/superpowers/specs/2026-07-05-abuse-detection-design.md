# Overnight Abuse / Pentester Detection — Design

**Date:** 2026-07-05
**Status:** Approved (brainstorm w/ KPH)
**Builds on:** Phase 40 admin-reports (`docs/superpowers/specs/2026-07-05-admin-activity-reports-design.md`) — reuses its SNS topic; realizes the deferred "Athena over access logs" Phase 2.

## 1. Goal & posture

Pre-conference, legit traffic is ~zero, so anyone sustained/aggressive is presumptively hostile recon. The operator wants to **wake up to already-triaged alerts** identifying an attacker by **IP + User-Agent**, so they can (later) feed AWS WAF IP sets and Impart.security. Two detections:

1. **Sustained activity** — an IP continuously active **>2h** (a scanner grinding overnight).
2. **POST-rate / request-rate outlier** — an IP issuing too many POSTs (or requests) per 5-minute window (flooding/fuzzing).

**In scope:** Glue table over ALB access logs, a scheduled detection Lambda running two Athena queries, per-new-offender email via the existing Phase 40 SNS topic, a daily S3 report, site.hcl-parameterized thresholds, and an automation-ready JSON finding schema.

**Out of scope (deliberately "eventually"):** enabling AWS WAF + auto-populating an IP-set blocklist; Impart.security integration; CloudFront-log correlation. The design leaves a clean JSON seam for all three; it does not build them.

## 2. Why ALB access logs (not the logEvent stream)

The Phase 40 `logEvent` stream only emits ~10 **business events** (signup, gpx.create, checkin, …), each with IP + UA. A pentester's traffic is mostly probes, auth failures, 4xx storms, and hits on routes that never fire a business event — invisible to `logEvent`. **ALB access logs** (already enabled → S3 bucket `logs-alb-use1-{site}-{suffix}`, 90-day lifecycle) capture *every* request: timestamp, client IP:port, request verb + path, ELB/target status codes, User-Agent, processing times. That is the only source that actually sees the attacker.

## 3. Components

### 3.1 Glue table `alb_access_logs` (Athena)
- External table over the ALB access-log S3 prefix, using the AWS-documented ALB-log Grok/regex SerDe (fields: `time`, `client_ip`, `client_port`, `request_verb`, `request_url`, `elb_status_code`, `target_status_code`, `user_agent`, `received_bytes`, `sent_bytes`, `request_processing_time`, …).
- **Partition projection** by date (and region prefix), cribbed from `modules/cloudtrail/v1.0.0/main.tf` — no crawler, no `MSCK REPAIR`; projection resolves partitions from the S3 path at query time.
- Dedicated **Athena workgroup** `dcr-abuse-analysis` with an S3 results location and a per-query bytes-scanned cap (guardrail against runaway scans).
- us-east-1 only (matches the single live region).

### 3.2 Detection Lambda `abuse-detector`
- **Trigger:** EventBridge cron, default **every 30 min** (parameterized).
- **Window:** queries the **last `lookback_hours` (default 3h)** of partitions only, so each run scans a small, recent slice (cost control).
- Runs two parameterized Athena queries:

  **Q1 — Sustained activity (sessionization).** Per `client_ip`, order requests by time; start a new session when the gap since the previous request exceeds `session_gap_min` (default 15 min); compute each session's span; flag IPs whose max session span ≥ `session_hours` (default 2h). Return `client_ip`, distinct `user_agent`s, request count, first/last seen, top N paths, top status codes.

  **Q2 — Rate outlier.** Bucket requests into 5-min windows per `client_ip`; count total requests and POSTs per bucket; flag IPs whose peak bucket exceeds `posts_per_5min` (default 30) OR `requests_per_5min` (default 100). Return `client_ip`, `user_agent`(s), method mix, peak bucket time+count, top paths, 4xx/5xx ratio.

- **Grouping:** detection keys on `client_ip` (attackers rotate IP less than UA); every finding **surfaces the distinct UA(s)** seen for that IP so the operator has both identifiers.

### 3.3 Alerting + report
- **Per-offender email (once/day):** for each *newly* flagged IP, publish to the **Phase 40 SNS topic** `dcr-admin-reports-tripwire` (already wired to the operator inbox) with a compact summary: IP, UA(s), which rule fired, counts, window, top paths.
- **Daily S3 report:** append every finding to `s3://<report-bucket>/abuse/YYYY-MM-DD/findings.jsonl` plus a human-readable daily digest (one email at a configurable hour).
- **Dedup state:** a small store (S3 marker object or a DynamoDB table keyed `ip#utc-date`) records already-alerted IPs so an offender emails **once per UTC day**, not every 30 min. Crossing a higher `escalation_multiplier` threshold re-alerts (so a spike still pages even if the IP already alerted).

### 3.4 Finding schema (the WAF/Impart seam)
Each finding is written as JSON so a future enforcement step can consume it without re-querying:
```json
{
  "ts": "<detection time, ISO8601>",
  "rule": "sustained_activity | rate_outlier",
  "client_ip": "<ip>",
  "user_agents": ["<ua>", "..."],
  "count": 0,
  "window": {"start": "...", "end": "..."},
  "peak_5min": 0,
  "top_paths": ["/api/…", "..."],
  "status_mix": {"2xx": 0, "4xx": 0, "5xx": 0}
}
```
A later phase reads `findings.jsonl` to (a) add `client_ip` to an AWS WAF IP-set blocklist, and/or (b) hand the IP+UA to Impart.security. **Not built here.**

## 4. Thresholds & config

All parameterized in `site.hcl` (mirroring the Phase 40 `admin_reports` block), tight pre-con defaults; bump for con-week:

| Key | Pre-con default | Meaning |
|---|---|---|
| `enabled` | `false` at merge | gate the whole unit (ship dark, enable deliberately) |
| `cron_minutes` | 30 | detection cadence |
| `lookback_hours` | 3 | query window per run |
| `session_hours` | 2 | sustained-activity span threshold |
| `session_gap_min` | 15 | gap that ends a session |
| `posts_per_5min` | 30 | POST-rate threshold |
| `requests_per_5min` | 100 | total-request-rate threshold |
| `escalation_multiplier` | 3 | re-alert if an already-alerted IP crosses N× |
| `digest_hour_utc` | 13 | daily report email hour (~morning local) |

## 5. Error handling

- Athena query failure (throttle, transient) → Lambda logs + retries next cron; never crashes the schedule.
- Bytes-scanned cap in the workgroup bounds cost even if projection or a bad query misbehaves.
- Empty result set (a quiet night) → no email, one line in the digest. Silence is the common case pre-con.
- Dedup store write failure → fail safe by still sending the alert (better a dup email than a missed attacker).
- No ALB-log objects yet (fresh partition) → query returns empty, no error.

## 6. Testing / verification

- **Unit:** the two Athena SQL templates validated against a small fixture partition (synthetic ALB log lines) — assert the 2h-session and >30-POST/5min cases flag, and a benign trickle does not.
- **Lambda logic:** dedup (once/day), escalation re-alert, SNS payload shape — unit-tested with a mocked Athena/SNS.
- **Deploy verify:** replay a burst of requests against a prod endpoint (or backfill a synthetic partition), confirm the next cron flags the IP, emails via SNS, and writes the JSONL finding.

## 7. Cost

Partition projection + a 3h lookback keep each Athena run scanning only recent partitions — cents/day at current/con volume. One small Lambda + one EventBridge rule + a tiny dedup store. Reuses the existing SNS topic and ALB-log bucket (no new ingestion).

## 8. Rollout

Ship with `enabled = false` (dark), like admin-reports. Enable deliberately once the Glue table + a manual Athena query confirm the ALB-log schema parses and the thresholds behave. Enabling is: flip `enabled = true`, verify one detection query by hand, apply the unit.
