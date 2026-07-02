# Phase 22 CONTEXT — Payments (Stripe + Venmo/CashApp reconciliation via Haiku)

**Gathered:** 2026-07-02
**Status:** Ready for planning
**Depends on:** Phase 20 (SES receive rule + SSM params) + Phase 21 (Bib entity + /api/bib)

## SCs (from ROADMAP)

1. Sponsor CTA with custom-amount slider (no fixed tiers)
2. Stripe Checkout Session with webhook signature verify (`whsec_*`); on `checkout.session.completed`, `Bib.paidAmount += event.amount_total`; append `paidStatusHistory`
3. Venmo instructions page — handle from SSM + runnerCode as required comment (`BIB-XXXX`)
4. CashApp instructions page — handle from SSM + runnerCode
5. SES receives at `bibpayment@run.defcon.run` → S3 `bib-payments/` (Phase 20 landed). Lambda extracts `{amount, comment, sender_name}` via Haiku (`claude-haiku-4-5-20251001`), upserts `BibReconcile`
6. Reconciliation match — primary by `runnerCode` in comment; fallback by sender_name/email → increment `Bib.paidAmount` + append `paidStatusHistory`
7. Unmatched/ambiguous → SES email to `defcon.run@gmail.com`; `BibReconcile.status=unmatched`
8. Physical bib print gate: `paidAmount ≥ 1000 (cents) AND nameLocked=true` (Phase 23 UI surfaces the flag)

## Locked design decisions (Kurt 2026-07-02)

- **Stripe UX:** Checkout Session (redirect), NOT Elements. Dynamic price at API call time — no Stripe dashboard Products config. Slider posts `{amount_cents, currency: 'usd'}` to a Next.js API route; that route calls `stripe.checkout.sessions.create({...})` and returns the URL.
- **Handles:** default `@defconrun` (Venmo) / `$defconrun` (CashApp). SSM-overridable. Kurt may change within 24h; both handles read at request time.
- **Lambda language:** Node.js 20+ (monorepo consistency). Anthropic SDK `@anthropic-ai/sdk`.
- **Regional prefix:** `bib.defcon.run/use1/` — Next.js `basePath: /${REGION_SHORT}` already wired in Plan 21-01. All Stripe success/cancel URLs use `${BIB_PUBLIC_URL}/use1/?status={success,cancel}`.
- **BibReconcile dedupe:** email Message-ID hash → already the `receiptId` PK on the entity.
- **Haiku budget cap:** $20/day. Mechanism chosen in PLAN — proposal is in-Lambda daily counter via DDB (`BudgetCounter` entity keyed by `date`), simpler than CloudWatch alarm + reject-at-billing.

## Files this phase will touch

**New (webapp):**
- `apps/run.bib/webapp/src/components/SponsorForm.tsx` (amount slider + provider picker)
- `apps/run.bib/webapp/src/app/pay/venmo/page.tsx` (instructions)
- `apps/run.bib/webapp/src/app/pay/cashapp/page.tsx` (instructions)
- `apps/run.bib/webapp/src/app/api/checkout/route.ts` (Stripe Checkout session create)
- `apps/run.bib/webapp/src/app/api/stripe/webhook/route.ts` (signature verify + reconcile)
- `apps/run.bib/webapp/src/lib/stripe.ts` (SSM-backed Stripe client init)
- `apps/run.bib/webapp/src/lib/ssm.ts` (SSM parameter cache — 5min TTL)

**New (Lambda + infra):**
- `apps/run.bib/lambda/reconcile/` — Node.js Lambda source (index.mjs, package.json, prompt template)
- `infra/terraform/live/site/services/run.bib/lambdas/reconcile/terragrunt.hcl` (S3-trigger scoped to `bib-payments/` prefix)
- `infra/terraform/modules/bib-reconcile-lambda/v1.0.0/` (module: lambda + IAM + S3 event source)

**Modified:**
- `apps/run.bib/webapp/src/app/page.tsx` (mount SponsorForm inline)
- `apps/run.bib/webapp/package.json` (`stripe` + `@anthropic-ai/sdk` deps)
- `apps/run.bib/webapp/src/entities/bib.ts` (add `applyPayment` helper + `paidAmount` conditional bump)
- `apps/run.bib/webapp/src/entities/bib-reconcile.ts` (unstub `createReconcile` + add `updateStatus` / `attachOwner`)
- `infra/terraform/live/site/services/run.bib/service.hcl` (add lambda ecr image target reference + SSM permissions)

## Blockers / Concerns

- **[SC2/SC5 — LIVE PAYMENT VERIFICATION]:** Real Stripe live-mode + real Venmo/CashApp receipts E2E not sandbox-verifiable. Stripe TEST mode `sk_test_*` + `whsec_*` DO run in sandbox via Stripe CLI (`stripe listen` / `stripe trigger checkout.session.completed`). Live-mode HITL for Kurt post-merge.
- **[SC5 — SSM VALUES]:** Executor for Plans 22-01, 22-04 needs Kurt to load the 3 SSM secrets:
  - `/dc34/secrets/use1/bib/stripe/secret_key` (`sk_test_*`)
  - `/dc34/secrets/use1/bib/stripe/webhook_signing_secret` (`whsec_*`)
  - `/dc34/secrets/use1/bib/anthropic/api_key` (`sk-ant-*`)
- **[SC5 — Real email samples]:** No sample Venmo/CashApp receipts provided by Kurt. Public research (this CONTEXT + AI-SPEC) is best-effort. Real receipts refined post-merge via prompt iteration when actual emails hit `bibpayment@run.defcon.run`.
- **[SC7 — SES send permission]:** Lambda must have SES:SendEmail scoped to `defcon.run@gmail.com` from `bibpayment@run.defcon.run` (or the verified domain identity). Terragrunt IAM policy in the reconcile module.
- **[SC8 — nameLocked admin flag]:** `nameLocked` is admin-set (Kurt/Jesse); Phase 22 wires the print-gate logic but does NOT build the admin UI (Phase 23 or v1.6).

## Existing patterns to mirror

- SES → S3 → Lambda: `infra/terraform/modules/email/` + `infra/terraform/live/site/region/us-east-1/email/` (Phase 20 `email.hcl` already declares `bib-payment-inbound` receive rule with `object_key_prefix = "bib-payments/"` — LOAD-BEARING contract).
- Lambda module template: `infra/terraform/modules/s3-uploads-processor/v1.0.0/` (Python runtime; we swap to `nodejs20.x`).
- SSM secret access: run.human already reads `/dc34/secrets/use1/run/*` from ECS task; mirror the IAM `ssm:GetParameter` scope.
- Bib entity mutation with atomic increments: ElectroDB `update().add({ paidAmount: N })` — pattern in run.human entities.

## Out of scope (deferred)

- Admin UI for `nameLocked` toggle (Phase 23 or v1.6)
- Bib-print export/rendering pipeline (Phase 23 or v1.6)
- Crypto payment provider (v1.6+, seams ready)
- Multi-region reconciliation Lambda (v1.6 — use1 only at launch)
