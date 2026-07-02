# Phase 20 Context: Infrastructure Foundation

**Workstream:** v1-5-bib
**Captured:** 2026-07-02
**Mode:** Headless / autonomous — Claude picked recommended option for each gray area (no user-in-the-loop).

## Domain

All AWS infrastructure required by `bib.defcon.run` provisioned and reachable in **`us-east-1` only** for launch. This phase produces:

- `bib` subdomain (DNS + ACM cert + CloudFront distribution)
- ECR repositories for the two container images
- ECS service definition (`services/run.bib/service.hcl`), read by `site.hcl` via `read_terragrunt_config`
- SSM parameters for the five bib secrets (encrypted with `alias/dc34-ssm-use1`)
- Shared `run-human-electro` DynamoDB table access (new `runnerCode-index` GSI added; entity classes are Phase 21 code)
- SES receipt rule for `bibpayment@run.defcon.run` → `s3://ses-inbox-dc34-use1/bib-payments/`

**What this phase is NOT:**
- No Next.js app code (Phase 21)
- No payment integration or Haiku Lambda (Phase 22)
- No `ca-central-1` deploy (deferred; roadmap says Phase 23 can promote to multi-region post-launch)
- No ElectroDB entity class definitions — those are TypeScript in `apps/run.bib/` (Phase 21)

## Prior Decisions (carried in)

**From `ROADMAP.md` design contract (Kurt 2026-07-02) — locked, do not re-open:**

- Single-region launch (`us-east-1` only). Multi-region deferred to Phase 23 or later.
- Two-container ECS Fargate pattern mirroring `run.flash` (nginx + Next.js app).
- Shared DynamoDB table `run-human-electro` — NO new table.
- SSM param namespace: `/dc34/secrets/use1/bib/...`.
- SES landing address: `bibpayment@run.defcon.run` (already-provisioned run.defcon.run zone).
- OIDC pattern mirrors `run.gpx` (cookie/claim renamed to `bib`); infra side registers a new OIDC client, code side is Phase 21.

**Contract-doc conflict resolution:**

`REQUIREMENTS-v1.5-bib.md` (2026-07-01) predates the tighter design contract in `ROADMAP.md` (Kurt 2026-07-02). Where they conflict, **ROADMAP.md wins**:

| Topic | REQUIREMENTS-v1.5-bib.md (stale) | ROADMAP.md (authoritative) |
|-------|----------------------------------|----------------------------|
| Regions at launch | use1 + cac1 | **use1 only** |
| Payment providers | Stripe + PayPal/Venmo | **Stripe + Venmo/CashApp (Haiku-reconciled) + no PayPal** |
| Amount UI | Fixed tiers $10/$20/$50/$500 | **Custom-amount slider** |
| Bib sizes | field exists | **field does NOT exist** |
| Name-on-print gate | $10+ tier | **paidAmount ≥ $10 AND admin lock fired** |

Anywhere downstream planning/research cites REQUIREMENTS-v1.5-bib.md, cross-check against ROADMAP.md and prefer the roadmap.

## Gray-Area Decisions

### 1. Region scope — `us-east-1` only

**Decision:** `service.hcl` for `run.bib` declares `regions = ["us-east-1"]` (single-element list). ECR repos, ACM cert, CloudFront distribution, SSM params, and SES receipt rule are all use1-only.

**Why:** ROADMAP.md is explicit ("multi-region deploy is Phase 23"). Adding cac1 now creates surface area (extra ECR pushes, extra ACM cert validation, extra CloudFront origin, extra SSM writes) that we would have to disable or work around before Phase 23 anyway. Smaller diff = smaller review = faster ship.

**Rejected:** Both-region service.hcl now with deploy toggled to use1. Sounds like less work later, but every mirror-of-flash decision that includes cac1 (like the `read_terragrunt_config` in `region/ca-central-1/`) becomes noise on Phase 20 review.

**How this constrains planning:** When mirroring `run.flash/service.hcl`, the researcher/planner MUST drop `"ca-central-1"` and `"ap-southeast-1"` from every `regions = [...]` list inside `run.bib/service.hcl`. Flash's list is `["us-east-1", "ca-central-1", "ap-southeast-1"]`; bib's is `["us-east-1"]` for Phase 20.

### 2. Plan boundaries — 2 terragrunt plans, split "static infra" from "service + data"

**Decision:** Phase 20 becomes exactly 2 plans as the roadmap predicts:

- **Plan 1 — Routable + secret surface:** `site.hcl` edits (add `bib` to `dns.subdomains`), ACM cert, CloudFront distribution, ECR repos (`dc34-run-bib-nginx`, `dc34-run-bib-app`), the five SSM parameters with placeholder values + `ignore_changes = [value]`.
- **Plan 2 — Service + data surface:** `services/run.bib/service.hcl` (two-container ECS task, ALB, service discovery), `site.hcl` `service_conf.bib = read_terragrunt_config(...)`, `runnerCode-index` GSI on shared `run-human-electro` table, SES receipt rule for `bibpayment@run.defcon.run` with S3 prefix `bib-payments/`.

**Why:** Plan 1 is mostly boilerplate (cert + CF + ECR + subdomain + placeholder SSM) — reviewer can pattern-match against the flash setup and land quickly. Plan 2 is the actually-new bits (GSI mutation on a hot shared table + new SES rule + service.hcl) which needs careful review. Splitting isolates risk.

**Rejected:** Single mega-plan. Would land unreviewably wide. Also rejected: 3-way split (DNS+CF / SSM+SES / ECS+DDB) — SSM placeholders are trivial and belong bundled with the other boilerplate; artificial split adds churn.

**How this constrains planning:** Two `PLAN-*.md` files inside `phases/20-infrastructure-foundation/plans/`. Plan 1 must be mergeable independently (nothing in Plan 2 depends on Plan 1 being deployed, only on Plan 1 being defined). Plan 2 depends on Plan 1's ECR repo names and SSM param paths existing.

### 3. SSM secret provisioning — Terraform creates with placeholder + `ignore_changes = [value]`

**Decision:** Terraform declares all five SSM parameters:

- `/dc34/secrets/use1/bib/stripe/secret_key`
- `/dc34/secrets/use1/bib/stripe/webhook_signing_secret`
- `/dc34/secrets/use1/bib/venmo/handle` (default value: `@defconrun`)
- `/dc34/secrets/use1/bib/cashapp/handle` (default value: `$defconrun`)
- `/dc34/secrets/use1/bib/anthropic/api_key`

`stripe/*` and `anthropic/api_key` created as `SecureString` with placeholder value `PLACEHOLDER_SET_BY_KURT` and `lifecycle { ignore_changes = [value] }`. Kurt runs the `aws ssm put-parameter --overwrite` command from 2026-07-02 to set real values; TF never clobbers them.

`venmo/handle` and `cashapp/handle` created as `String` with the real default values (`@defconrun`, `$defconrun`) — no ignore_changes on those, since the default IS the operational value until Kurt overrides it via SSM.

**Why:** Standard AWS pattern for secrets that live outside TF state. Guarantees `terragrunt plan` is clean after Kurt sets real values. Public handles (venmo/cashapp) don't need placeholders — their defaults are correct.

**Rejected:** `data.aws_ssm_parameter` reference-only (Kurt creates via CLI first) — creates a chicken-and-egg where the ECS task's `secrets` block can't resolve on first apply. Placeholder-then-override always works.

**How this constrains planning:** ECS task `secrets` block in `service.hcl` references all five SSM paths. Plan 1 provisions the parameters BEFORE Plan 2's ECS task tries to consume them. Kurt's `aws ssm put-parameter --overwrite` step is a documented post-Plan-1 handoff — capture it in the plan's operator-handoff section.

### 4. SES receive rule — new rule in the existing rule set, dedicated S3 prefix

**Decision:** Add ONE new `aws_ses_receipt_rule` to the existing SES receipt rule set for the `run.defcon.run` zone (already provisioned in `region/us-east-1/email/`). Rule matches `bibpayment@run.defcon.run`, S3 action → existing `ses-inbox-dc34-use1` bucket with object key prefix `bib-payments/`.

**Why:** The SES receipt rule set for `run.defcon.run` already exists (routes admin@, other addresses). Reusing it avoids a second rule set (SES allows only one ACTIVE rule set per region). Dedicated prefix `bib-payments/` isolates this workflow's objects so the Phase 22 Lambda's S3 event trigger can scope to that prefix without disturbing other consumers.

**Rejected:** Separate rule set — SES caps active rule sets at 1/region, so this would break existing mail. Also rejected: same prefix as other receive traffic — makes the Phase 22 Lambda's event filter fragile.

**How this constrains planning:** Plan 2's SES rule must be added AT THE END of the existing rule set's `rules` list (SES evaluates in order; append is safest). Object prefix `bib-payments/` is a load-bearing contract — Phase 22's Lambda S3 trigger MUST filter on this prefix.

### 5. DDB `runnerCode-index` GSI — added in Phase 20, entities defined in Phase 21

**Decision:** Phase 20 (Plan 2) adds a Global Secondary Index named `runnerCode-index` to the shared `run-human-electro` table, keyed on `runnerCode` (Hash, String). Projection: `ALL` (Haiku Lambda needs the whole item to update paidAmount, so KEYS_ONLY forces a follow-up GetItem — waste).

ElectroDB entity CLASSES (`Bib`, `BibReconcile`) are NOT written in Phase 20. Their TypeScript definitions are Phase 21 code; they will point at the table + GSI provisioned here.

**Why:** GSI creation is DDB-table-level infra (Terraform-managed), so it belongs in the infrastructure phase. It's a hot shared table (`run-human-electro` is used by run.human), so provisioning the GSI in a controlled infra phase (with plan/apply visibility) prevents surprise index-creation during app deploy. ALL projection is cheaper long-term than KEYS_ONLY plus a follow-up read on every reconcile event.

**Rejected:** Deferring GSI to Phase 21 (app phase). Would blur the "infra done" line and put a table mutation inside an app-code PR — bad reviewability.

**How this constrains planning:** Plan 2 modifies the shared DDB terragrunt unit (`region/us-east-1/dynamodb/` or wherever `run-human-electro` lives). GSI additions are online in DynamoDB but take time to backfill (empty table, so instant here). Plan 2 must NOT alter the existing primary key or any existing GSI on `run-human-electro` — additive only. Planners MUST verify additive-only diff on the DDB unit's `terragrunt plan`.

## Canonical Refs

These MUST be read by downstream researcher/planner/executor agents.

**Design & requirements:**
- `.planning/workstreams/v1-5-bib/ROADMAP.md` — **authoritative design contract from Kurt 2026-07-02**. Read this FIRST. Supersedes REQUIREMENTS-v1.5-bib.md where they conflict.
- `.planning/workstreams/v1-5-bib/STATE.md` — current workstream state + Kurt-provided SSM values status.
- `.planning/REQUIREMENTS-v1.5-bib.md` — original requirements (2026-07-01). **Partially superseded** by ROADMAP.md. See "Contract-doc conflict resolution" table above.

**Pattern to mirror:**
- `infra/terraform/live/site/services/run.flash/service.hcl` — two-container ECS + ALB pattern. Bib mirrors this structure but with `regions = ["us-east-1"]` (single-region), bib-specific env vars, bib-specific SSM secret refs, and no MQTT/flash-specific bits.
- `infra/terraform/live/site/services/run.human/service.hcl` — DDB env wiring pattern (SSM refs for `access_key_id` / `secret_access_key` / `table_name` under `/dc34/dynamodb/use1/run-human-electro/*`; `dynamodb_table_ref = "run-human-electro"`).
- `infra/terraform/live/site/services/run.gpx/service.hcl` — auth cookie/claim pattern (Phase 21 code mirrors this, but service.hcl env wiring for `AUTH_*` vars is set here in Phase 20).

**Infra hooks (edit points):**
- `infra/terraform/live/site/site.hcl` — add `bib` to `dns.subdomains` (line ~24) and `service_conf.bib = read_terragrunt_config("./services/run.bib/service.hcl")` (line ~59).
- `infra/terraform/live/site/region/us-east-1/email/` — existing SES receipt rule set for `run.defcon.run` zone; new bib receipt rule appended here.
- `infra/terraform/live/site/region/us-east-1/secrets/` — pattern for provisioning SSM parameters (mirror the placeholder+ignore_changes approach).
- `infra/terraform/live/site/region/us-east-1/dynamodb/` — shared `run-human-electro` table definition; `runnerCode-index` GSI added here.
- `infra/terraform/live/site/region/us-east-1/ecr/` — ECR repo provisioning pattern.
- `infra/terraform/live/site/region/us-east-1/certs/` and `region/us-east-1/cloudfront/` — ACM + CloudFront patterns for `flash.defcon.run` to mirror.

**Reference (not a modify point in Phase 20):**
- `apps/run.flash/` — will be mirrored in Phase 21 for the app scaffold; nothing in Phase 20 touches `apps/`.

**External:**
- Anthropic SSM param path `/dc34/secrets/use1/bib/anthropic/api_key` — Kurt sets `sk-ant-*` post-Plan-1 apply.
- Stripe SSM params — Kurt sets `sk_test_*` and `whsec_*` post-Plan-1 apply.

## Deferred to Later Phases

Captured to prevent scope creep in Phase 20:

- `ca-central-1` region → Phase 23 (or later)
- ElectroDB `Bib` + `BibReconcile` entity class definitions (TypeScript) → Phase 21
- OIDC client registration in `run.auth` (`config/oidc.ts`) → Phase 21 (paired with the app scaffold)
- Auth.js `config/auth.ts` + `middleware.ts` copy from `run.gpx` → Phase 21
- Haiku Lambda for SES email parsing → Phase 22
- Stripe webhook route + payment intent flow → Phase 22
- `apps/build.sh` / `deploy.sh` / `release-all.sh` / `buildpub.yml` / `deploy.yml` edits → Phase 23
- DC34 bib SVG template + branding → Phase 21 (UI) and Phase 23 (deploy verification)

## Acceptance for Phase 20 (matches ROADMAP.md Success Criteria)

Downstream planning must satisfy all 6:

1. `bib` present in `site.hcl` `dns.subdomains`; ACM cert + CloudFront distribution for `bib.defcon.run` resolve in `use1`.
2. ECR repositories `dc34-run-bib-nginx` and `dc34-run-bib-app` exist in `us-east-1` and accept image pushes.
3. `services/run.bib/service.hcl` defines a two-container (nginx + app) ECS task and ALB `load_balancer`, read by `site.hcl` via `read_terragrunt_config`, and `terragrunt plan` is clean for existing services.
4. SSM parameters exist for the five bib secrets (all `SecureString` for stripe/anthropic, `String` for venmo/cashapp handles), encrypted with `alias/dc34-ssm-use1` where applicable.
5. Bib reuses the shared `run-human-electro` DynamoDB table (no new table) with the new `runnerCode-index` GSI. Access confirmed via env wiring in `service.hcl` (SSM refs for `access_key_id` / `secret_access_key` / `table_name`).
6. New SES receive rule for `bibpayment@run.defcon.run` writes to `ses-inbox-dc34-use1` with object-key prefix `bib-payments/`.

## Autonomous-Mode Notes

Recorded so a human reviewer can spot-check my calls:

- All five gray-area decisions above were picked WITHOUT user input (headless mode). If Kurt disagrees with any, most impactful override is #1 (regions) since it changes the surface area of both plans. Second most impactful is #5 (GSI in Phase 20 vs deferred).
- No advisor mode used (`USER-PROFILE.md` not required; Kurt is technical).
- No spike/sketch findings existed to fold in.
- No prior CONTEXT.md in this workstream (first phase of v1.5).
