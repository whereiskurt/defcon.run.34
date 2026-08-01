# Phase 73 — Deferred Items

Out-of-scope discoveries logged during execution. NOT fixed (SCOPE BOUNDARY: only
issues directly caused by a plan's own changes are auto-fixed).

## From 73-02 (infra authoring)

### Pre-existing HCL format drift in the same 9 `live/site` files as 72-04

`terragrunt hcl format --check` run over `infra/terraform/live/site` exits **1**, flagging
nine files — all of which predate this phase and none of which 73-02 touches:

`global/cloudtrail/terragrunt.hcl`, `region/{ap-southeast-1,ca-central-1,us-east-1}/email/terragrunt.hcl`,
`region/{ap-southeast-1,ca-central-1,us-east-1}/region.hcl`,
`services/run.auth/service.hcl`, `services/run.gpx/service.hcl`

This is the identical finding 72-04 filed, and it was handled the same way. Running the
formatter tree-wide DID rewrite all nine (attribute alignment: `mock_outputs = {}` ->
`mock_outputs                            = {}`, and ~70 lines of realignment in
`run.auth/service.hcl`), and that rewrite was reverted with a scoped
`git checkout -- <the nine files>`. Two reasons not to sweep them in:

1. Scope. Nine unrelated files in an infra PR whose value is being small and reviewable.
2. Version risk. Local terragrunt is **0.99.1**; AGENTS.md records the project version as
   **0.97**. The alignment rules differ between them, so "fixing" the drift with 0.99.1
   could just move the drift to a different version's opinion. Worth noting that there is
   **no `hcl format` gate in CI at all** — `terragrunt-apply.yml` pins `terraform_version:
   1.14.3` and prints `terragrunt --version`, but never runs a format check. This is a
   local hygiene gate only, so the drift breaks nothing today.

The three files 73-02 changed (`site.hcl`, `region/us-east-1/admin-reports/terragrunt.hcl`,
`services/run.mqtt/service.hcl`) are each format-clean.

### Correction to a 72-04 note: `hcl format --check` CAN be scoped

72-04's deferred-items entry says `terragrunt hcl format --check` "ignores its path argument
and scans the whole `live/site` tree". On terragrunt 0.99.1 the `--file` flag scopes it
correctly and is the way to assert on one file:

```bash
cd infra/terraform/live/site
terragrunt hcl format --check --file services/run.mqtt/service.hcl   # exit 0
```

That is what 73-02 used to prove its own three files are clean while leaving the nine
pre-existing ones untouched. (A bare path argument still behaves as 72-04 described.)

### Two 73-02 acceptance criteria are unsatisfiable as literally written

Both are transcription slips in the plan, not defects in the delivered infra. Recorded so a
verifier re-running them does not read a false failure:

1. `grep -c 'aws_cloudwatch_log_metric_filter "llm_rate_limits"'` (and the alarm equivalent)
   cannot match valid HCL — the real line is
   `resource "aws_cloudwatch_log_metric_filter" "llm_rate_limits" {`, with a closing quote
   after the resource type. The pattern omits it. Asserted instead with the full
   `resource "<type>" "<name>"` prefix; both return 1.
2. `grep -c 'guardrail_log_group_name'` in the admin-reports `terragrunt.hcl` "is still 1"
   directly contradicts the same plan's action step, which instructs a comment noting that
   this alarm reuses `guardrail_log_group_name`. Writing that comment makes the count 2.
   The criterion's intent — no duplicate *input mapping* — was asserted precisely with
   `grep -cE '^[[:space:]]*guardrail_log_group_name[[:space:]]*='`, which returns 1
   (the second hit is the comment the plan asked for).
