---
phase: 73-meshtk-llm-per-sender-rate-limiting-non-blocking-token-bucke
plan: 02
subsystem: infra
tags: [terraform, terragrunt, cloudwatch, sns, ecs, meshtk, bedrock, observability]

# Dependency graph
requires:
  - phase: 72-bot-hardening-clickable-one-time-awards-fail-closed-guardrai
    provides: "the admin-reports guardrail metric-filter -> alarm -> dcr-admin-reports-tripwire SNS plumbing (72-04), the plain-text-not-JSON pattern lesson, and the guardrail_log_group_name input that this plan reuses"
  - phase: 73-meshtk-llm-per-sender-rate-limiting-non-blocking-token-bucke
    provides: "73-01 emits the MESHTK_LLM_RATE_LIMIT marker token and reads MESHTK_LLM_CALLS_PER_HOUR (wave-1 sibling, zero shared files)"
provides:
  - "aws_cloudwatch_log_metric_filter.llm_rate_limits — plain-text MESHTK_LLM_RATE_LIMIT filter on the ghosts log group, publishing LLMRateLimits"
  - "aws_cloudwatch_metric_alarm.llm_rate_limits (dcr-mqtt-llm-rate-limit) — NOTIFY-ONLY, >=20 refusals/5min to the existing tripwire topic"
  - "threshold_llm_rate_limits_per_5min module variable (default 20) wired site.hcl -> terragrunt input -> alarm"
  - "MESHTK_LLM_CALLS_PER_HOUR = \"60\" on the ghosts container — the per-radio ceiling as a one-line, rebuild-free operator knob"
affects: [73-03, meshtk releases, con-week runbook, admin-reports module]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Second instance of the 72-04 pair-shape: plain-text metric filter + count-gated alarm on the shared guardrail_log_group_name"
    - "Notify-only alarm posture — alarm_actions is SNS and nothing else, ok_actions deliberately omitted on a bursty counter"
    - "Accepted-risk documentation carried in the infrastructure itself (metric comment, alarm_description, site.hcl comment), not only in the plan"

key-files:
  created: []
  modified:
    - infra/terraform/modules/admin-reports/v1.0.0/metrics.tf
    - infra/terraform/modules/admin-reports/v1.0.0/alarms.tf
    - infra/terraform/modules/admin-reports/v1.0.0/variables.tf
    - infra/terraform/live/site/site.hcl
    - infra/terraform/live/site/region/us-east-1/admin-reports/terragrunt.hcl
    - infra/terraform/live/site/services/run.mqtt/service.hcl

key-decisions:
  - "The alarm is NOTIFY-ONLY: alarm_actions is the existing dcr-admin-reports-tripwire SNS topic and nothing else — no ok_actions, no insufficient_data_actions, no Lambda/autoscaling/SSM target. Locked by Kurt 2026-08-01: dead ghosts mid-con are a worse failure than a visible overage."
  - "ok_actions omitted on purpose, unlike the 72-04 guardrail alarm: 'the sidecar came back' is news, 'an abusive radio got bored' is not, and OK/ALARM flap on a bursty counter is pure email noise."
  - "Reused var.guardrail_log_group_name rather than adding a second log-group input — same ghosts container, and a second name to keep in sync is a second thing to get wrong."
  - "Threshold 20 per 5 min (~4/min sustained). A tripped radio keeps producing refusals for as long as it transmits, so 2-3 would page on one enthusiastic player; 4/min sustained is machine traffic."
  - "The accepted residual risk (this counts refusals, not dollars; aggregate multi-radio spend is deliberately unbounded) is written into the metric comment, the alarm_description AND the site.hcl comment, so nobody later reads a quiet alarm as proof spend is controlled."
  - "Pre-existing HCL format drift in 9 unrelated live/site files was NOT swept in — reverted with a scoped git checkout and filed to deferred-items.md, matching 72-04's decision."

patterns-established:
  - "Plain-text metric filter pattern for meshtk's unstructured logrus lines — a $.evt JSON selector reads a convincing permanent zero (the 72-04 lesson, restated at the new block)"
  - "Kill-switch semantics documented at the point of edit: the service.hcl comment states that exactly \"0\" refuses all model calls while blank/non-numeric falls back to 60"

requirements-completed: [RATE-03, RATE-04]

coverage:
  - id: D1
    description: "Rate-limit refusals in the ghosts log group are counted as the LLMRateLimits CloudWatch metric via a plain-text MESHTK_LLM_RATE_LIMIT filter"
    requirement: "RATE-04"
    verification:
      - kind: other
        ref: "cd infra/terraform/modules/admin-reports/v1.0.0 && terraform fmt -check -recursive && terraform validate"
        status: pass
      - kind: other
        ref: "grep -A 4 'aws_cloudwatch_log_metric_filter\" \"llm_rate_limits' metrics.tf | grep pattern | grep -c '\\$\\.' == 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Sustained refusals raise dcr-mqtt-llm-rate-limit on the existing tripwire SNS topic, notify-only, with no action target that could silence the fleet"
    requirement: "RATE-04"
    verification:
      - kind: other
        ref: "awk block-scan of aws_cloudwatch_metric_alarm.llm_rate_limits: alarm_actions = [aws_sns_topic.tripwire.arn] present; ok_actions/insufficient_data_actions/lambda/autoscaling/ssm count == 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both resources are count-gated on guardrail_log_group_name so an unset name provisions nothing"
    requirement: "RATE-04"
    verification:
      - kind: other
        ref: "grep -c 'var.guardrail_log_group_name == \"\" ? 0 : 1' metrics.tf == 2 && same against alarms.tf == 2"
        status: pass
    human_judgment: false
  - id: D4
    description: "The alarm threshold is a one-line site.hcl knob flowing through a try()-wrapped terragrunt input to the module variable"
    requirement: "RATE-04"
    verification:
      - kind: other
        ref: "grep 'llm_rate_limits_per_5min   = 20' site.hcl; grep 'threshold_llm_rate_limits_per_5min = try(..., 20)' admin-reports/terragrunt.hcl"
        status: pass
    human_judgment: false
  - id: D5
    description: "The per-radio ceiling is tunable in production via MESHTK_LLM_CALLS_PER_HOUR on the ghosts container, with kill-switch semantics documented at the point of edit"
    requirement: "RATE-03"
    verification:
      - kind: other
        ref: "grep -c MESHTK_LLM_CALLS_PER_HOUR service.hcl == 1, value \"60\", inside environment[] before secrets = ["
        status: pass
    human_judgment: false
  - id: D6
    description: "The ghosts log group's retention is unchanged — retention.tf and log_group_names untouched"
    verification:
      - kind: other
        ref: "git diff --stat modules/admin-reports/v1.0.0/retention.tf — empty"
        status: pass
    human_judgment: false
  - id: D7
    description: "The alarm actually fires on real meshtk refusal lines once 73-01 is live and applied"
    verification: []
    human_judgment: true
    rationale: "Requires the 73-03 apply plus a real (or synthesised) over-cap radio in production; a metric filter's match against live log text cannot be proven from authoring-time terraform validate."

# Metrics
duration: 12min
completed: 2026-08-01
status: complete
---

# Phase 73 Plan 02: LLM rate-limit alarm and operator ceiling Summary

**Sustained per-radio LLM refusals now count into a CloudWatch metric and raise a notify-only alarm on the existing tripwire topic, and the per-radio ceiling became a one-line ECS env knob — with the "this counts refusals, not dollars" acceptance written into the infrastructure itself.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-08-01T06:21Z
- **Completed:** 2026-08-01T06:33Z
- **Tasks:** 2/2
- **Files modified:** 6 (plus `deferred-items.md` created)

## Accomplishments

- **The refusal signal became a metric.** `aws_cloudwatch_log_metric_filter.llm_rate_limits`
  attaches to the ghosts log group with a **plain-text** `MESHTK_LLM_RATE_LIMIT` pattern —
  not a `$.evt` JSON selector, which is the trap 72-04 fell into and which would publish a
  convincing, permanent zero against meshtk's unstructured logrus lines.
- **The metric became an alarm that cannot hurt anything.** `dcr-mqtt-llm-rate-limit` fires
  at `>= 20` refusals in 5 minutes to the existing `dcr-admin-reports-tripwire` SNS topic.
  Its only action target is that topic: no `ok_actions`, no `insufficient_data_actions`, no
  Lambda, no autoscaling, no SSM document. Nothing in this plan can take the ghosts off the
  air, and the `alarm_description` says so in words an operator will read in the email.
- **Both resources are count-gated** on `var.guardrail_log_group_name`, so an unset name
  provisions nothing rather than binding to a nonexistent group; `treat_missing_data =
  "notBreaching"` keeps the alarm out of permanent `INSUFFICIENT_DATA` in the window before
  73-01 ships (during which the metric reads a real, correct 0).
- **Two production knobs, no rebuild.** The alarm threshold is one line in `site.hcl`
  flowing through a `try(..., 20)` terragrunt input; the per-radio ceiling is
  `MESHTK_LLM_CALLS_PER_HOUR = "60"` on the ghosts container, matching the meshtk code
  default so the line is a tuning handle rather than a behaviour change.
- **The accepted risk is in the infrastructure, not just the plan.** The metric comment,
  the `alarm_description` and the `site.hcl` comment each state that this counts refusals
  and not spend, and that aggregate multi-radio cost is deliberately unbounded per the
  2026-08-01 decision — so a quiet alarm is never mistaken for cost control.
- **Retention untouched.** `retention.tf` and `log_group_names` were not modified, so the
  ghosts group's retention is exactly what it was.

## Task Commits

1. **Task 1: Metric filter, alarm and threshold variable in the admin-reports module** — `944f2828` (feat)
2. **Task 2: Wire the threshold and the operator ceiling into live config** — `8ae438ae` (feat)

## Files Created/Modified

- `infra/terraform/modules/admin-reports/v1.0.0/metrics.tf` — added
  `aws_cloudwatch_log_metric_filter.llm_rate_limits` (`dcr-mqtt-llm-rate-limits`) publishing
  `LLMRateLimits` (value 1, default 0, Count), with a comment covering the plain-text-not-JSON
  rule, the refusals-not-spend limitation, and why a pre-73-01 zero is correct.
- `infra/terraform/modules/admin-reports/v1.0.0/alarms.tf` — added section `(f)`,
  `aws_cloudwatch_metric_alarm.llm_rate_limits` (`dcr-mqtt-llm-rate-limit`): Sum / 300s / 1
  period / `GreaterThanOrEqualToThreshold` / `notBreaching`, `alarm_actions` = the tripwire
  topic only.
- `infra/terraform/modules/admin-reports/v1.0.0/variables.tf` — added
  `threshold_llm_rate_limits_per_5min` (number, default 20) with the threshold arithmetic and
  the spend caveat in its heredoc.
- `infra/terraform/live/site/site.hcl` — `admin_reports.thresholds.llm_rate_limits_per_5min = 20`
  plus a comment paragraph on what a trip means and what it does not prove.
- `infra/terraform/live/site/region/us-east-1/admin-reports/terragrunt.hcl` — maps
  `threshold_llm_rate_limits_per_5min` via `try(..., 20)`; a comment records that the alarm
  reuses `guardrail_log_group_name` two lines above rather than taking a second input.
- `infra/terraform/live/site/services/run.mqtt/service.hcl` — one additive entry in the ghosts
  container `environment` array: `MESHTK_LLM_CALLS_PER_HOUR = "60"`, carrying the four facts
  the plan required (what it bounds, that 60 matches the code default, the `"0"`-is-a-kill-switch
  vs blank-falls-back-to-60 distinction, and that a sustained trip raises the notify-only alarm).
- `.planning/phases/73-.../deferred-items.md` — created; logs the pre-existing HCL format drift
  and two unsatisfiable-as-written acceptance criteria.

## Verification Results

| # | Gate | Result |
|---|------|--------|
| 1 | `terraform fmt -check -recursive` (module) | **exit 0** |
| 2 | `terraform init -backend=false` + `terraform validate` (module) | **"Success! The configuration is valid."** exit 0 |
| 3 | `terragrunt hcl format --check --file <each of the 3 live files>` | **exit 0** for all three |
| 3' | `terragrunt hcl format --check` repo-wide over `live/site` | **exit 1 — PRE-EXISTING**, 9 files, none of them this plan's (see Issues) |
| 4 | Filter + alarm count-gated; pattern is plain text | gate count 2 in `metrics.tf`, 2 in `alarms.tf`; `pattern` line contains no `$.` |
| 5 | Alarm's only action is the tripwire topic | block scan: `alarm_actions = [aws_sns_topic.tripwire.arn]`; `ok_actions`/`insufficient_data_actions`/lambda/autoscaling/ssm count = **0** |
| 6 | Threshold flows site.hcl -> terragrunt -> module with `try(...)` | present, fallback 20 |
| 7 | `MESHTK_LLM_CALLS_PER_HOUR` present with kill-switch note | count 1, value `"60"`, line 382 — before `secrets = [` at line 387 |
| 8 | `retention.tf` untouched; no state/`.terraform` in tree | `git diff --stat retention.tf` empty; `.terraform` under `live/site` = 0; no `terraform.tfstate` anywhere; module init artifacts are gitignored |
| — | `service.hcl` is purely additive | `git diff \| grep -c '^-'` = **1** (the `--- a/...` header only); zero real deletions |
| — | No file deletions in either commit | `git diff --diff-filter=D --name-only HEAD~2 HEAD` = empty |

Two acceptance criteria were asserted with corrected patterns because the plan's literal
greps cannot match the code they describe — both documented in `deferred-items.md`:

- `grep -c 'aws_cloudwatch_log_metric_filter "llm_rate_limits"'` omits the closing quote
  after the resource type, so it cannot match valid HCL. Asserted with the full
  `resource "<type>" "<name>"` prefix instead: **1** filter block, **1** alarm block.
- `grep -c 'guardrail_log_group_name'` in the terragrunt unit "is still 1" contradicts the
  same plan's action step, which explicitly asks for a comment naming that variable. The
  criterion's real intent — no duplicate input mapping — was asserted with
  `grep -cE '^[[:space:]]*guardrail_log_group_name[[:space:]]*='` = **1** (one assignment;
  the second raw hit is the requested comment).

Neither substitution weakens the check: both replacements are strictly more precise than
the originals.

## Decisions Made

- **No `ok_actions` on this alarm**, diverging deliberately from the 72-04 guardrail alarm
  it is otherwise a copy of. "The sidecar came back" is useful news; "an abusive radio
  stopped" is not, and OK/ALARM flapping on a bursty counter would train the operator to
  ignore the tripwire.
- **Reuse `guardrail_log_group_name`** rather than introducing a parallel input for the same
  ghosts container.
- **Do not sweep the pre-existing HCL format drift.** Running the formatter tree-wide
  rewrote 9 unrelated files (including ~70 lines of realignment in `run.auth/service.hcl`);
  that was reverted with a scoped `git checkout` of exactly those 9 paths. Same call 72-04
  made, and the local terragrunt is 0.99.1 against AGENTS.md's recorded 0.97, so
  "fixing" alignment locally risks trading one version's opinion for another's.

## Deviations from Plan

**1. [SCOPE BOUNDARY] Reverted collateral formatting of 9 unrelated `live/site` files**

- **Found during:** Task 2
- **Issue:** The plan's prescribed `terragrunt hcl format` over `infra/terraform/live/site`
  rewrote 9 files that predate this phase and that 73-02 does not own, turning a 3-file
  additive change into a 12-file diff.
- **Fix:** Scoped `git checkout -- <the 9 paths>`; kept only this plan's three files, each
  verified format-clean with `--file`. Logged to `deferred-items.md`.
- **Files modified:** none (revert to HEAD state)
- **Verification:** `git status --short -- infra/terraform/live/site` lists exactly the three
  plan-owned files; `git diff HEAD~2 HEAD --name-only` contains none of the nine.
- **Committed in:** n/a — the revert means those files never entered a commit.

---

**Total deviations:** 1 (scope-boundary revert; no auto-fixes were needed)
**Impact on plan:** None on the delivered infrastructure. Both tasks shipped exactly as
specified. No scope creep.

## Issues Encountered

**Repo-wide `terragrunt hcl format --check` exits 1 on a pre-existing baseline.**
Plan verification step 3 asks for exit 0 over the whole `live/site` tree. That is not
achievable at today's baseline without reformatting 9 unrelated files — the identical
finding 72-04 filed and declined. Confirmed pre-existing: the 9 flagged files are at their
`HEAD~2` bytes (they were reverted, never committed), and none appear in
`git diff HEAD~2 HEAD --name-only`. The check was therefore asserted per-file with
`--file`, which scopes correctly on terragrunt 0.99.1 and returns exit 0 for all three
plan-owned files. Also worth recording: **there is no `hcl format` gate in CI** —
`terragrunt-apply.yml` pins `terraform_version: 1.14.3` and prints `terragrunt --version`
but never runs a format check — so the drift breaks nothing downstream.

## Known Stubs

None. Every resource and knob in this plan is fully wired end to end. The one thing that is
intentionally inert until its sibling lands is the metric itself: it reads a real 0 until
73-01's `MESHTK_LLM_RATE_LIMIT` token ships, which is the documented and correct behaviour
(and `treat_missing_data = "notBreaching"` keeps the alarm out of `INSUFFICIENT_DATA` in the
meantime).

## Threat Flags

None. No new network endpoint, auth path, file-access pattern or schema change at a trust
boundary was introduced — this plan adds two CloudWatch resources, one module variable and
one ECS environment entry, all inside surfaces the plan's `<threat_model>` already covers.

## User Setup Required

None for authoring. **Nothing in this plan is live yet** — it must be applied:

- The metric filter, alarm and threshold need an `admin-reports` apply.
- `MESHTK_LLM_CALLS_PER_HOUR` needs an ECS task-definition apply for run.mqtt.

Both run in GitHub Actions (73-03), never locally (AGENTS.md Essential Rule 4). Note the
72-08 finding: the `terraform-apply` GitHub environment is branch-locked to `main`, so this
config must be merged to `main` before any apply can be dispatched.

## Next Phase Readiness

**Ready for 73-03 (release + apply).** The full chain is authored and validated:
ghosts refusal line -> `guardrail_log_group_name` -> plain-text filter -> `LLMRateLimits` ->
count-gated alarm -> `aws_sns_topic.tripwire`, and
`site.hcl` threshold -> terragrunt input -> alarm threshold, and
`service.hcl` env -> meshtk `llmCallsPerHour()` -> per-radio bucket capacity.

Concerns for 73-03:

- **Ordering.** The ECS apply carrying `MESHTK_LLM_CALLS_PER_HOUR` is only meaningful once
  73-01's meshtk image is built and pushed; applying it against an image that ignores the
  var is harmless but proves nothing.
- **Branch lock.** `terraform-apply` only permits `main` — merge first, squash-merge per the
  established project workflow.
- **What the alarm does NOT cover.** Aggregate Bedrock spend across many distinct radios
  remains unbounded and raises nothing. This is a recorded acceptance (Kurt, 2026-08-01),
  documented in three places in the infra, and must not be quietly "fixed" by widening scope.

## Self-Check: PASSED

All 6 modified source files exist on disk, both phase artifacts
(`73-02-SUMMARY.md`, `deferred-items.md`) exist, and both task commits
(`944f2828`, `8ae438ae`) are present in `git log --oneline --all`.

---
*Phase: 73-meshtk-llm-per-sender-rate-limiting-non-blocking-token-bucke*
*Completed: 2026-08-01*
