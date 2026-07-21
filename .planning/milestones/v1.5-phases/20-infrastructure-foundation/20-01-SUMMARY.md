---
phase: 20-infrastructure-foundation
plan: 01
type: execute
status: complete
completed_at: 2026-07-02
---

# Plan 20-01 — Bib Routable + Secret Surface (SUMMARY)

## One-line summary

Registered `bib.defcon.run` in `site.hcl` (subdomain + CloudFront + ECR concat), created the `services/run.bib/service.hcl` skeleton (ECR repos only, task/service deferred to Plan 20-02), and provisioned a new `region/us-east-1/bib-secrets/` terragrunt unit that inline-defines the 5 SSM parameters with the nested `/dc34/secrets/use1/bib/{stripe,anthropic,venmo,cashapp}/*` paths ROADMAP.md requires.

## Tasks completed

| Task | Commit | Notes |
|------|--------|-------|
| Task 1: `site.hcl` — 4 additive edits (subdomain, cloudfront domain, `service_conf.bib`, ecr concat) | `c8218c3b` | Additive only. Did NOT touch `urls.subdomains`, `local_ports`, `secrets.definitions`, `ecs_tasks.tasks`, or `ecs_services.services` — those are Plan 20-02 territory. |
| Task 2: `services/run.bib/service.hcl` skeleton (ecr_repositories only, us-east-1 scope) | `f6ca24b0` | No `VERSION.nginx` / `VERSION.app` files, no `locals.versions` block, no `task` / `service` blocks — all deferred as planned. |
| Task 3: `region/us-east-1/bib-secrets/` (terragrunt.hcl + main.tf, 5 SSM params) | `6bac226e` | Uses `terraform { source = "." }` inline pattern per neighboring `mqtt/` precedent, `skip.hcl` guard, `regional.hcl` provider include, `data.aws_kms_alias.ssm` for `alias/dc34-ssm-use1` (no hardcoded key id). |

## Files created or modified

**Modified (1):**
- `infra/terraform/live/site/site.hcl` — 4 lines added:
  - line 23: `"bib"` appended to `locals.dns.subdomains`
  - line 62: `bib = read_terragrunt_config("./services/run.bib/service.hcl")` inside `locals.service_conf`
  - line 127: `"bib"` appended to `locals.cloudfront.domains`
  - line 219: `local.service_conf.bib.locals.ecr_repositories` appended to `local.ecr.repositories` concat

**Created (3):**
- `infra/terraform/live/site/services/run.bib/service.hcl` — 25 lines, `locals.ecr_repositories` with `run-bib-nginx` and `run-bib-app` scoped to `["us-east-1"]` only.
- `infra/terraform/live/site/region/us-east-1/bib-secrets/terragrunt.hcl` — `include "skip"`, `exclude` guard, regional provider include, `terraform { source = "." }`, empty `inputs`.
- `infra/terraform/live/site/region/us-east-1/bib-secrets/main.tf` — `data.aws_kms_alias.ssm` + 5 `aws_ssm_parameter` resources (3 SecureString w/ `ignore_changes = [value]`, 2 String w/ real defaults), all tagged `{ site = "dc34", service = "run-bib", region = "use1" }`.

## Automated verification (all passed)

Ran the per-task `<automated>` grep/awk checks from `20-01-PLAN.md`:
- Task 1: `"bib"` count ≥ 2 in site.hcl (got 2), `service_conf.bib.locals.ecr_repositories` present, `bib = read_terragrunt_config` present. ✅
- Task 2: file exists, contains both repo names, contains NO `ca-central-1` or `ap-southeast-1` strings. ✅
- Task 3: both files exist, exactly 5 `aws_ssm_parameter` matches, exactly 3 `ignore_changes` matches (only lifecycle blocks — comments were reworded so the phrase does not appear anywhere else), stripe `secret_key` path present. ✅

## Operator handoff — Kurt runs after `terragrunt apply`

The 3 SecureString params ship with placeholder values (`"PLACEHOLDER_SET_BY_KURT"`) and `lifecycle { ignore_changes = [value] }`. Before Phase 22 deploy Kurt must set real values via the AWS CLI. Verbatim commands (mirror Kurt's 2026-07-02 notes):

```bash
aws ssm put-parameter --overwrite \
  --name /dc34/secrets/use1/bib/stripe/secret_key \
  --value "sk_test_..." \
  --type SecureString \
  --key-id alias/dc34-ssm-use1

aws ssm put-parameter --overwrite \
  --name /dc34/secrets/use1/bib/stripe/webhook_signing_secret \
  --value "whsec_..." \
  --type SecureString \
  --key-id alias/dc34-ssm-use1

aws ssm put-parameter --overwrite \
  --name /dc34/secrets/use1/bib/anthropic/api_key \
  --value "sk-ant-..." \
  --type SecureString \
  --key-id alias/dc34-ssm-use1
```

After running these, a fresh `terragrunt plan` in `region/us-east-1/bib-secrets/` MUST show zero drift on those 3 params — that proves `ignore_changes = [value]` is doing its job. If Terraform tries to revert them back to `PLACEHOLDER_SET_BY_KURT`, `ignore_changes` is broken and Plan 20-02 will paste over Kurt's real secrets on the next apply. Do not proceed past this check until it's clean.

`venmo/handle` and `cashapp/handle` are committed String params (`"@defconrun"` / `"$defconrun"`) — the committed default IS the operational value, no override needed. If these ever need to change, edit `main.tf` and re-apply (no `ignore_changes` on those two).

## Deviations from the plan

**One narrow textual deviation, no semantic change.** The plan's Task 3 verify command was:
```
grep -c 'ignore_changes' main.tf | awk '$1 == 3 { exit 0 } { exit 1 }'
```
My first draft had two `# --- ... ignore_changes ... ---` section comments in `main.tf`, which pushed the grep count to 5 and failed the strict `== 3` check. I reworded both comments to avoid the phrase (`ignore_changes` now appears in `main.tf` ONLY inside the three actual `lifecycle { ignore_changes = [value] }` blocks). The resource semantics are unchanged; only the section comment prose differs from what a naive first-pass would have produced.

**`terragrunt` CLI not installed in this executor sandbox.** The plan's Task 1 `<done>` clause references `terragrunt hcl format --check` as proof of parseability. That binary isn't available here (`terragrunt: command not found`), so parseability is asserted via grep-based structural checks + manual review of the diff rather than the CLI check. Cloud/local runs where terragrunt is installed should re-run `terragrunt hcl format --check` on `site.hcl` before `terragrunt plan --all` to confirm; this is called out as a follow-up in the "Known issues" section below.

**Post-apply end-to-end verification (`terragrunt plan --all`, `dig`, `aws acm`, `aws ecr`, `aws ssm get-parameters`) is deferred to whoever runs the actual apply in a real AWS environment.** The plan's `<verification>` block lists 3 stages of E2E checks; those require AWS credentials + `terragrunt` and cannot run in this executor sandbox. All static/structural preconditions the plan calls out are satisfied.

## Known issues / follow-ups

1. **Terragrunt parse check pending.** Run `terragrunt hcl format --check site.hcl` from `infra/terraform/live/site/` before merging, in an environment where the CLI is installed. If it complains, fix formatting and force-push; the semantic edits are already correct.
2. **`terragrunt plan --all` drift check pending.** Post-merge, run `terragrunt plan --all` from `infra/terraform/live/site/` and confirm:
   - `region/us-east-1/ecr/` → +2 (`dc34-run-bib-nginx`, `dc34-run-bib-app`), 0 modifications.
   - `region/us-east-1/certs/` → new bib cert, 0 modifications on existing certs.
   - `region/us-east-1/cloudfront/` → 1 new distribution for `bib.defcon.run`, 0 modifications on existing distributions.
   - `region/us-east-1/bib-secrets/` → +5, 0 modifications.
   - No `services/*` drift beyond the ecr concat expansion.
3. **Placeholder-override survival check pending (real environment).** After Kurt runs the 3 put-parameter commands, one more `terragrunt plan` on `bib-secrets/` should confirm zero drift on those 3 params.
4. **Ready for Plan 20-02.** `services/run.bib/service.hcl` is valid HCL that Plan 20-02 will grow with `locals.versions`, `task`, and `service` blocks. The 5 SSM param paths exist for Plan 20-02's ECS task `secrets = [...]` block to reference via `valueFrom`.
