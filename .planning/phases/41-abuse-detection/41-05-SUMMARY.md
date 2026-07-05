# 41-05 SUMMARY — Wire abuse-detection into live infra + deploy checkpoint

**Status:** COMPLETE (deployed live to us-east-1, operator-verified)
**Requirements:** AD-08

## What shipped

- **`site.hcl` `abuse_detection` block** — all thresholds + scan cap as one-line knobs, `enabled` gate, `alert_email` via `TF_VAR_ADMIN_EMAIL`.
- **`region/us-east-1/abuse-detection/terragrunt.hcl`** — exclude-if-disabled, `dependency "network"` for the REAL ALB-log bucket, providers include, full inputs mapping, `schedule_enabled` gated on the same `enabled` flag.

## Checkpoint-directed deviation (Task 3)

The plan reused the Phase 40 `dcr-admin-reports-tripwire` SNS topic. At the human-verify gate the operator directed a **standalone topic** instead: enabling `admin_reports` would trigger its un-validated 40-07 `/ecs/*` retention import (risk of log-group recreate). Added `modules/abuse-detection/v1.0.0/sns.tf` (topic `dcr-abuse-detection-tripwire` + email subscription); repointed the Lambda `SNS_TOPIC_ARN` and the IAM `sns:Publish` at the created topic; added `alert_email` var. Zero coupling to admin_reports / 40-07.

## Deploy path (not the plan's local-apply — GH Actions, no local creds)

The phase branch was stacked on the unmerged Phase 40 branch (58 divergent commits). Isolated the abuse-detection slice onto a clean branch off `main` → **PR #423** (merged). Phase 40 already lived on main independently, so no duplication.

## Verification (Phase 40 lessons #1–#3)

- **Scoped `terragrunt plan`** (region=us-east-1, modules=abuse-detection): `Plan: 16 to add, 0 to change, 0 to destroy`. **No** "Duplicate required providers" error (lesson #1). Glue table `storage.location.template` resolved to the **real** bucket `s3://logs-alb-use1-dc34-80a6b349/...` — not the mock (lesson #2).
- **`terragrunt apply`** on main: `Apply complete! Resources: 16 added, 0 changed, 0 destroyed`.
- **Alert path (lesson #3):** SNS subscription email delivered to the operator inbox and **confirmed**. Full query → SNS → inbox path proven. First cron cycle exercises the Lambda against the live ALB-log schema.

## Posture

**LIVE** — operator elected to leave `enabled=true` (~cents/day; 10 GiB/query cap, quiet pre-con site). Committed state on `main` documents the live posture and the destroy-before-flip teardown (`exclude != destroy`).

## Commits / artifacts

- Phase branch build: 41-05 auto tasks (`aa7a84c8`, `e2d86fec`) + standalone-topic deviation (`c4487c52`).
- main (shipped): PR #423 merge, enable commit, `docs: mark unit LIVE`.
- Tests: 17/17 lambda `node:test`, 7/7 query contract, `terraform fmt` clean.
