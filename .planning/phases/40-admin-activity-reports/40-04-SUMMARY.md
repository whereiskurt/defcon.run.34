---
phase: 40-admin-activity-reports
plan: 04
subsystem: infra
tags: [terraform, terragrunt, cloudwatch, metric-filters, log-retention, logs-insights, admin-reports]

# Dependency graph
requires:
  - "LOCKED event-line contract { evt, userId, email, ip, ua, meta } and the exact $.evt strings emitted by logEvent in run.auth/run.gpx/run.human (40-01/02/03)"
  - "strava.ratelimit numeric meta.usage / meta.limit field names (40-02)"
provides:
  - "admin-reports/v1.0.0 Terraform module (metric filters + /ecs/* retention + saved admin/* queries)"
  - "DefconRun/Activity namespace + metrics Signups, Logins, GpxUploads, GpxShares, MapViews, Checkins, Uploads, StravaRateLimitUsage"
  - "admin_reports config block in site.hcl (enabled, log_retention_days, log_group_names, alert_email, thresholds)"
  - "region/us-east-1/admin-reports/terragrunt.hcl self-contained unit"
affects: [40-06, 40-07, admin-reports, dashboard, alarms]

# Tech tracking
tech-stack:
  added:
    - "New Terraform module infra/terraform/modules/admin-reports/v1.0.0"
  patterns:
    - "Terraform import{} + prevent_destroy to adopt ECS-auto-created /ecs/* log groups and set retention without destroy/recreate"
    - "One aws_cloudwatch_log_metric_filter per app event family keyed on structured $.evt (not free-text) so a spoofed field cannot forge a counted event"
    - "Self-contained regional terragrunt unit (own state key, reads site.hcl, sources versioned module) mirroring status-site"

key-files:
  created:
    - infra/terraform/modules/admin-reports/v1.0.0/versions.tf
    - infra/terraform/modules/admin-reports/v1.0.0/variables.tf
    - infra/terraform/modules/admin-reports/v1.0.0/outputs.tf
    - infra/terraform/modules/admin-reports/v1.0.0/metrics.tf
    - infra/terraform/modules/admin-reports/v1.0.0/retention.tf
    - infra/terraform/modules/admin-reports/v1.0.0/queries.tf
    - infra/terraform/live/site/region/us-east-1/admin-reports/terragrunt.hcl
  modified:
    - infra/terraform/live/site/site.hcl

key-decisions:
  - "log_group_names supplied as a site.hcl map derived statically from the ecs-task naming convention /ecs/{container.name}-{family} (run-auth-app-run-auth, run-gpx-app-run-gpx, run-human-app-run-human) because no AWS creds were available to run describe-log-groups; verify before apply in 40-07"
  - "Retention adopts existing groups via for_each import{} (Terraform >= 1.7; repo runs 1.14) with prevent_destroy — no ECS change, no awslogs-create-group flip, no service restart (threat T-40-11)"
  - "StravaRateLimitUsage metric_transformation.value = $.meta.usage (LOCKED with 40-02), not a literal 1 — binds the real quota gauge"
  - "site.hcl was NOT run through hclfmt because the repo's site.hcl is not hclfmt-clean; a full format touched 50+ unrelated pre-existing lines, so only the admin_reports block was hand-added (scoped diff)"

requirements-completed: [AR-03, AR-04, AR-06, AR-08]

# Metrics
duration: ~18min
completed: 2026-07-05
status: complete
---

# Phase 40 Plan 04: admin-reports Terraform Module Foundation Summary

**A new `admin-reports/v1.0.0` Terraform module that turns the app event stream into `DefconRun/Activity` CloudWatch metrics (8 metric filters), sets 90-day retention on the existing `/ecs/*` app log groups by adopting them via `import{}` (no destroy/recreate), and defines the seven saved `admin/*` Logs Insights queries — wired into `site.hcl` and a self-contained us-east-1 terragrunt unit.**

## Performance
- **Duration:** ~18 min
- **Completed:** 2026-07-05
- **Tasks:** 3
- **Files:** 8 (7 created, 1 modified)

## Accomplishments
- **Metric filters (AR-04):** 8 `aws_cloudwatch_log_metric_filter` resources, one per event family, each attached to its source app's `/ecs/*` group and publishing to namespace `DefconRun/Activity`:
  - `Signups` ← `auth.signup`, `Logins` ← `auth.login` (run.auth group)
  - `GpxUploads` ← `gpx.file.create`, `GpxShares` ← `gpx.file.publish || gpx.share.request || gpx.share.accept`, `MapViews` ← `gpx.map.view`, `StravaRateLimitUsage` ← `strava.ratelimit` (run.gpx group)
  - `Checkins` ← `human.checkin`, `Uploads` ← `human.upload` (run.human group)
  - Count metrics use `value = "1"` + `default_value = "0"` (so 40-06 alarms treat "no activity" as a real 0); the Strava gauge uses `value = "$.meta.usage"` — the LOCKED numeric field 40-02 emits.
- **Retention (AR-08a):** `retention.tf` declares one `aws_cloudwatch_log_group` per app group (`retention_in_days = 90`, `prevent_destroy`) and a `for_each` `import{}` block that adopts each existing ECS-auto-created group by name — apply sets retention only, never destroy/recreate (mitigates threat T-40-11, DoS on live groups).
- **Saved queries (AR-06):** `queries.tf` defines the seven `admin/*` `aws_cloudwatch_query_definition` resources — `admin/user-activity`, `admin/ip-activity` (each with an editable placeholder filter), `admin/top-ips-1h`, `admin/top-uploaders`, `admin/signups-over-time`, `admin/distinct-users-by-day`, `admin/error-spikes` (non-event error volume per service via `@log`).
- **Wiring (AR-03):** `admin_reports` block in `site.hcl` (enabled, retention days, the `/ecs/*` `log_group_names` map, plus `alert_email` + alarm `thresholds` surfaced now so 40-06 reads one source), and a self-contained `region/us-east-1/admin-reports/terragrunt.hcl` mirroring status-site with an `exclude`-if-disabled guard.

## Task Commits
1. **Task 1: module scaffold + metric filters** — `f0c3e150` (feat)
2. **Task 2: 90-day retention via import{} + seven admin/* queries** — `31b6a638` (feat)
3. **Task 3: wire admin_reports into site.hcl + terragrunt unit** — `0f8895fd` (feat)

## Verification
- Module `terraform init -backend=false && terraform validate` → **Success! The configuration is valid.** (run after each task and once more at the end).
- Acceptance greps all pass:
  - `metrics.tf`: 8 `aws_cloudwatch_log_metric_filter` blocks; all 8 metric names present; `DefconRun/Activity` present; `$.meta.usage` present on the Strava filter.
  - `retention.tf`: `import {` present; `retention_in_days` present.
  - `queries.tf`: exactly 7 `aws_cloudwatch_query_definition`; all seven `admin/*` names present.
  - `site.hcl`: `admin_reports` present; diff scoped to the 34-line block only.
- The terragrunt unit is syntactically valid (`terragrunt hcl format --file` reports it already formatted/parses).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Moved `query_definition_names` output out of queries.tf into outputs.tf**
- **Found during:** Task 2
- **Issue:** The plan acceptance requires exactly 7 occurrences of `aws_cloudwatch_query_definition` in `queries.tf`. An output listing the 7 resources' `.name` attributes in `queries.tf` would have added 7 more matching lines (total 14), failing `== 7`.
- **Fix:** The output lives in `outputs.tf` instead; `queries.tf` contains exactly the seven resource declarations.
- **Files:** outputs.tf, queries.tf
- **Commit:** `31b6a638`

**2. [Rule 3 - Blocking] Did not run hclfmt on site.hcl (scope containment)**
- **Found during:** Task 3
- **Issue:** `terragrunt hcl format` on `site.hcl` reformatted 50+ pre-existing unrelated lines (dns/urls/waffaw blocks) because the repo's `site.hcl` is not hclfmt-clean. Committing that would be scope creep across unrelated config.
- **Fix:** Reverted the whole-file format and hand-added only the `admin_reports` block (internally well-formed, blank-line-separated assignments). Final `git diff site.hcl` is +34 lines, the block only.
- **Files:** site.hcl
- **Commit:** `0f8895fd`

## Deferred / Not Run Here
- **Live `terragrunt validate` / `terragrunt plan`:** NOT run — the sandbox has no AWS credentials (`aws logs describe-log-groups` → "Unable to locate credentials"), and any `terragrunt` command that evaluates `site.hcl` hangs (it runs `sops`, reads all service.hcl configs, and initializes providers/S3 backend, all of which need creds/network). Per the plan's own guidance, module-level `terraform validate` is the acceptance bar without creds. The `terragrunt plan` zero-destroy check for the `/ecs/*` import adoption and the cross-unit no-drift check are **deferred to 40-07** (the real deploy), where creds are present. This is us-east-1 only and no `apply` was performed.
- **Live log-group name confirmation:** the `log_group_names` map values were derived statically from the `ecs-task` awslogs naming (`/ecs/{container.name}-{family}`). 40-07 must confirm them against `aws logs describe-log-groups --log-group-name-prefix /ecs/` before apply (the import ids must match exactly).

## Known Stubs
None. All metric filters, retention groups, and query definitions carry real values; the only placeholders are the intentional operator-editable `PUT-USER-ID-HERE` / `PUT-IP-HERE` / `PUT-EMAIL-HERE` tokens inside the `admin/user-activity` and `admin/ip-activity` query strings (by design — the operator swaps them at run time).

## Threat Register Status
- **T-40-10 (Tampering):** mitigated — filters key on structured `$.evt`, not free-text fields.
- **T-40-11 (DoS on live groups):** mitigated — `import{}` + `prevent_destroy` adopts existing groups; zero-destroy to be confirmed in the 40-07 plan review before apply.
- **T-40-12 (Repudiation, 90-day retention):** accepted per plan (cost-driven; deeper forensic depth is Phase 2/Athena scope).

## Next Plan Readiness
- 40-06 can build the `admin-reports` dashboard + SNS tripwire alarms against the `DefconRun/Activity` namespace and the metric-name/threshold/alert_email values now surfaced in `site.hcl`.
- 40-07 owns the live deploy: verify `/ecs/*` group names, run `terragrunt plan` (assert zero destroy on the import adoption), apply, and fire one of each event in prod to confirm the metrics increment.

## Self-Check: PASSED
- All created files present on disk (versions/variables/outputs/metrics/retention/queries .tf + terragrunt.hcl); site.hcl modified.
- All three task commits present in git history (f0c3e150, 31b6a638, 0f8895fd).
- Module `terraform validate` clean.

---
*Phase: 40-admin-activity-reports*
*Completed: 2026-07-05*
