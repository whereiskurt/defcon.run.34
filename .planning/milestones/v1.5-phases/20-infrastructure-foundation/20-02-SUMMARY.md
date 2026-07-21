# Plan 20-02 — Bib Service, Data, and Payment-Ingest Surface

**Summary:** Wired the run.bib ECS task+service (nginx + Next.js app, us-east-1 only), added the `runnerCode-index` GSI to the shared `run-human-electro` table, and appended an s3-only SES receive rule for `bibpayment@run.defcon.run` — completing the Phase 20 success criteria on top of Plan 20-01's routable + secret surface.

## Tasks Completed

| # | Task | Commit |
|---|------|--------|
| 1 | Expand `services/run.bib/service.hcl` with task + service blocks | `b8c3fbc3` |
| 2 | Wire run.bib into `site.hcl` ecs_tasks / ecs_services concat | `bebb1ea4` |
| 3 | Add `runnerCode-index` GSI to run-human-electro | `84e9395a` |
| 4 | Append s3-only SES receive rule for bibpayment@ | `175ca22a` |

## Deviations from Plan

- **Task 3 required a shared-module extension.** The dynamodb module's `table_type = "electro"` path previously ignored per-table `attributes` / `global_secondary_indexes` inputs (it substituted the fixed electro schema). The GSI could not be declared additively as the plan described without changing the module. Fix: the module now concats per-table extras on top of the base schema. Non-breaking: default values are `[]`, so every non-bib table plans identically. The change lives at `infra/terraform/modules/dynamodb/v1.0.0/main.tf`.
- **Task 4 required a shared-module extension.** The email module only supported `fwd_rules` (chained S3 + Lambda forwarding). There was no way to declare an s3-only receive rule with a caller-controlled `object_key_prefix` — which the Phase 22 Haiku Lambda depends on. Fix: added a new `receive_rules` input (`receive.tf` + `variables.tf`) and wired it through `config.hcl` from region-level `email.hcl`. Also non-breaking (default `[]`).
- **`versions` block uses `try(file(...), "0.0.0")` fallback** — as the plan specified — because Phase 23 owns the VERSION.* files. Existing services (flash, run-human) still use the strict `trimspace(file(...))` form; only bib uses the fallback so Plan 20-02 doesn't require Phase 23 artifacts.
- **`terragrunt plan` verification not performed.** The task descriptions ask for local `terragrunt plan` runs (against DDB and email units) to confirm additive-only diffs. This sandbox environment does not have AWS credentials or backend access to run those plans; the code-level review confirms additive semantics (extras concat onto empty defaults; new SES rule is a distinct `for_each` entry alongside `aws_ses_receipt_rule.forwarding`).

## Follow-ups for Phase 21

- **OIDC client provisioning.** `service.hcl` references `/dc34/secrets/use1/bib/client_id` and `/dc34/secrets/use1/bib/client_secret`. These paths are stable but the parameters themselves are not yet provisioned — Phase 21 must register bib as an OIDC client via the shared secrets module (add a `bib` entry to `site.hcl` `local.secrets.definitions`) before the run.bib task can start.

## Files Modified

- `infra/terraform/live/site/services/run.bib/service.hcl` — added `versions`, `task`, `service` (kept `ecr_repositories` from Plan 20-01)
- `infra/terraform/live/site/site.hcl` — bib.locals.task + bib.locals.service appended to concat lists
- `infra/terraform/live/site/services/run.human/service.hcl` — `runnerCode-index` GSI + `runnerCode` attribute on run-human-electro
- `infra/terraform/modules/dynamodb/v1.0.0/main.tf` — merge per-table extras onto base schema (non-breaking)
- `infra/terraform/modules/email/v1.0.0/variables.tf` — new `receive_rules` input
- `infra/terraform/modules/email/v1.0.0/receive.tf` (new) — s3-only receipt rule resource
- `infra/terraform/modules/email/config.hcl` — wire `receive_rules` from region-level `email.hcl`
- `infra/terraform/live/site/region/us-east-1/email/email.hcl` — one `bibpayment@run.defcon.run` → `bib-payments/` rule

## Known Issues

- None functionally. The two module extensions (dynamodb GSI concat + email `receive_rules`) touch shared abstractions and warrant careful review during any Phase 20 ultra-review — the diffs are small and default-preserving, but they are the highest-risk surfaces in this plan.
