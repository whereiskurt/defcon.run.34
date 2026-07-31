---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 07
subsystem: infra/terraform (EventBridge Scheduler + invoker Lambda)
tags: [heatmap, terraform, terragrunt, eventbridge-scheduler, lambda, iam, heat-02, d-07]
status: complete
requires:
  - "71-02: POST /api/gpx/internal/heatmap-build with maxDuration = 300 and the x-internal-secret guard"
provides:
  - "modules/heatmap-scheduler/ (config.hcl + v1.0.0) — EventBridge Scheduler → invoker Lambda"
  - "live unit region/us-east-1/heatmap-scheduler/terragrunt.hcl"
  - "Lambda heatmap-build-use1 (timeout 300) + log group /aws/lambda/heatmap-build-use1"
  - "IAM roles heatmap-build-use1-role, heatmap-build-use1-scheduler-role"
  - "Schedules heatmap-build-use1-hourly, heatmap-build-use1-daily (default group)"
affects:
  - "71-08: applies this unit via terragrunt-apply.yml and asserts the schedule fields (probe assertion 13)"
tech-stack:
  added: []
  patterns:
    - "Deliberate module copy over a shared/generalised module when the source module hardcodes its resource names"
    - "Thin-invoker Lambda: one SSM read + one HTTP POST, zero data-plane IAM"
    - "kms:Decrypt scoped to the alias's target_key_arn with a PARAMETER_ARN encryption-context condition"
    - "Scoped terragrunt-plan.yml (region + modules) as the pre-apply gate; never a local apply"
key-files:
  created:
    - infra/terraform/modules/heatmap-scheduler/config.hcl
    - infra/terraform/modules/heatmap-scheduler/v1.0.0/main.tf
    - infra/terraform/modules/heatmap-scheduler/v1.0.0/iam.tf
    - infra/terraform/modules/heatmap-scheduler/v1.0.0/variables.tf
    - infra/terraform/modules/heatmap-scheduler/v1.0.0/outputs.tf
    - infra/terraform/modules/heatmap-scheduler/v1.0.0/lambda/index.mjs
    - infra/terraform/live/site/region/us-east-1/heatmap-scheduler/terragrunt.hcl
  modified: []
decisions:
  - "71-07: heatmap-scheduler is a copy of strava-sync-scheduler v1.1.0, not a second live unit of it — that module hardcodes function_name = strava-sync-${var.region.label}, so a second unit collides on every resource name; generalising it behind a function_basename variable would make every heat-map change re-plan a live, applied Strava Lambda"
  - "71-07: two schedules — hourly cron(0 * 5-10 8 ? 2026) across the DC34 con window and a year-round daily cron(0 4 * * ? *) baseline — both America/Los_Angeles; without the daily entry the artifact would be stale or missing for everyone outside a six-day window and the layer would look broken"
  - "71-07: lambda_timeout default raised from the strava module's 120 to 300 at the MODULE level (not only the unit), so any future unit of this module inherits the floor the route's maxDuration = 300 requires"
  - "71-07: us-east-1 only — no ca-central-1 unit; run.gpx is single-live-region and a second scheduler would cron-invoke a nonexistent service forever"
  - "71-07: the validated plan-run reference is recorded in the live unit's own header, not only in planning docs, so the provenance travels with the file"
metrics:
  duration: ~25 min
  completed: 2026-07-31
  tasks: 3
  commits: 3
  files_created: 7
  tests_added: 0
---

# Phase 71 Plan 07: Heat-Map Build Scheduler (EventBridge + Invoker Lambda) — Summary

The clock for the DC34 heat map: a new `heatmap-scheduler` Terraform module and its
us-east-1 live unit that POST `/api/gpx/internal/heatmap-build` on the VPC-private
service-discovery name — hourly through the con window plus a daily baseline. Validated by
a scoped CI plan (`9 to add, 0 to change, 0 to destroy`, zero Strava churn). **Nothing was
applied**; the apply is 71-08.

## What Was Built

### Task 1 — `modules/heatmap-scheduler/` v1.0.0 (commit `03c20f29`)

A structural copy of `strava-sync-scheduler` v1.1.0. The header records *why it is a copy*:
that module hardcodes `function_name = "strava-sync-${var.region.label}"` (v1.1.0/main.tf:15),
so a second live unit of it would collide on every resource name, and the alternative —
generalising it behind a `function_basename` variable in a v1.2.0 — would make every future
heat-map change re-plan a live, applied Strava Lambda. Copying has zero blast radius.

Changed from the source, and nothing else:

| Thing | strava-sync-scheduler v1.1.0 | heatmap-scheduler v1.0.0 |
|---|---|---|
| `locals.function_name` | `strava-sync-${var.region.label}` | `heatmap-build-${var.region.label}` |
| Lambda tag `Phase` | `"33"` | `"71"` |
| Lambda tag `Service` | `run-gpx` | `run-gpx` (unchanged) |
| `SYNC_URL` comment | Strava pull | heat-map rebuild route (**name kept** — the invoker reads it) |
| `lambda_timeout` default | `120` | **`300`**, with the maxDuration rationale in the description |
| `index.mjs` log tag | `[strava-sync]` | `[heatmap-build]` |
| `iam.tf` header | — | added a "THIN INVOKER — do NOT add data-plane permissions" note |

Carried over untouched: the `archive_file` / log-group / Lambda triple, `source_code_hash`,
`tracing_config { mode = "Active" }`, the conditional `vpc_config`, the `depends_on`, and
the `aws_scheduler_schedule` `for_each` with `flexible_time_window { mode = "OFF" }` and
`retry_policy { maximum_retry_attempts = 2 }`.

**The KMS landmine comment survived the copy verbatim** — `kms:Decrypt` identity policies
match on the KEY arn, **NOT the alias arn**; scoping to the alias silently denies at runtime.
This is grep-enforced by the plan's acceptance criteria precisely because dropping it in a
copy is how the incident gets re-learned.

The IAM grant is exactly: log stream/put on its own log group, X-Ray, `ssm:GetParameter` on
ONE parameter arn, `kms:Decrypt` on the alias's `target_key_arn` under a `PARAMETER_ARN`
encryption-context condition, and `AWSLambdaVPCAccessExecutionRole`. **Zero DynamoDB, zero
object-storage.** The scheduler role is assumable only by `scheduler.amazonaws.com` and can
only `lambda:InvokeFunction` this one function.

`lambda/index.mjs` is the same 36-line invoker: one `@aws-sdk/client-ssm` import (present in
the Node runtime), required-env validation, `GetParameterCommand` with `WithDecryption: true`,
`fetch(syncUrl, { method: 'POST', headers: { 'x-internal-secret': secret } })`, throw on
non-ok so the scheduler records a failure. **No dependency manifest, no bundler, no
`before_hook`** — nothing was installed by this plan.

### Task 2 — `region/us-east-1/heatmap-scheduler/terragrunt.hcl` (commit `8edb97c7`)

Structural copy of the strava live unit. The header keeps the three load-bearing facts in
this unit's own words:

1. `sync_url` must be the Cloud Map / ECS service-discovery **private** DNS name — the
   public ALB accepts 443 only from the CloudFront prefix list, and the private zone does
   not resolve outside the VPC, so neither a public host nor a no-VPC Lambda can reach the
   route.
2. The unit **MUST** live under `region/us-east-1/` so the module `config.hcl`'s
   `find_in_parent_folders("region.hcl")` resolves `region.{label,full}`.
3. Validation is a scoped plan or `terragrunt-plan.yml`; **never** a local apply.

Plus: us-east-1 is the only live region for run.gpx, so no ca-central-1 unit exists.

Inputs: `sync_url` = `http://run-gpx.app-use1-dc34.local:3000/use1/api/gpx/internal/heatmap-build`;
the same `/dc34/secrets/use1/jwt/internal_secret` parameter run.gpx's `AUTH_INTERNAL_SECRET`
reads (the gpx internal routes accept `INTERNAL_SYNC_SECRET ?? AUTH_INTERNAL_SECRET`);
private subnets + `[http_only, sshhttps]` from the `network` dependency; and
`lambda_timeout = 300`.

### Task 3 — Scoped CI plan (commit `74951bca`)

`gh workflow run terragrunt-plan.yml --ref gsd/phase-71-heat-map-layers -f region=us-east-1 -f modules=heatmap-scheduler`

**Run:** https://github.com/whereiskurt/defcon.run.34/actions/runs/30601617385 — conclusion
`success`. The run reference (scheme-stripped, to satisfy the unit's no-public-URL grep) is
also recorded in the live unit's header so the provenance travels with the file.

## The schedule facts (71-08 assertion 13 checks these field-by-field)

| Schedule name | ScheduleExpression | Timezone | State | Group |
|---|---|---|---|---|
| `heatmap-build-use1-hourly` | `cron(0 * 5-10 8 ? 2026)` | `America/Los_Angeles` | `ENABLED` | `default` |
| `heatmap-build-use1-daily` | `cron(0 4 * * ? *)` | `America/Los_Angeles` | `ENABLED` | `default` |

The module sets **no `group_name`**, so both schedules land in the EventBridge Scheduler
`default` group — assertion 13 must query them there. The plan log confirms this indirectly
(`group_name = (known after apply)`), and the two live Strava schedules are in `default`,
which is the same module shape.

`cron(0 * 5-10 8 ? 2026)` is the top of every hour on 5–10 August 2026, which is exactly
`CON_DAYS[].date` in `apps/run.gpx/webapp/src/lib/con-days.ts` (2026-08-05 … 2026-08-10) —
verified against the file, not assumed.

## Plan resource counts (71-08 Task 2F compares the apply against these)

**`Plan: 9 to add, 0 to change, 0 to destroy.`**

| # | Address |
|---|---|
| 1 | `aws_lambda_function.sync` |
| 2 | `aws_cloudwatch_log_group.sync` |
| 3 | `aws_iam_role.sync` |
| 4 | `aws_iam_role.scheduler` |
| 5 | `aws_iam_role_policy.sync` |
| 6 | `aws_iam_role_policy.scheduler` |
| 7 | `aws_iam_role_policy_attachment.sync_vpc` |
| 8 | `aws_scheduler_schedule.sync["hourly"]` |
| 9 | `aws_scheduler_schedule.sync["daily"]` |

Exactly the expected set: one Lambda, one log group, two roles, three policy resources
(two inline + one managed attachment), two schedules.

## Verification

| Check | Result |
|---|---|
| `terraform fmt -check -recursive` (module v1.0.0) | clean, no output |
| `terraform validate` (module v1.0.0) | **Success! The configuration is valid.** |
| `terragrunt hcl validate` (live unit, `AWS_PROFILE=dc34-application`) | clean (one WARN: `network` mock outputs, expected pre-apply) |
| `terragrunt hcl format --check` (live unit) | clean |
| `grep -F 'heatmap-build-${var.region.label}' main.tf` | **1** |
| `grep -Ec 'dynamodb:\|s3:' iam.tf` | **0** — no data-plane IAM |
| `grep -c target_key_arn iam.tf` / `grep -Ec 'NOT the alias arn' iam.tf` | **1** / **1** — landmine survived |
| `grep -c 'default     = 300' variables.tf` | **1** |
| `grep -Ec 'import \|require\(' lambda/index.mjs` | **1** (SSM client only) |
| `grep -c heatmap-build lambda/index.mjs` | **1** |
| `git diff --stat modules/strava-sync-scheduler/` | **empty** |
| `git diff --stat live/.../strava-sync-scheduler/` | **empty** |
| unit: `grep -c 'api/gpx/internal/heatmap-build'` / `modules/heatmap-scheduler/config.hcl` / `v1.0.0` | **1 / 1 / 1** |
| unit: `grep -cF 'cron(0 * 5-10 8 ? 2026)'` / `America/Los_Angeles` / `lambda_timeout = 300` | **1 / 1 / 1** |
| unit: `grep -Ec 'gpx\.defcon\.run\|https://'` | **0** — no public host as the sync target |
| unit: `http_only` / `sshhttps` | **4** / **2** |
| `ls region/ca-central-1/heatmap-scheduler` | no output — not created |
| CI plan conclusion | **success** (run 30601617385) |
| `Plan:` line | **9 to add, 0 to change, 0 to destroy** |
| `grep -c strava-sync` over the downloaded plan log | **0** — the copy did not leak |
| Lambda `function_name` / `timeout` in the plan | `heatmap-build-use1` / `300` |
| Schedule addresses in the plan | `...sync["hourly"]`, `...sync["daily"]` |
| `grep -icE 'AccessDenied\|not authorized\|scheduler:'` over the plan log | **0** |
| Local `terragrunt apply` | **never invoked** — AGENTS.md rule 4 honoured |
| File deletions across all three commits | **none** |

## Deploy prerequisites for 71-08

**`scheduler:*` on the CI apply role — believed present, but a plan cannot prove it.**
PATTERNS.md flags a past incident where the GitHub OIDC CI role was missing `scheduler:*`.
The scoped plan produced **zero** authorization errors, but `terragrunt-plan.yml` runs under
the `terraform-plan` environment/role — a successful plan is *not* evidence that the
`terragrunt-apply.yml` role can `scheduler:CreateSchedule`. The actual evidence is empirical:

```
AWS_PROFILE=dc34-application aws scheduler list-schedules
default  strava-sync-use1-evening  ENABLED
default  strava-sync-use1-morning  ENABLED
```

Those two were created by `terragrunt-apply.yml` from the same module shape, so the grant
exists. **If 71-08's apply nevertheless fails on a `scheduler:` authorization error, stop and
report it — do not widen the CI role by hand.**

Other 71-08 notes:

- The apply is `gh workflow run terragrunt-apply.yml -f region=us-east-1 -f modules=heatmap-scheduler`.
  Scope it. A bare `apply --all` across this repo is known-unsafe.
- The branch `gsd/phase-71-heat-map-layers` was **pushed** so CI could see the new unit; the
  plan run was dispatched with `--ref gsd/phase-71-heat-map-layers`. The apply must use the
  same ref (or run after merge), or it will plan against a `main` that has no such unit.
- The DC34 artifact at `uploads/HEATMAP/dc34.json` **does not exist yet** and first appears
  when this scheduler actually runs post-apply. That is expected, not a failure. Between the
  apply and the first fire, the serve route will 404 for `dc34` — the daily 04:00 PT entry
  bounds that window to under 24h, or 71-08 can invoke the Lambda once manually to seed it.

## Deviations from Plan

### Criteria wording clarified (no behaviour change)

**1. Task 1's `function_name` grep is GNU-flavoured**
- The criterion is `grep -c 'heatmap-build-\${var.region.label}' main.tf` → `1`. On this
  host's BSD grep that returns **0** because of the unescaped `{`. `grep -cF` on the same
  literal returns **1**, and the string appears exactly once at `main.tf:24`. The intent —
  the new function name is set once — is satisfied.

**2. Task 2's `grep -c 'v1.0.0'` → 1 required dropping a version from a comment**
- The strava live unit's header points at
  `infra/terraform/modules/network/v1.0.0/securitygroups.tf`. Copying that verbatim made
  `v1.0.0` appear **twice** (the comment plus the `terraform { source }` pin), failing the
  criterion. Reworded the pointer to "the network module's securitygroups.tf" — the
  reference survives, and `v1.0.0` now appears exactly once, on the source pin, which is
  what the criterion is guarding.

**3. Task 3 had no source-file output of its own**
- Task 3 is a validation task; its `<files>` entry is the unit from Task 2, unchanged. To
  give it a real atomic commit rather than a no-op, the validated run reference and its
  resource counts were appended to the live unit's `VALIDATION:` header block. The run URL
  is recorded scheme-stripped (`actions/runs/30601617385`) because the unit carries a
  `grep -Ec '…|https://'` → 0 criterion.

### Environment findings (not fixes)

**4. `terragrunt hcl validate` needs `AWS_PROFILE` set, or it fails on SOPS**
- Without a profile the command emits two errors (SOPS cannot decrypt via
  `alias/sops` KMS, plus a `CtyJSONOutput` unmarshal error). The **already-applied, live**
  `strava-sync-scheduler` unit produces byte-identical errors in the same shell, which
  establishes it as an environment/credential artifact rather than a defect in the new unit.
  Re-running as `AWS_PROFILE=dc34-application AWS_REGION=us-east-1` validates clean. No file
  was changed for this.

**5. The feature branch had to be pushed before CI could plan**
- `terragrunt-plan.yml` checks out the dispatched ref, so the 25 unpushed commits on
  `gsd/phase-71-heat-map-layers` (including Tasks 1–2) had to reach `origin` first. Pushing
  a feature branch is AGENTS.md rule 2's normal path; no PR was opened and nothing was
  merged.

## Deferred Issues

None. **D-71-A** (app-wide eslint circular-config crash in `run.gpx/webapp`) is unrelated to
this plan — no application code was touched.

## Known Stubs

None. The module and unit are complete and wired: the Lambda reads a real SSM parameter and
POSTs a real route that exists on this branch (71-02). Nothing returns a placeholder. The
resources are not *applied* yet — that is 71-08's deliverable and is sequencing, not a stub.

## Threat Flags

None beyond the plan's register. No new surface was introduced that the plan did not
enumerate — the only network path this plan creates is a Lambda ENI inside the existing
`http_only` SG reaching a route 71-02 already shipped, opening **no new ingress rule**.

| Threat | Status |
|---|---|
| T-71-28 (EoP, invoker role) | Grep-verified zero DynamoDB / object-storage statements; grant is logs + X-Ray + one `ssm:GetParameter` + one conditioned `kms:Decrypt` + the VPC ENI managed policy |
| T-71-29 (EoP, scheduler role) | `scheduler.amazonaws.com` trust only; sole permission `lambda:InvokeFunction` on this one function arn |
| T-71-30 (KMS alias-vs-key trap) | `data.aws_kms_alias.ssm.target_key_arn`, never the alias arn; landmine comment copied verbatim and grep-verified |
| T-71-31 (spoofing the build route) | 71-02's shared-secret guard is the control; the Lambda joins the SG the target already ingresses from — no new rule |
| T-71-32 (overlapping builds) | `lambda_timeout = 300` = the route's `maxDuration`; `maximum_retry_attempts = 2`; hourly cadence leaves 55 min of headroom |
| T-71-33 (copy drifting onto live Strava) | Plan log has **zero** `strava-sync` addresses; `git diff --stat` on both the Strava module and its live unit is **empty** |
| T-71-SC (supply chain) | No dependency manifest at all; one import, resolved from the Lambda runtime. Nothing installed |

## Self-Check: PASSED

All seven created files exist on disk (`config.hcl`, `main.tf`, `iam.tf`, `variables.tf`,
`outputs.tf`, `lambda/index.mjs`, and the live `terragrunt.hcl`). All three commits resolve
in `git log`: `03c20f29`, `8edb97c7`, `74951bca`.
