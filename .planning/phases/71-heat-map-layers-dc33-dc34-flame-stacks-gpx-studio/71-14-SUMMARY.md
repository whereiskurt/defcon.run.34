---
phase: 71-heat-map-layers-dc33-dc34-flame-stacks-gpx-studio
plan: 14
subsystem: infra
tags: [terraform, terragrunt, eventbridge-scheduler, lambda, iam, confused-deputy, cron, timeout-chain]

requires:
  - phase: 71-11
    provides: "BUILD_BUDGET_MS = 240_000 in apps/run.gpx/webapp/src/lib/heatmap-build.ts — the innermost of the three bounds, and the only one the build itself enforces"
  - phase: 71-07
    provides: "the heatmap-scheduler module v1.0.0 and the us-east-1 live unit this plan edits, plus the 9-add baseline the new plan is read against"
provides:
  - "Disjoint schedules: the daily moved 04:00 PT -> 04:20 PT, so the guaranteed double build at the top of the hour on all six con days is gone (WR-04)"
  - "A strictly increasing timeout chain 420 > 300 > 240, documented in one place in the live unit and again at the fetch site (WR-03)"
  - "An explicitly bounded invoker fetch (AbortSignal, 300 s) so a slow build yields one honest failure instead of retries stacking concurrent rebuilds"
  - "aws:SourceAccount confused-deputy conditions on BOTH assume-role trust policies (WR-08)"
  - "Invoker log hygiene: status + byte count on success, truncated body only on the non-2xx branch, SSM path out of the throw (WR-09 invoker half)"
  - "reserved_concurrent_executions = 1 as a measured backstop against overlapping builds"
affects: [71-16, 71-15, heatmap-scheduler, run.gpx]

tech-stack:
  added: []
  patterns:
    - "Three-tier timeout chain (builder deadline < invoker fetch bound < function timeout), documented at every tier with the same three numbers"
    - "Cron minutes chosen to be off both :00 and :30 so a future half-hourly cadence cannot reintroduce a collision"
    - "Measure-then-decide for reserved concurrency: read the account limits before reserving, record the numbers either way"

key-files:
  created: []
  modified:
    - infra/terraform/live/site/region/us-east-1/heatmap-scheduler/terragrunt.hcl
    - infra/terraform/modules/heatmap-scheduler/v1.0.0/variables.tf
    - infra/terraform/modules/heatmap-scheduler/v1.0.0/main.tf
    - infra/terraform/modules/heatmap-scheduler/v1.0.0/iam.tf
    - infra/terraform/modules/heatmap-scheduler/v1.0.0/lambda/index.mjs

key-decisions:
  - "71-14: daily cron minute is 20, NOT the review's suggested 30 — :30 is off the top of the hour but would collide with any future half-hourly cadence; :20 is off both"
  - "71-14: reserved_concurrent_executions = 1 ADDED after measuring us-east-1 headroom (limit 1000, unreserved 970, 30 already reserved across 4 functions); AWS floor is 100 unreserved, so reserving 1 more leaves 969"
  - "71-14: the VPC managed-policy attachment keeps its unindexed resource address on purpose — count-gating it is destroy-then-create, a live IAM detach during con week for zero behavioural change. Deferred post-con; the 'harmless to attach' comment replaced with an honest one"
  - "71-14: module v1.0.0 edited IN PLACE rather than forked to v1.1.0 — one consumer, created by this same phase, and a bump would also move the terragrunt source pin"
  - "71-14: the scoped CI APPLY is BLOCKED by the terraform-apply environment's branch policy (main only) and is deferred to a human decision — see Checkpoint below"

patterns-established:
  - "Acceptance greps that count a literal token are self-invalidating if the same token appears in your own new prose — hit during Task 3 (aws:SourceAccount counted 4, not 2) and fixed by referring to 'the source-account condition below' in comments"
  - "A CI plan is the honest gate for a Terraform edit on a branch; the apply is a separate, environment-gated event"

requirements-completed: [HEAT-02]

coverage:
  - id: D1
    description: "Daily schedule moved off the top of the hour to 04:20 PT; hourly expression byte-identical"
    requirement: HEAT-02
    verification:
      - kind: other
        ref: "grep gates on terragrunt.hcl: cron(20 4 * * ? *)=1, cron(0 4 * * ? *)=0, cron(0 * 5-10 8 ? 2026)=1"
        status: pass
      - kind: integration
        ref: "terragrunt-plan.yml run 30650393596 — aws_scheduler_schedule.sync[\"daily\"] expression change; sync[\"hourly\"] absent from the changed set"
        status: pass
    human_judgment: false
  - id: D2
    description: "Timeout chain 420 > 300 > 240, strictly increasing, documented at all three tiers"
    requirement: HEAT-02
    verification:
      - kind: other
        ref: "grep gates: lambda_timeout=420 (1), lambda_timeout=300 (0), 240/300/420 all present in the unit; variables.tf maxDuration=0"
        status: pass
      - kind: integration
        ref: "terragrunt-plan.yml run 30650393596 — aws_lambda_function.sync timeout 300 -> 420"
        status: pass
    human_judgment: false
  - id: D3
    description: "Invoker fetch bounded at 300 s with a named abort error; success log carries status + byte count only; SSM path out of the throw"
    requirement: HEAT-02
    verification:
      - kind: other
        ref: "node --check index.mjs exit 0; greps AbortSignal.timeout=1, 300_000>=1, body.slice(0,500)=1 (inside the !res.ok branch), old throw=0, [heatmap-build]>=1"
        status: pass
    human_judgment: false
  - id: D4
    description: "aws:SourceAccount confused-deputy condition on both trust policies, no duplicate caller-identity data source, no address churn"
    requirement: HEAT-02
    verification:
      - kind: other
        ref: "greps: aws:SourceAccount=2, data.aws_caller_identity.current.account_id>=1, data \"aws_caller_identity\"=0, count under sync_vpc=0, harmless-to-attach=0, NOT-the-alias-arn=1"
        status: pass
      - kind: integration
        ref: "terragrunt-plan.yml run 30650393596 — both aws_iam_role assume_role_policy diffs add Condition.StringEquals[aws:SourceAccount]=427284555693, in-place"
        status: pass
    human_judgment: false
  - id: D5
    description: "reserved_concurrent_executions = 1 backstop, added only after measuring account headroom"
    requirement: HEAT-02
    verification:
      - kind: other
        ref: "aws lambda get-account-settings + per-function get-function-concurrency sweep (raw output in this SUMMARY)"
        status: pass
      - kind: integration
        ref: "terragrunt-plan.yml run 30650393596 — reserved_concurrent_executions -1 -> 1"
        status: pass
    human_judgment: false
  - id: D6
    description: "Scoped CI APPLY and post-apply live re-derivation (schedules, function config, manual invoke)"
    requirement: HEAT-02
    verification:
      - kind: integration
        ref: "terragrunt-apply.yml run 30650567272 — REJECTED by the terraform-apply environment branch policy (main only)"
        status: fail
    human_judgment: true
    rationale: "The apply cannot run from the phase branch. Unblocking it means landing these commits on main, which AGENTS.md Essential Rule 2 reserves for an explicit human approval. The operator must choose between merging now and deferring the apply to 71-16."

status: blocked
---

# Phase 71 Plan 14: Scheduler Hardening (De-collide, Timeout Chain, Confused Deputy) Summary

Closed the scheduler-side warnings that make a slow or unlucky heat-map build dangerous during
the con: the two EventBridge schedules can no longer fire in the same minute, the three
timeout bounds are strictly increasing instead of two-of-three fictional, the invoker bounds
its own fetch and stops logging arbitrary response bodies, and both assume-role trust policies
now name their expected caller's account. **Source changes are complete and proven by a green
scoped CI plan (0 to add, 5 to change, 0 to destroy). The apply did NOT happen** — the
`terraform-apply` GitHub environment only permits deployments from `main`, so the run was
rejected before its first step. That is the one open item and it needs a human decision.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | De-collide the schedules and make the timeout chain strictly increasing | `d49f928d` | `live/.../heatmap-scheduler/terragrunt.hcl`, `modules/heatmap-scheduler/v1.0.0/variables.tf` |
| 2 | Bound the invoker's fetch, tighten its logs, cap concurrency as a backstop | `f5ab57c8` | `modules/heatmap-scheduler/v1.0.0/lambda/index.mjs`, `main.tf` |
| 3 | Add confused-deputy conditions to both trust policies (WR-08) | `924b0d82` | `modules/heatmap-scheduler/v1.0.0/iam.tf` |
| 4 | Scoped CI plan, scoped CI apply, live re-derivation | — (no repo files) | plan GREEN; **apply BLOCKED**; live re-derivation is PRE-apply |

## Accomplishments

### WR-04 — the guaranteed double build is gone

The hourly entry fires at minute 0 of every hour across 5-10 August 2026; the daily fired at
minute 0 of 04:00. Both are evaluated in `America/Los_Angeles`, so on **each of the six con
days** they coincided exactly, EventBridge invoked the Lambda twice in the same minute, and
with no lock, no idempotency key and no reserved concurrency that meant two full DynamoDB
scans and two full S3 fan-outs writing the same key.

```hcl
hourly = "cron(0 * 5-10 8 ? 2026)"   # UNCHANGED, byte-identical
daily  = "cron(20 4 * * ? *)"        # was cron(0 4 * * ? *)
```

**Minute 20, not the review's suggested 30.** `:30` clears the top of the hour but would
collide with any future half-hourly cadence; `:20` is off both. The in-file comment says so
explicitly and names probe assertions 13 and 18 as the pins, so a later "tidy-up" back to
`:00` has to argue with the comment first.

### WR-03 — the timeout chain is strictly increasing and no longer fictional

Before: `lambda_timeout = 300`, set **equal** to a Next.js route-level duration export that
plan 71-11 proved is inert under `output: "standalone"` on ECS Fargate. So one of the two
numbers was fictional and the relationship between them was wrong even at face value.

| Tier | Value | Where | Enforced by |
|------|-------|-------|-------------|
| builder deadline | **240 s** | `BUILD_BUDGET_MS` in `apps/run.gpx/webapp/src/lib/heatmap-build.ts` (71-11) | the build itself — aborts WITHOUT publishing |
| invoker fetch bound | **300 s** | `FETCH_TIMEOUT_MS` in `modules/heatmap-scheduler/v1.0.0/lambda/index.mjs` | `AbortSignal` on the fetch |
| function timeout | **420 s** | `lambda_timeout` in the live unit | Lambda service |

All three numbers now appear together in the live unit's comment, again at the fetch site, and
the `variables.tf` description states the *relationship* (each strictly greater than the one
inside it) rather than a number. 420 is not 300 + slack for its own sake — it has to absorb
the SSM `GetParameter` round trip, cold start, DNS and connection setup on top of the 300 s
fetch.

The failure mode this removes: a build that runs near the bound killed the invoker before the
response arrived, the invoker threw, and `retry_policy { maximum_retry_attempts = 2 }` fired
up to two more invocations — each starting a fresh full rebuild while the first was still
scanning. The invoker now observes the builder's own failure and reports it once.

### WR-09 (invoker half) — log hygiene

- Success path logs `${res.status} ${body.length} bytes`. The truncated body survives **only**
  on the `!res.ok` branch, where it is diagnostically necessary. Previously the success path
  logged 500 bytes of whatever came back — the build result JSON today, but 500 bytes of an
  arbitrary response if `SYNC_URL` were ever wrong.
- The SSM parameter path is out of the secret-not-found throw. It is not itself a secret, but
  it is a pointer to one and that throw reaches both CloudWatch and the scheduler's failure
  record.
- An abort now throws a message naming the bound, so a timeout is distinguishable from a
  transport failure in CloudWatch instead of surfacing as a bare `TimeoutError`.

### WR-08 — confused-deputy conditions on both trusts

Both `sts:AssumeRole` documents gained `StringEquals { "aws:SourceAccount" = <this account> }`,
sourced from the `data.aws_caller_identity.current` **already declared in `main.tf`** — no
second declaration (a duplicate is a plan error). The `scheduler.amazonaws.com` trust is the
one AWS explicitly documents as needing it: without it, an EventBridge Scheduler in any AWS
account that learns the role ARN can attempt to assume it. The Lambda trust got the same
treatment for symmetry.

### Reserved concurrency — measured, then added

Task 2(c) required measuring before deciding. Raw output:

```
$ aws lambda get-account-settings --profile dc34-application --region us-east-1
{
    "AccountLimit": {
        "TotalCodeSize": 322122547200,
        "CodeSizeUnzipped": 262144000,
        "CodeSizeZipped": 52428800,
        "ConcurrentExecutions": 1000,
        "UnreservedConcurrentExecutions": 970
    },
    "AccountUsage": {
        "TotalCodeSize": 16368766,
        "FunctionCount": 10
    }
}
```

Existing per-function reservations (sweep of all 10 functions in us-east-1):

```
strava-sync-use1             -> None
bib-reconcile-dc34-use1      -> 5
dc34-origin-router           -> None
qr-rollup-dc34-use1          -> None
dc34-email-forwarder         -> 10
qr-resolver-dc34-use1        -> None
on-upload-dc34-run-human-use1-> 10
abuse-detector-use1          -> None
heatmap-build-use1           -> None
processor-dc34-run-human-use1-> 5
```

5 + 10 + 10 + 5 = **30 reserved**, which reconciles exactly with `1000 - 970`. AWS requires at
least **100** unreserved concurrent executions to remain in the account; reserving 1 more
leaves **969**. Headroom is comfortable, so `reserved_concurrent_executions = 1` was **added**.

The comment is careful about what it does *not* buy: it does not eliminate stacked invocations
after a genuine failure, because the schedule's retry policy still fires — those retries just
queue behind the single reserved slot instead of running alongside. The primary fix remains the
disjoint schedules.

## Verification

| Gate | Result |
|------|--------|
| `terraform fmt -check` on `modules/heatmap-scheduler/v1.0.0` | clean |
| `terragrunt hcl format --check` on the live unit | clean (exit 0) |
| `node --check lambda/index.mjs` | exit 0 |
| Task 1 greps (9) | all pass — see below |
| Task 2 greps (6) | all pass |
| Task 3 greps (7) | all pass |
| Scoped CI plan | **0 to add, 5 to change, 0 to destroy** |
| Scoped CI apply | **BLOCKED** — environment branch policy |
| Local `terragrunt apply` | **never invoked**; `--with-terragrunt` **never passed**; no bare `--all` |

### Acceptance greps

```
Task 1                                          Task 2
daily-new  cron(20 4 * * ? *)     1  (want 1)   AbortSignal.timeout   1  (want 1)
daily-old  cron(0 4 * * ? *)      0  (want 0)   300_000               1  (want >=1)
hourly     cron(0 * 5-10 8 ? 2026)1  (want 1)   body.slice(0, 500)    1  (want <=1, in !res.ok)
lambda_timeout = 420              1  (want 1)   old secretPath throw  0  (want 0)
lambda_timeout = 300              0  (want 0)   [heatmap-build]       3  (want >=1)
"240" in unit                     1  (want >=1) iam data-plane grants 0  (want 0)
"300" in unit                     9  (want >=1)
"420" in unit                     2  (want >=1) Task 3
maxDuration in variables.tf       0  (want 0)   aws:SourceAccount      2  (want 2)
                                                caller-identity ref    2  (want >=1)
                                                dup data source        0  (want 0)
                                                count under sync_vpc   0  (want 0)
                                                harmless to attach     0  (want 0)
                                                NOT the alias arn      1  (want 1)
```

### Scoped CI plan — [run 30650393596](https://github.com/whereiskurt/defcon.run.34/actions/runs/30650393596)

Dispatched `terragrunt-plan.yml -f region=us-east-1 -f modules=heatmap-scheduler`, ref
`gsd/phase-71-heat-map-layers`. Final line:

```
Plan: 0 to add, 5 to change, 0 to destroy.
```

Every changed address, transcribed:

| Address | Change |
|---------|--------|
| `aws_iam_role.scheduler` | `assume_role_policy` gains `Condition.StringEquals["aws:SourceAccount"] = "427284555693"` |
| `aws_iam_role.sync` | same condition added |
| `aws_iam_role_policy.scheduler` | `policy` -> `(known after apply)` |
| `aws_lambda_function.sync` | `timeout 300 -> 420`, `reserved_concurrent_executions -1 -> 1`, `source_code_hash HLq31E4r… -> UrUvsIW1…`, `last_modified -> (known after apply)` |
| `aws_scheduler_schedule.sync["daily"]` | `schedule_expression "cron(0 4 * * ? *)" -> "cron(20 4 * * ? *)"` |

Two things worth naming:

- **`aws_scheduler_schedule.sync["hourly"]` is ABSENT from the changed set.** That is the
  positive proof the hourly cadence behind SC-2 and probe assertion 13 was not touched — the
  grep proves the file, the plan proves the resource.
- **`aws_iam_role_policy.scheduler` was NOT expected and is benign.** Its
  `data.aws_iam_policy_document.scheduler` reads `aws_lambda_function.sync.arn`; because the
  function has a planned change, Terraform defers the data source to apply time and the whole
  JSON reads `(known after apply)`. The ARN of an in-place-updated function does not change, so
  this resolves to the identical document. It is an in-place update, not a replacement.

**Zero destroys.** No resource address moved — which is exactly what the no-`count` prohibition
on the VPC attachment exists to guarantee, and the plan confirms it held.

### Live re-derivation — PRE-apply (the apply did not run)

Because the apply was rejected, these readings show the **old** values. They are recorded to
prove the change has not landed, and as the baseline the post-apply re-derivation is read
against.

```
$ aws scheduler get-schedule --name heatmap-build-use1-hourly --group-name default …
heatmap-build-use1-hourly   ENABLED   cron(0 * 5-10 8 ? 2026)   America/Los_Angeles

$ aws scheduler get-schedule --name heatmap-build-use1-daily --group-name default …
heatmap-build-use1-daily    ENABLED   cron(0 4 * * ? *)         America/Los_Angeles
                                      ^^^^^^^^^^^^^^^^ still the colliding minute-0 form

$ aws lambda get-function-configuration --function-name heatmap-build-use1 …
heatmap-build-use1   300   2026-07-31T03:58:18.771+0000   HLq31E4rbKuehGsjp+NKOWzDcCTS3wSyY+xS8ymQ4ZY=
                     ^^^ still 300, not 420

$ aws lambda get-function-concurrency --function-name heatmap-build-use1 …
(empty — no reservation)
```

Both schedules are `ENABLED` in `America/Los_Angeles`, as required; only the daily's expression
and the function's timeout/concurrency remain to change.

### Manual invoke — PRE-apply baseline, healthy

Run **before** the apply rather than after (the plan sequenced it after; the apply is blocked).
It still answers the question the plan cared about most — does the invoker reach the build
route at the Cloud Map private name, and did plan 71-13's edge block break that path:

```
$ aws lambda invoke --function-name heatmap-build-use1 --profile dc34-application --region us-east-1 out.json
{ "StatusCode": 200, "ExecutedVersion": "$LATEST" }
real 2.575s

$ cat out.json
{"statusCode":200,"body":"{\"ok\":true,\"year\":\"dc34\",\"generatedAt\":\"2026-07-31T17:18:49.817Z\",
  \"runCount\":0,\"totalKm\":0,\"scanned\":0,\"skipped\":0}"}
```

**200, a real build result, end to end.** The VPC-private hop is intact and the 71-13 edge
block did not break it — the edge block gates the *public* CloudFront path, and this call goes
through the private Cloud Map name, which is precisely the separation 71-13 was supposed to
preserve. `runCount: 0` is expected and not a fault: no row carries a `conDay` yet, exactly as
71-12 recorded (0 of 133), because the con days are 5-10 August 2026.

This baseline must be **re-run after the apply** — it is the check that proves the 420 s
timeout and the new handler code did not break the path.

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 - Bug] My own comment prose invalidated a Task 3 acceptance gate**

- **Found during:** Task 3, running the gates
- **Issue:** the gate is `grep -c "aws:SourceAccount" iam.tf` must equal exactly **2** — one
  per trust policy. My new explanatory comments used the literal key name, so the count came
  back **4**. A count of 4 cannot distinguish "both policies fixed" from "one policy and three
  comments", so the gate was genuinely destroyed, not merely noisy.
- **Fix:** reworded both comments to say "the source-account condition below" and let the code
  two lines down carry the literal. Count is now 2, on lines 33 and 121 — the two
  `variable =` lines, verified by `grep -n`.
- **Note:** the plan warned about exactly this class in Task 1's DISCIPLINE note (for
  `maxDuration` in `variables.tf`) but did not carry the warning to Task 3, where the same
  trap exists. I pre-emptively kept `maxDuration` out of the live unit's new comment too, even
  though nothing greps the `.hcl` for it, so no dangling reference to a deleted symbol
  survives anywhere in this unit.

**2. [Rule 3 - Blocking] Wrong `terragrunt` formatting subcommand**

`terragrunt hclfmt --check` is gone in 0.99.1 (`flag --check is not a valid global flag`). The
current spelling is `terragrunt hcl format --check`. Used that; exit 0.

### Sequencing deviation

The manual invoke was run **before** the apply instead of after, because the apply is blocked.
Documented as a pre-apply baseline above; it does **not** discharge the plan's post-apply
requirement, which remains open.

## CHECKPOINT — the scoped apply is blocked and needs a human decision

**Type:** human-action (authorization gate)

`terragrunt-apply.yml` was dispatched with the correct scope and ref and failed in 2 seconds
with zero steps executed:

```
$ gh workflow run terragrunt-apply.yml --ref gsd/phase-71-heat-map-layers \
    -f region=us-east-1 -f modules=heatmap-scheduler
→ run 30650567272 — failure
```

GitHub's annotation on that run:

> Branch "gsd/phase-71-heat-map-layers" is not allowed to deploy to terraform-apply due to
> environment protection rules.
> The deployment was rejected or didn't satisfy other protection rules.

The `terraform-apply` environment carries a custom deployment-branch policy whose only entry is
**`main`**:

```
$ gh api repos/whereiskurt/defcon.run.34/environments/terraform-apply/deployment-branch-policies
{"total_count":1,"branch_policies":[{"name":"main","type":"branch"}]}
```

This is not a transient failure and not something the executor should route around. Nothing was
applied; the account is untouched; the branch is pushed and the plan is green.

**Why this needs a human.** The only way to satisfy the policy is to land commits `d49f928d`,
`f5ab57c8`, `924b0d82` on `main`. AGENTS.md Essential Rule 2 reserves that for an explicit
approval — "Wait for explicit user approval before merging. Never auto-merge PRs unless
explicitly told." Additionally, the orchestrator's own brief for this plan states that **plan
71-16 handles the scoped CI apply**, which reads as an intent to batch the phase's applies.
Those two readings point at different actions, and choosing between them is the operator's call.

**How 71-08 solved the same problem, for reference.** It did not merge by hand: it dispatched
`buildpub.yml --ref gsd/phase-71-heat-map-layers`, which cuts a `release/<ts>` branch from the
dispatched ref and lets CI's own Release PR land the phase on `main`. Its apply
([run 30602871471](https://github.com/whereiskurt/defcon.run.34/actions/runs/30602871471)) then
ran from `main`. That path exists here too but it also ships an app release, which is a larger
action than this infra-only change needs.

### Options

| # | Option | Consequence |
|---|--------|-------------|
| 1 | Defer the apply to **71-16** (batch it with the phase's other applies) | Nothing further to do now. The source is correct and proven by plan; the collision stays live until 71-16 applies. Matches the orchestrator's stated intent. |
| 2 | Open a PR for these three infra commits and merge to `main` on approval, then re-dispatch the apply from `main` | The de-collision and timeout chain go live immediately — worth considering, since the next 04:00 PT double build is a con-week event, not an imminent one. |
| 3 | Relax the environment policy to allow `gsd/*` | **Not recommended.** The policy is doing its job; widening a deploy gate for one plan's convenience is the wrong trade five days out. |

### Resume signal

Reply with `1`, `2`, or `3` (or "defer to 71-16"). On option 2 the remaining work is exactly:
dispatch `terragrunt-apply.yml -f region=us-east-1 -f modules=heatmap-scheduler` from `main`,
then re-run the four live re-derivation commands recorded above and confirm the daily reads
`cron(20 4 * * ? *)`, the hourly is unchanged, both `ENABLED` in `America/Los_Angeles`,
`Timeout: 420`, reserved concurrency `1`, and the manual invoke still returns
`{"ok":true,...}`.

## Notes for Future Work

**Module versioning — deliberate, not an oversight.** `modules/heatmap-scheduler/v1.0.0` was
edited **in place** rather than forked to a `v1.1.0`. It has exactly one consumer (the us-east-1
live unit), it was created by this same phase four days ago, and a version bump would also
require moving the terragrunt `source` pin — more moving parts for no isolation benefit. This
is recorded so the convention is not read as sloppiness.

**Deliberately NOT closed, named rather than omitted:**

- **Count-gating the VPC managed-policy attachment** (WR-08 item 1). The AWS-managed policy
  grants `logs:*` on every log group in the account, strictly broader than the hand-written
  log-group-scoped statement in the same file — it is the widest grant in the module. Gating it
  is right, but adding `count` moves the resource address from unindexed to indexed, which
  Terraform executes as destroy-then-create: a momentary IAM detach on a live Lambda during con
  week for zero behavioural change (this deployment always supplies subnets, so the count would
  evaluate to 1 regardless). Filed for post-con; the misleading "harmless to attach" comment is
  replaced with an honest one in the meantime.
- **An idempotency key or distributed lock in the builder.** The disjoint schedules plus the
  reserved-concurrency backstop remove the deterministic collision; a lock is new state on a
  single-task service five days out.
- **`xray:PutTraceSegments` on `"*"`** is unavoidable for that action — noted in WR-08 itself so
  it is not mistaken for an oversight.

**Landmine for whoever touches these numbers next.** 240 / 300 / 420 now appear in three files
(`heatmap-build.ts`, `lambda/index.mjs`, `terragrunt.hcl`) with no mechanical link between them.
Moving one without the others silently re-creates the retry-into-a-running-build failure. Every
site carries the full chain in a comment for exactly this reason.

## Self-Check: PASSED

Files verified present:

```
FOUND: infra/terraform/live/site/region/us-east-1/heatmap-scheduler/terragrunt.hcl
FOUND: infra/terraform/modules/heatmap-scheduler/v1.0.0/variables.tf
FOUND: infra/terraform/modules/heatmap-scheduler/v1.0.0/main.tf
FOUND: infra/terraform/modules/heatmap-scheduler/v1.0.0/iam.tf
FOUND: infra/terraform/modules/heatmap-scheduler/v1.0.0/lambda/index.mjs
```

Commits verified in `git log`:

```
FOUND: d49f928d  fix(71-14): de-collide heatmap schedules and make the timeout chain strictly increasing
FOUND: f5ab57c8  fix(71-14): bound the invoker fetch, tighten its logs, cap concurrency
FOUND: 924b0d82  fix(71-14): add confused-deputy conditions to both trust policies (WR-08)
```

CI runs verified via `gh`:

```
FOUND: 30650393596  terragrunt-plan.yml   success  (0 add / 5 change / 0 destroy)
FOUND: 30650567272  terragrunt-apply.yml  failure  (environment branch policy — blocked, nothing applied)
```

One deliverable (D6, the apply + post-apply re-derivation) is open and flagged as a checkpoint
above. All other acceptance criteria pass.
