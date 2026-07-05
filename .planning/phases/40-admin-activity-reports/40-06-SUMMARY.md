---
phase: 40-admin-activity-reports
plan: 06
subsystem: infra
tags: [terraform, terragrunt, cloudwatch, dashboard, alarms, sns, anomaly-detection, admin-reports]

# Dependency graph
requires:
  - "admin-reports/v1.0.0 module + DefconRun/Activity metric names (Signups, GpxUploads, MapViews, StravaRateLimitUsage, ...) from 40-04"
  - "admin_reports block in site.hcl (alert_email + thresholds) surfaced by 40-04"
  - "network unit alb_arn, ecs-service unit target_groups, cloudfront unit distribution_ids outputs"
provides:
  - "admin-reports CloudWatch dashboard (ALB + CloudFront + DefconRun/Activity + distinct-active-users + top-IPs + Strava)"
  - "SNS tripwire topic + email subscription + four alarms (Signups, GpxUploads, ALB RequestCount anomaly, ALB 5XX)"
  - "module identifier inputs alb_arn_suffix / target_group_arn_suffixes / cloudfront_distribution_ids fed by terragrunt dependency wiring"
affects: [40-07, admin-reports, dashboard, alarms]

# Tech tracking
tech-stack:
  added:
    - "aws_cloudwatch_dashboard, aws_cloudwatch_metric_alarm (incl. ANOMALY_DETECTION_BAND), aws_sns_topic + aws_sns_topic_subscription in admin-reports/v1.0.0"
  patterns:
    - "Dashboard plots identifiers passed as INPUTS (mirrors waf/dashboard.tf) — never self-discovered; terragrunt dependency blocks + mock_outputs feed them"
    - "arn_suffix (the CloudWatch LoadBalancer/TargetGroup dimension value) derived in terragrunt from the units' arns via split(), not a new module output"
    - "Anomaly-detection alarm via metric_query { ANOMALY_DETECTION_BAND } + GreaterThanUpperThreshold + threshold_metric_id"

key-files:
  created:
    - infra/terraform/modules/admin-reports/v1.0.0/dashboard.tf
    - infra/terraform/modules/admin-reports/v1.0.0/alarms.tf
  modified:
    - infra/terraform/modules/admin-reports/v1.0.0/variables.tf
    - infra/terraform/modules/admin-reports/v1.0.0/outputs.tf
    - infra/terraform/live/site/site.hcl
    - infra/terraform/live/site/region/us-east-1/admin-reports/terragrunt.hcl

key-decisions:
  - "arn_suffix derived in the terragrunt unit (split on 'loadbalancer/' for the ALB, split on ':' index 5 for target groups) rather than adding new arn_suffix outputs to the network/ecs-service modules — keeps this plan's blast radius to its own files (modules/network + ecs-service left untouched)"
  - "target_group_arn_suffixes sourced from a dependency on the ecs-service unit (target groups are defined there, not in network) — the plan named network+cloudfront but allowed discretion; ecs-service is where the TargetGroup dimension actually lives"
  - "site.hcl NOT duplicated: 40-04 already surfaced alert_email + thresholds; the unit maps them to sns_alarm_email / threshold_* and a comment block documents the mapping (satisfies the single-source-of-truth intent without two email keys)"
  - "ALB 5XX + anomaly alarms use only the LoadBalancer dimension (aggregate across target groups) — appropriate for a whole-ALB tripwire; per-target-group breakdown lives on the dashboard"

requirements-completed: [AR-03, AR-05, AR-07]

# Metrics
duration: ~20min
completed: 2026-07-05
status: complete
---

# Phase 40 Plan 06: admin-reports Dashboard + Tripwire Alarms Summary

**Completed the admin-reports presentation + alerting plane on top of the 40-04 data plane: an `admin-reports` CloudWatch dashboard (headline `count_distinct(userId)` last-hour widget, top-IPs, ALB per-target-group + CloudFront per-distribution health, DefconRun/Activity event series, Strava rate-limit gauge) and four SNS-email tripwire alarms (Signups, GpxUploads, ALB RequestCount anomaly-detection, ALB 5XX) — every threshold and the email parameterized in site.hcl, and every ALB/CloudFront widget/alarm dimension fed from terragrunt dependency wiring rather than hardcoded identifiers.**

## Performance
- **Duration:** ~20 min
- **Completed:** 2026-07-05
- **Tasks:** 3
- **Files:** 6 (2 created, 4 modified)

## Accomplishments
- **Dashboard (AR-05) — `dashboard.tf`:** one `aws_cloudwatch_dashboard "admin_reports"` (name `admin-reports`) mirroring the waf dashboard's `jsonencode`/widget pattern. Widgets: headline Logs Insights `count_distinct(userId)` per hour across all `/ecs/*` app groups; top-IPs-by-event Logs Insights table; DefconRun/Activity events stacked per hour (Signups/Logins/GpxUploads/GpxShares/MapViews/Checkins/Uploads); ALB per-target-group RequestCount / TargetResponseTime / 4XX / 5XX; CloudFront Requests + 4xx/5xxErrorRate per distribution (six domains, Region=Global); Strava `StravaRateLimitUsage` gauge. All ALB/CloudFront widgets key on `var.alb_arn_suffix` / `var.target_group_arn_suffixes` / `var.cloudfront_distribution_ids` — no literal identifiers.
- **Identifier inputs (Task 1) — `variables.tf`:** `alb_arn_suffix` (string), `target_group_arn_suffixes` (map(string)), `cloudfront_distribution_ids` (map(string)), each documented as the CloudWatch dimension value it supplies.
- **Alarms (AR-07) — `alarms.tf`:** `aws_sns_topic` + `aws_sns_topic_subscription` (protocol email, endpoint `var.sns_alarm_email`) and four `aws_cloudwatch_metric_alarm`, all `alarm_actions -> the topic`:
  - (a) Signups `>= var.threshold_signups_per_hour` over 1h on `DefconRun/Activity`;
  - (b) GpxUploads `>= var.threshold_gpx_uploads_per_hour` over 1h;
  - (c) ALB RequestCount anomaly — `metric_query { ANOMALY_DETECTION_BAND(m1, 2) }` + `GreaterThanUpperThreshold` + `threshold_metric_id`, `LoadBalancer = var.alb_arn_suffix`;
  - (d) ALB HTTPCode_Target_5XX_Count `>= var.threshold_alb_5xx_per_5min` over 5min, `LoadBalancer = var.alb_arn_suffix`.
  Both ALB alarms resolve their LoadBalancer dimension from the input (no unresolved/omitted dimension).
- **Threshold/email vars (Task 2) — `variables.tf`:** `sns_alarm_email` (required), `threshold_signups_per_hour` (1), `threshold_gpx_uploads_per_hour` (5), `threshold_alb_5xx_per_5min` (10). No threshold or email hardcoded in the module.
- **Wiring (Task 3) — `site.hcl` + `terragrunt.hcl`:** the unit gains `dependency` blocks on `network` (ALB arn), `ecs-service` (target-group arns), and `cloudfront` (distribution ids), each with `mock_outputs` so `terragrunt plan` renders before those units apply. `alb_arn_suffix` is derived by stripping the `arn:...:loadbalancer/` prefix; `target_group_arn_suffixes` by taking the arn resource part (`split(":", arn)[5]` → `targetgroup/<name>/<hash>`); `cloudfront_distribution_ids` passes the cloudfront output straight through. Thresholds + email flow from `site.hcl.admin_reports.{thresholds,alert_email}`; a comment block in site.hcl documents the `-> module input` mapping.

## Task Commits
1. **Task 1: dashboard + ALB/CloudFront identifier inputs** — `2dce1dc8` (feat)
2. **Task 2: SNS topic + four parameterized tripwire alarms** — `23357e72` (feat)
3. **Task 3: site.hcl thresholds/email + terragrunt identifier wiring** — `b34118e1` (feat)

## Verification
- Module `terraform init -backend=false && terraform validate` → **Success! The configuration is valid.** (after each of Tasks 1 & 2 and once more after Task 3).
- Acceptance greps all pass:
  - Task 1: `admin-reports` (2) and `count_distinct` (1) in dashboard.tf; `alb_arn_suffix`/`target_group_arn_suffixes`/`cloudfront_distribution_ids` declared in variables.tf; widgets reference `var.alb_arn_suffix` (5) / `var.target_group_arn_suffixes` (5) / `var.cloudfront_distribution_ids` (4); `RequestCount` + CloudFront `Requests` + `DefconRun/Activity` all present.
  - Task 2: exactly 4 `aws_cloudwatch_metric_alarm` in alarms.tf; `aws_sns_topic` present; `ANOMALY_DETECTION_BAND` present; `var.alb_arn_suffix` present (both ALB alarms); `var.threshold` (6) and `var.sns_alarm_email` (1).
  - Task 3: `sns_alarm_email\|threshold_signups` in site.hcl (2); `alb_arn_suffix`/`target_group_arn_suffixes`/`cloudfront_distribution_ids` inputs in terragrunt.hcl; 3 `dependency` blocks.
- `terragrunt hcl format --file terragrunt.hcl --check` → exit 0 (unit is canonical HCL and parses).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added a dependency on the ecs-service unit for target-group identifiers**
- **Found during:** Task 3
- **Issue:** The plan named `dependency` blocks on the network + cloudfront units, but target groups (the `TargetGroup` CloudWatch dimension) are defined in the `ecs-service` module/unit, not `network` — `network` outputs only `alb_arn`. Without a target-group source the ALB per-target-group widgets would be empty.
- **Fix:** Added a third `dependency "ecs_service"` block (config_path `../ecs-service`) with `mock_outputs.target_groups`, and derived `target_group_arn_suffixes` from `tg.arn`. The plan explicitly allowed this discretion ("if a needed value is not an existing output of those units, source it...").
- **Files:** terragrunt.hcl
- **Commit:** `b34118e1`

**2. [Rule 3 - Blocking] Derived arn_suffix in terragrunt instead of adding new module outputs**
- **Found during:** Task 3
- **Issue:** Neither `network.alb_arn` nor `ecs-service.target_groups[*].arn` is an `arn_suffix` — the CloudWatch dimension needs the suffix form. Adding `arn_suffix` outputs to those two modules would touch files outside this plan's scope.
- **Fix:** Derived the suffixes in the unit's `inputs` via `split()` (strip `loadbalancer/` for the ALB; take the arn resource segment for target groups). Keeps modules/network + modules/ecs-service untouched.
- **Files:** terragrunt.hcl
- **Commit:** `b34118e1`

**3. [Rule 3 - Blocking] site.hcl mapping documented, not duplicated**
- **Found during:** Task 3
- **Issue:** The plan says "extend site.hcl with `sns_alarm_email` + threshold keys", but 40-04 already surfaced `alert_email` + `thresholds.{signups_per_hour,gpx_uploads_per_hour,alb_5xx_per_5min}`. Adding second keys would create two competing email/threshold sources.
- **Fix:** Kept the 40-04 keys as the single source; the unit maps them to the module's `sns_alarm_email` / `threshold_*` inputs, and a comment block in the site.hcl admin_reports block documents the `-> module input` mapping (satisfies the parameterization intent + the acceptance grep).
- **Files:** site.hcl, terragrunt.hcl
- **Commit:** `b34118e1`

## Deferred / Not Run Here
- **Live `terragrunt validate` / `terragrunt plan`:** attempted and **blocked by the sandbox lacking AWS credentials** — `site.hcl` calls `run_cmd("sops --decrypt .secrets.sops.json")`, and sops cannot reach KMS (`ec2imds ... host is down`), so terragrunt exits before evaluating the module. This is the same environmental gate 40-04 hit; static HCL parse (`terragrunt hcl format --check`) passes and the module `terraform validate` is clean. Per the plan's own guidance, module-level `terraform validate` is the acceptance bar without creds. The live `terragrunt plan` checks — non-empty ALB/CloudFront dimensions, both ALB alarms resolving their dimensions, and the additive (zero destroy/recreate over 40-04's filters/retention/queries) assertion — are **deferred to 40-07**, where creds are present.
- **Live alarm-email + metric-increment confirmation:** deferred to 40-07 (fire one of each event in prod, confirm the metric ticks and the tripwire email arrives).
- **arn_suffix derivation vs the real arns:** the `split()`/`element()` derivations were validated against the mock arns; 40-07 must confirm they produce the exact CloudWatch dimension strings against the live `network`/`ecs-service` outputs before apply.

## Known Stubs
None. The module defaults (`alb_arn_suffix = ""`, empty maps) are Terraform-level defaults for standalone `validate` only — the terragrunt unit always populates them from real dependency outputs, so at plan/apply time no dimension is empty. The dashboard/alarm resources carry real metric names and parameterized thresholds.

## Threat Register Status
- **T-40-13 (Info Disclosure, SNS email):** mitigated — endpoint is operator-owned and parameterized in site.hcl (`TF_VAR_ADMIN_EMAIL`); topic is not public; alarm payloads are aggregate counts.
- **T-40-14 (DoS, pre-con alarm noise):** accepted per plan — `Signups >= 1/hr` firing is intentional signal; site.hcl thresholds are the con-week volume knob.
- **T-40-15 (Tampering, anomaly baseline):** accepted per plan — the anomaly band self-trains; the fixed-threshold event-count alarms backstop a slow-ramp attacker.

## Next Plan Readiness
- 40-07 owns the live deploy: run `terragrunt plan` with creds (assert non-empty ALB/CloudFront dimensions + zero destroy over 40-04), apply, then fire one of each event in prod and confirm the metric increments and the tripwire email arrives.

## Self-Check: PASSED
- All created/modified files present on disk (dashboard.tf, alarms.tf, variables.tf, outputs.tf, site.hcl, terragrunt.hcl).
- All three task commits present in git history (2dce1dc8, 23357e72, b34118e1).
- Module `terraform validate` clean; terragrunt unit is canonical HCL.

---
*Phase: 40-admin-activity-reports*
*Completed: 2026-07-05*
