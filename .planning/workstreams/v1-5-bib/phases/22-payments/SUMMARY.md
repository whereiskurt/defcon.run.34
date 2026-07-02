# Phase 22 Execution Summary

**Branch:** `gsd/v1.5-wave-22-03` (Plan 22-03 only — other plans on separate branches)
**Base:** `origin/main @ 1a37ca4a` (Phase 22 planning PR #239 merged)

## Plan 22-03 — SES → Haiku Lambda infrastructure

**Executed:** 2026-07-02
**Result:** 4/4 tasks complete; local gates pass; terragrunt gate deferred to HITL

### Commits

| Task | Hash | Subject |
|------|------|---------|
| 22-03-1 | `4b40aa34` | reconcile Lambda scaffold (Node.js 22) |
| 22-03-2 | `dc259a3d` | bib-reconcile-lambda Terragrunt module (IAM + S3 trigger) |
| 22-03-3 | `a43cf791` | run.bib reconcile lambda live terragrunt unit |
| 22-03-4 | `6e7af249` | BudgetCounter entity for $20/day cap |

### Gates

- `apps/run.bib/lambda/reconcile/`: `npm install` (150 pkg / 0 vuln), `npm ci --omit=dev` (21 pkg), vitest 6/6, module import resolves
- `apps/run.bib/webapp/`: `tsc --noEmit` exit 0, `next build` 7 pages, vitest 18/18 (12 new BudgetCounter + 6 existing runner-code)
- `infra/`: terragrunt/terraform binaries not available in sandbox — static syntax balance verified; `plan --non-interactive` deferred to HITL

### Deviations (all in commit bodies)

1. **[Rule 3]** Terragrunt live-unit path moved from `services/run.bib/lambdas/reconcile/` to `region/us-east-1/bib-reconcile/` — plan path outside `region.hcl` parent chain so `find_in_parent_folders("region.hcl")` couldn't resolve `region.label`. All existing regional units live under `region/us-east-1/`.
2. **[Rule 2]** `reserved_concurrent_executions = 5` — spam-forward burst can't blow the $20/day Haiku cap before the DDB counter commits.
3. **[Rule 2]** IAM `SES:SendEmail` bounded by `ses:FromAddress` + `ForAllValues:StringEquals ses:Recipients` conditions to prevent outbound-spam abuse.
4. **[Rule 2]** KMS `Decrypt` gated by `kms:EncryptionContext:PARAMETER_ARN` so the role decrypts ONLY the Anthropic API key, not any other SecureString under the same alias.
5. **[Rule 3]** Anthropic SDK pinned at `^0.24.3` (PATTERNS.md wrote `^0.24.x`).

### Outstanding HITL items

1. **Terragrunt plan/apply** against real AWS — Kurt's workstation runs `terragrunt validate` + `terragrunt plan --non-interactive` in `infra/terraform/live/site/region/us-east-1/bib-reconcile/`
2. **`npm ci --omit=dev` in the Lambda source** before Terragrunt plan/apply — caller runs it inside `apps/run.bib/lambda/reconcile/` so `node_modules/` is present in the zipped archive
3. **Reserved concurrency = 5** — if realistic Venmo/CashApp forwarding volume trips throttling, bump via `extra_environment` or open a v1.1.0 module

### Blockers for downstream plans

- **Plan 22-01** (Stripe): SSM `stripe/secret_key` needed — Kurt has the pre-filled commands
- **Plan 22-02** (Venmo/CashApp pages): depends on 22-01 SponsorForm; SSM handles overridable
- **Plan 22-04** (Haiku extraction + matcher): scaffolds ready from this plan; needs `checkBudget()` + `incrementBudget()` wired from BudgetCounter entity; Kurt loaded Anthropic key so real API sanity-check works

### Phase 22 progress

1/4 plans complete. Plans 22-01, 22-02, 22-04 to follow.
