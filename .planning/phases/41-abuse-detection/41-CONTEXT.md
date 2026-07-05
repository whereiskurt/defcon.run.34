# Phase 41: Abuse Detection - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning
**Source:** PRD Express Path (docs/superpowers/specs/2026-07-05-abuse-detection-design.md)

<domain>
## Phase Boundary

Detect an overnight pentester/abuser and surface them by **IP + User-Agent** so the operator wakes to already-triaged email alerts. Two detections over the **ALB access logs** (which capture every request, unlike the Phase 40 `logEvent` business-event stream): (1) an IP continuously active **>2h**, (2) a **POST/request-rate outlier** per 5-min window. Alerts reuse the Phase 40 SNS topic; findings are written as automation-ready JSON so a later phase can drive AWS WAF IP-sets / Impart.security.

**In scope:**
- Glue table over the ALB access-log S3 bucket (partition projection, ALB-log SerDe)
- Athena workgroup with a bytes-scanned cap (cost guardrail)
- Two parameterized Athena detection queries (sustained-activity sessionization; 5-min rate outlier)
- `abuse-detector` Lambda on an EventBridge cron; per-new-offender SNS email + daily S3 report; dedup/escalation state
- `site.hcl`-parameterized thresholds; ships `enabled = false` (dark)

**Out of scope (deliberately "eventually"):**
- Enabling AWS WAF + auto-populating an IP-set blocklist
- Impart.security integration
- CloudFront-log correlation
The design leaves a clean JSON finding seam for all three; it does NOT build them.

</domain>

<decisions>
## Implementation Decisions

### Detection substrate — ALB access logs, NOT logEvent (AD-01)
- `logEvent` (Phase 40) only emits ~10 business events; a pentester's probing/4xx/scanning is invisible to it. **ALB access logs** (already enabled → S3 bucket `logs-alb-use1-{site}-{suffix}`, 90-day lifecycle) capture every request with client IP, verb, path, ELB/target status, User-Agent, latencies.
- Glue external table `alb_access_logs` using the AWS-documented ALB-log regex/Grok SerDe.
- **Partition projection** by date (and region prefix) — crib `modules/cloudtrail/v1.0.0/main.tf`; no crawler / no MSCK REPAIR.
- us-east-1 only (single live region).

### Athena workgroup (AD-02)
- Dedicated workgroup `dcr-abuse-analysis` with an S3 results location and a **per-query bytes-scanned cap** (runaway-scan guardrail).

### Q1 — Sustained-activity detection (AD-03)
- Per `client_ip`, order requests by time; start a new session when the gap since the previous request exceeds `session_gap_min` (default 15 min); flag IPs whose max session span ≥ `session_hours` (default 2h).
- Return: `client_ip`, distinct `user_agent`s, request count, first/last seen, top N paths, top status codes.

### Q2 — Rate outlier detection (AD-04)
- Bucket requests into 5-min windows per `client_ip`; count total requests and POSTs per bucket; flag IPs whose peak bucket exceeds `posts_per_5min` (default 30) OR `requests_per_5min` (default 100).
- Return: `client_ip`, `user_agent`(s), method mix, peak bucket time+count, top paths, 4xx/5xx ratio.
- **Grouping keys on `client_ip`** (attackers rotate IP less than UA); every finding surfaces the distinct UA(s) seen so the operator has both identifiers.

### abuse-detector Lambda + schedule (AD-05)
- EventBridge cron, default **every 30 min** (`cron_minutes`).
- Each run queries only the **last `lookback_hours` (default 3h)** of partitions (cost control).
- Runs Q1 + Q2, collects findings, drives alerting/report/state. Athena failure → log + retry next cron (never crash the schedule).

### Alerting + dedup/escalation (AD-06)
- For each **newly** flagged IP, publish to the **Phase 40 SNS topic** `dcr-admin-reports-tripwire` (already wired to the operator inbox) with IP, UA(s), rule fired, counts, window, top paths.
- **Dedup state:** S3 marker object or DynamoDB keyed `ip#utc-date` so an offender emails **once per UTC day**, not every 30 min. Crossing `escalation_multiplier` (default 3×) re-alerts.
- Dedup-store write failure → fail safe by still sending the alert (a dup email beats a missed attacker).

### Daily report + finding schema (AD-07)
- Append every finding to `s3://<report-bucket>/abuse/YYYY-MM-DD/findings.jsonl` + a human digest (one email at `digest_hour_utc`, default 13).
- Finding JSON (the WAF/Impart seam): `{ ts, rule, client_ip, user_agents[], count, window{start,end}, peak_5min, top_paths[], status_mix{2xx,4xx,5xx} }`. A later phase reads `findings.jsonl` to populate a WAF IP-set / call Impart — NOT built here.

### Thresholds + gate (AD-08)
- Parameterized in `site.hcl` `abuse_detection` block (mirroring Phase 40 `admin_reports`), tight pre-con defaults: `enabled=false` (at merge), `cron_minutes=30`, `lookback_hours=3`, `session_hours=2`, `session_gap_min=15`, `posts_per_5min=30`, `requests_per_5min=100`, `escalation_multiplier=3`, `digest_hour_utc=13`.
- Ships gated off; enable deliberately after a manual Athena query confirms the ALB-log schema parses.

### Claude's Discretion
- Lambda runtime/language (Node vs Python) — follow existing repo Lambda conventions (`modules/*-lambda` patterns).
- Dedup store choice (S3 marker vs DynamoDB) — pick the lower-ceremony option that survives Lambda cold starts.
- Exact Athena SQL phrasing and the ALB-log SerDe regex, provided the queries return the specified fields and flag the specified cases.
- Report bucket: new bucket vs a prefix on an existing logs/results bucket.
- Precise Terraform variable names/shapes, provided thresholds + enabled gate are surfaced in `site.hcl`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design source of truth
- `docs/superpowers/specs/2026-07-05-abuse-detection-design.md` — approved design; rationale, cost, WAF/Impart boundary

### Reuse / mirror
- `docs/superpowers/specs/2026-07-05-admin-activity-reports-design.md` — Phase 40 design (the SNS topic reused here; the deferred Athena work realized here)
- `infra/terraform/modules/admin-reports/v1.0.0/` — Phase 40 module conventions (versioned dir, site.hcl block, terragrunt unit, enabled gate, SNS topic `dcr-admin-reports-tripwire`)
- `infra/terraform/modules/cloudtrail/v1.0.0/main.tf` — Athena workgroup + Glue table + **partition projection** pattern to crib
- `infra/terraform/live/site/site.hcl` — where the `abuse_detection` block + thresholds get wired (note the admin_reports block as the template; skip_regions leaves only us-east-1 live)
- `infra/terraform/modules/network/v1.0.0/alb.tf` — ALB access logs config → the S3 bucket the Glue table reads
- Existing `*-lambda` modules (e.g. `s3-uploads-processor`, `bib-reconcile-lambda`, `strava-sync-scheduler`) — repo Lambda + EventBridge conventions
- `.github/workflows/terragrunt-{plan,apply}.yml` — how the module gets planned/applied (modules=abuse-detection, region=us-east-1); TF_VAR_ADMIN_EMAIL wiring precedent for any new env var

</canonical_refs>

<specifics>
## Specific Ideas

- Pre-con posture: legit traffic ≈ 0, so tight absolute thresholds are correct and expected to be quiet most nights; a hit is signal.
- The plan gate lessons from Phase 40 apply to any new terragrunt-unit-root module: do NOT declare `required_providers` in the module root (terragrunt generates provider.tf); a scoped `terragrunt plan` is the real validation (bare `terraform validate` misses provider/dep issues).
- Deploy verify must actually flag a synthetic/real burst end-to-end (query flags the IP → SNS email → JSONL finding), not just `terraform validate`.

</specifics>

<deferred>
## Deferred Ideas

- AWS WAF enablement + IP-set auto-block populated from `findings.jsonl`.
- Impart.security integration.
- CloudFront access-log correlation (a second Glue table) for the CDN edge view.
- Real-time (sub-cron) detection via CloudFront/ALB real-time logs → Kinesis.

</deferred>

---

*Phase: 41-abuse-detection*
*Context gathered: 2026-07-05 via PRD Express Path*
