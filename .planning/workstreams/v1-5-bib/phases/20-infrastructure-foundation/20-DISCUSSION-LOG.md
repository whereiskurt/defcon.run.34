# Phase 20 Discussion Log

**Workstream:** v1-5-bib
**Phase:** 20 — Infrastructure Foundation
**Date:** 2026-07-02
**Mode:** Headless / autonomous — no live user; Claude picked recommended option on every gray area.

For human audit only. Downstream agents read `20-CONTEXT.md`, not this file.

## Gray Areas Presented

Five gray areas identified in `analyze_phase`. All auto-selected (headless mode — no AskUserQuestion).

1. Region scope for Phase 20 infra
2. Plan boundaries (how to split 2 terragrunt plans)
3. SSM secret provisioning strategy
4. SES receive rule integration approach
5. `runnerCode-index` GSI — Phase 20 or later?

## Q1: Region scope — us1-only, or both-region groundwork now?

**Options considered:**
- (A) **us1 ONLY** — `service.hcl` `regions = ["us-east-1"]`. Matches ROADMAP.md contract literally.
- (B) Both-region service.hcl now, deploy use1 only — matches flash's 3-region list, less friction for Phase 23.

**Selected:** (A) us1 only.

**Reasoning:** ROADMAP.md (Kurt 2026-07-02) is explicit: "multi-region deploy is Phase 23". `REQUIREMENTS-v1.5-bib.md` mentions both regions but that doc predates the tighter design contract. Smaller surface area for Phase 20 review.

**Notes:** Flagged as the highest-impact decision to override if Kurt disagrees. Would touch every `regions = [...]` list in the phase and cascade to ACM, CloudFront, ECR, SSM units.

## Q2: Plan split — how to slice 2 terragrunt plans?

**Options considered:**
- (A) **Plan 1 = routable + secret surface; Plan 2 = service + data surface.**
- (B) Plan 1 = site.hcl + ECR + SSM; Plan 2 = ECS service.hcl + SES + entities.
- (C) 3-way split (DNS+CF / SSM+SES / ECS+DDB).

**Selected:** (A).

**Reasoning:** Clean risk boundary — Plan 1 is boilerplate that pattern-matches flash and lands fast; Plan 2 concentrates the actually-new work (GSI on hot shared table, new SES rule, service definition) for careful review. Rejected (C) as artificial: SSM placeholders are trivial and don't deserve their own plan.

## Q3: SSM secret provisioning — how to handle Kurt-provided values?

**Options considered:**
- (A) Terraform creates with placeholder values, no ignore_changes.
- (B) `data.aws_ssm_parameter` reference-only; Kurt creates first via CLI.
- (C) **Terraform creates with placeholder + `lifecycle { ignore_changes = [value] }`.**

**Selected:** (C).

**Reasoning:** (B) has chicken-and-egg risk — ECS task's `secrets` block can't resolve on first apply if the param doesn't exist. (A) would clobber Kurt's real values on next TF apply. (C) is the canonical AWS pattern for secrets that live outside TF state: parameter always exists, TF never touches the value after initial write. Also decided to skip placeholder for venmo/cashapp handles since their defaults (`@defconrun` / `$defconrun`) are the actual operational values.

## Q4: SES receive rule — how to integrate with existing SES infra?

**Options considered:**
- (A) Append to existing SES receipt rule set for `run.defcon.run` zone (single active rule set, new rule).
- (B) **Same rule set + new dedicated rule name + dedicated S3 prefix `bib-payments/`.** (Practically the same as A but explicit about prefix.)
- (C) Separate rule set.

**Selected:** (B).

**Reasoning:** SES caps ACTIVE receipt rule sets at 1 per region — (C) would break existing mail delivery. Dedicated S3 prefix isolates bib-payment objects so Phase 22's Lambda S3 event trigger can filter cleanly.

## Q5: `runnerCode-index` GSI — Phase 20 or Phase 21/22?

**Options considered:**
- (A) Add IAM/env wiring only in Phase 20; GSI added later.
- (B) **Add GSI in Phase 20 (Plan 2) on the shared `run-human-electro` table. Projection: ALL. Entity classes still Phase 21 code.**
- (C) Stub ElectroDB entity files in Phase 20 too.

**Selected:** (B).

**Reasoning:** GSI is DDB-table-level infrastructure — belongs in the infra phase. Adding it in a controlled infra PR (with `terragrunt plan` visibility) is safer than sneaking it into an app-code PR in Phase 21. `run-human-electro` is a hot shared table, so review discipline matters. ALL projection prevents wasteful follow-up GetItems from the Phase 22 Haiku Lambda.

**Concern noted:** Additive-only diff on shared table MUST be verified. Any accidental change to existing primary key or existing GSI would be catastrophic. Called out in CONTEXT.md as a planner obligation.

## Deferred Ideas (Noted for Later)

Captured in CONTEXT.md `## Deferred to Later Phases`:

- cac1 multi-region → Phase 23
- ElectroDB entity classes → Phase 21
- OIDC client registration in run.auth → Phase 21
- Auth.js middleware + config copy → Phase 21
- Haiku Lambda → Phase 22
- Stripe webhook + payment intent → Phase 22
- Build/deploy pipeline edits → Phase 23
- Bib SVG template + branding → Phase 21 (UI) + Phase 23 (deploy verify)

## Contract Doc Reconciliation

Discovered mid-analysis: `REQUIREMENTS-v1.5-bib.md` (2026-07-01) and `ROADMAP.md` (Kurt 2026-07-02) disagree on several load-bearing items (regions, payment providers, tier vs slider, size field, name-lock gate). Written a conflict-resolution table into CONTEXT.md declaring ROADMAP.md authoritative. Recorded here so a reviewer can spot-check that call.

## Claude's Discretion / Autonomous Notes

- No human input; every option was a Claude judgement call.
- All 5 auto-selections chose the "roadmap-conservative" option (i.e., the option that requires the fewest speculative extensions beyond what ROADMAP.md explicitly says).
- Highest-risk auto-decision: #1 (region scope) — flagged in CONTEXT.md.
- Second-highest: #5 (GSI provisioning in Phase 20) — flagged as needing additive-only verification.
