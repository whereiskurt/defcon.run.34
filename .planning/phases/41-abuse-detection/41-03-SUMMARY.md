---
phase: 41-abuse-detection
plan: 03
subsystem: infra
tags: [terraform, lambda, eventbridge, iam, athena, sns, xray, least-privilege]

# Dependency graph
requires:
  - phase: 41-abuse-detection
    provides: "Plan 01 frozen module variable/output contract, dcr-abuse-analysis Athena workgroup, alb_access_logs Glue table, dual-role results bucket"
  - phase: 40-admin-reports
    provides: "SNS topic dcr-admin-reports-tripwire (reused for alerts, not recreated)"
provides:
  - "abuse-detector-{region} Lambda + dedicated log group + Active X-Ray tracing"
  - "EventBridge cron rule whose ENABLED/DISABLED state derives from schedule_enabled (ships dark, AD-08)"
  - "aws_lambda_permission binding invocation to the named rule only"
  - "Full handler env-var contract (ATHENA/GLUE/RESULTS/SNS/QUERY_DIR + 7 thresholds) that Plan 04's index.mjs reads"
  - "Least-privilege execution role: Athena/Glue/S3/SNS all ARN-scoped, no wildcards except AWS-unscopable X-Ray"
  - "Lambda/alert outputs (lambda_function_name/arn, event_rule_name, composed reused sns_topic_arn) for the Plan 05 checkpoint"
affects: [41-04-handler, 41-05-wiring]

# Tech tracking
tech-stack:
  added: [aws_lambda_function, aws_cloudwatch_event_rule, archive_file, aws_iam_role]
  patterns:
    - "EventBridge rule state gated by var.schedule_enabled so the whole schedule ships DISABLED (dark) — the AD-08 gate applied at the schedule, not just the handler"
    - "Reused SNS topic ARN composed from account+region+fixed name (local.sns_topic_arn); module asserts no aws_sns_topic resource exists"
    - "S3-marker dedup + findings + digest as prefixes of the Plan 01 results bucket — no new bucket, no DynamoDB table (survives cold starts, low ceremony)"
    - "Sid-per-concern inline IAM policy, every statement ARN-scoped via resource attributes (crib: bib-reconcile-lambda)"
    - "Downstream plan ADDS new resource files (lambda.tf/iam.tf/outputs_lambda.tf) — Plan 01's variables.tf/outputs.tf untouched (single-file ownership)"

key-files:
  created:
    - infra/terraform/modules/abuse-detection/v1.0.0/lambda.tf
    - infra/terraform/modules/abuse-detection/v1.0.0/iam.tf
    - infra/terraform/modules/abuse-detection/v1.0.0/outputs_lambda.tf
  modified: []

key-decisions:
  - "S3-marker dedup (abuse/state/{ip}#{utc-date} JSON) over a DynamoDB table — lower ceremony for a single scalar per offender/day and survives Lambda cold starts (design 3.3 / CONTEXT AD-06 discretion resolved)"
  - "SNS ARN composed inline in iam.tf using var.sns_topic_name (mirrors local.sns_topic_arn in lambda.tf) so the Publish statement is self-documenting and the ARN-scope grep gate passes without a cross-file local"
  - "GLUE_TABLE env var sourced from aws_glue_catalog_table.alb_access_logs.name (resource attribute) rather than a literal string for drift-safety"
  - "data.aws_caller_identity/aws_region reused from athena.tf (module-global), not redeclared"

patterns-established:
  - "Dark-by-default cron: aws_cloudwatch_event_rule.state = var.schedule_enabled ? ENABLED : DISABLED"
  - "Least-privilege Lambda role referencing sibling resource ARNs (workgroup/db/table/bucket) instead of re-composing strings"

requirements-completed: [AD-05, AD-06, AD-07]

coverage:
  - id: D1
    description: "abuse-detector Lambda + dedicated log group + Active X-Ray, packaged via archive_file of the lambda/ dir"
    requirement: "AD-05"
    verification:
      - kind: other
        ref: "terraform fmt -check clean; grep aws_lambda_function + tracing_config in lambda.tf"
        status: pass
      - kind: manual_procedural
        ref: "Live terragrunt init/plan/apply against the network unit + real ALB-log bucket deferred to the Plan 05 deploy checkpoint (Phase 40 lesson #1)"
        status: unknown
    human_judgment: true
    rationale: "fmt/grep gates prove the Lambda + cron infra is structurally correct, but only a scoped terragrunt plan against the live network + admin-reports topic (Plan 05) proves the archive packages real handler code, the reused-topic ARN resolves, and the role attaches. No automated test asserts that here (module deliberately has no provider block; validate/plan is deferred)."
  - id: D2
    description: "EventBridge cron rule state derives from schedule_enabled (ships dark), invoke bound to the named rule only"
    requirement: "AD-05"
    verification:
      - kind: other
        ref: "grep 'var.schedule_enabled' in lambda.tf state expression; aws_lambda_permission source_arn = rule arn"
        status: pass
    human_judgment: false
  - id: D3
    description: "Least-privilege IAM: Athena/Glue/S3 ARN-scoped, sns:Publish scoped to EXACTLY the reused Phase 40 topic (no wildcard)"
    requirement: "AD-06"
    verification:
      - kind: other
        ref: "grep athena:StartQueryExecution/s3:GetObject/sns:Publish in iam.tf; sns:Publish count==1 with non-wildcard Resource composed from var.sns_topic_name; ALB read scoped to var.alb_logs_bucket_name"
        status: pass
    human_judgment: false
  - id: D4
    description: "No second SNS topic; findings/dedup/digest as S3 prefixes on the Plan 01 bucket (report-bucket write access, AD-07)"
    requirement: "AD-07"
    verification:
      - kind: other
        ref: "grep -c 'resource \"aws_sns_topic\"' == 0 across new files; results bucket rw statement scoped to aws_s3_bucket.results.arn + /*"
        status: pass
    human_judgment: false

# Metrics
duration: 2min
completed: 2026-07-05
status: complete
---

# Phase 41 Plan 03: Abuse-Detector Lambda Infrastructure Summary

**A dark-by-default `abuse-detector-{region}` Lambda on an EventBridge cron gated by `schedule_enabled`, with the full Plan-04 handler env-var contract and a least-privilege IAM role that runs Athena in the one workgroup, reads the Glue table + ALB logs, read/writes the results bucket, and publishes only to the reused Phase 40 SNS topic — no new bucket, table, or topic.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-07-05T22:14:06Z
- **Completed:** 2026-07-05T22:16:02Z
- **Tasks:** 2
- **Files modified:** 3 (all created)

## Accomplishments
- Authored `lambda.tf`: `aws_lambda_function abuse-detector-{region}` (handler `index.handler`, Active X-Ray), a dedicated log group, `archive_file` packaging of `${path.module}/lambda`, and the EventBridge cron (`aws_cloudwatch_event_rule`/`_target`/`aws_lambda_permission`) whose `state = var.schedule_enabled ? "ENABLED" : "DISABLED"` ships the schedule DARK (AD-08). Only the named rule may invoke.
- Set the FULL handler env-var contract Plan 04's `index.mjs` reads: `ATHENA_WORKGROUP`, `GLUE_DATABASE`, `GLUE_TABLE`, `RESULTS_BUCKET`/`RESULTS_PREFIX`/`REPORT_PREFIX`/`STATE_PREFIX`, `SNS_TOPIC_ARN`, `QUERY_DIR`, and all seven thresholds (`LOOKBACK_HOURS`, `SESSION_HOURS`, `SESSION_GAP_MIN`, `POSTS_PER_5MIN`, `REQUESTS_PER_5MIN`, `ESCALATION_MULTIPLIER`, `DIGEST_HOUR_UTC`).
- Authored `iam.tf`: the Lambda execution role + a single Sid-per-concern inline policy — Logs (own log group), X-Ray (AWS-unscopable), Athena (workgroup ARN), Glue (catalog+db+table ARNs), S3 read (ALB-log bucket at the access prefix), S3 rw (results bucket), and `sns:Publish` scoped to EXACTLY the reused topic ARN (no wildcard). T-41-05 mitigated.
- Authored `outputs_lambda.tf` (new file, Plan 01's `outputs.tf` untouched): `lambda_function_name`, `lambda_function_arn`, `event_rule_name`, and `sns_topic_arn` (the composed reused ARN) for the Plan 05 checkpoint.
- Resolved the AD-06 report-bucket discretion: findings (`abuse/YYYY-MM-DD/findings.jsonl`), the daily digest, and dedup markers (`abuse/state/{ip}#{utc-date}`) all live under prefixes of the Plan 01 results bucket — no new bucket, no DynamoDB table, no second SNS topic (grep-gated `aws_sns_topic` count == 0).

## Task Commits

Each task was committed atomically:

1. **Task 1: Lambda function + EventBridge cron + log group + report/dedup prefixes** - `c68939ad` (feat)
2. **Task 2: Least-privilege IAM role (Athena, Glue, S3, SNS-reuse, logs, xray)** - `9d3166e0` (feat)

## Files Created/Modified
- `infra/terraform/modules/abuse-detection/v1.0.0/lambda.tf` - Lambda function, log group, archive_file, EventBridge rule/target/permission (state = schedule_enabled), full handler env-var contract, `local.function_name`/`local.sns_topic_arn`.
- `infra/terraform/modules/abuse-detection/v1.0.0/iam.tf` - execution role + Sid-per-concern least-privilege inline policy (Logs/X-Ray/Athena/Glue/S3-read/S3-rw/SNS-reuse), all ARN-scoped.
- `infra/terraform/modules/abuse-detection/v1.0.0/outputs_lambda.tf` - lambda_function_name/arn, event_rule_name, composed reused sns_topic_arn.

## Decisions Made
- **S3-marker dedup over DynamoDB** — the AD-06 dedup/escalation state and the AD-07 digest live as prefixes on the Plan 01 dual-role bucket. A DynamoDB table would be more ceremony for a single scalar (last-alerted count) per offender/day; S3 markers survive Lambda cold starts. Documented in a lambda.tf comment.
- **SNS ARN composed inline in iam.tf** using `var.sns_topic_name` (mirroring `local.sns_topic_arn` in lambda.tf) so the `sns:Publish` statement is self-documenting and the ARN-scope grep gate reads `var.sns_topic_name` directly rather than through a cross-file local.
- **GLUE_TABLE from the resource attribute** (`aws_glue_catalog_table.alb_access_logs.name`) rather than a literal `"alb_access_logs"` string — drift-safe and equivalent.
- **Reused module-global data sources** — `data.aws_caller_identity`/`data.aws_region` come from athena.tf; not redeclared (would collide).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. All acceptance gates (`terraform fmt -check`, the schedule_enabled/SNS/ATHENA/aws_sns_topic-count/output grep gates for Task 1; the athena/s3/sns:Publish-count/var.sns_topic_name/var.alb_logs_bucket_name grep gates for Task 2) passed on first run.

## User Setup Required
None - no external service configuration required in this plan. The `site.hcl` `abuse_detection` block and the network-dependency wiring (real ALB-log bucket, live SNS topic) are introduced in Plan 05.

## Next Phase Readiness
- The handler env-var contract is now the fixed interface for **Plan 04** (`index.mjs` in `lambda/`) — it reads the exact names set here.
- `outputs_lambda.tf` exposes what the **Plan 05** scoped `terragrunt plan` checkpoint references.
- **Deferred (by design):** real `init`/`plan`/`apply` against the live network unit + admin-reports SNS topic happens at the Plan 05 deploy checkpoint (Phase 40 lesson #1 — bare `terraform validate` misses provider/dependency issues; the module has no provider block by design). Ships dark (`schedule_enabled = false`).

## Self-Check: PASSED
- All 3 created files present on disk (lambda.tf, iam.tf, outputs_lambda.tf).
- Both task commits present: `c68939ad`, `9d3166e0`.
- Whole-module `terraform fmt -check` clean; `grep -c 'resource "aws_sns_topic"'` == 0 across all new files; both Task 1 and Task 2 combined verify commands returned PASS.

---
*Phase: 41-abuse-detection*
*Completed: 2026-07-05*
