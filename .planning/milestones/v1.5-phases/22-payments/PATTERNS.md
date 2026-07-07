# PATTERNS — v1.5 Phase 22 Payments

Maps each planned Phase 22 file to its closest existing analog in the monorepo.

## Webapp — Stripe + Provider Instructions

| Planned file | Closest analog | Rationale |
|---|---|---|
| `apps/run.bib/webapp/src/components/SponsorForm.tsx` (amount slider + provider picker) | `apps/run.bib/webapp/src/components/BibForm.tsx` (Plan 21-03) | Same debounced-state + controlled-input pattern; slider replaces text input; provider picker is a simple radio |
| `apps/run.bib/webapp/src/lib/stripe.ts` (SSM-backed Stripe client init) | `apps/run.bib/webapp/src/entities/client.ts` (Plan 21-02 — reads env once at module load) | Same singleton init + env-first-then-SSM pattern; add 5-min in-memory TTL for SSM lookups |
| `apps/run.bib/webapp/src/lib/ssm.ts` (SSM parameter cache) | `apps/run.human/webapp/src/lib/` (any SSM helper — look for `AWS.SSM` import) | Establishes the shared SSM cache convention across bib services (webapp + lambda both use it) |
| `apps/run.bib/webapp/src/app/api/checkout/route.ts` (POST → Stripe Checkout Session URL) | `apps/run.bib/webapp/src/app/api/bib/route.ts` (Plan 21-02 — Zod-validated POST body + auth() session guard) | Same auth-guard + Zod body validation + JSON response pattern; replaces DDB call with `stripe.checkout.sessions.create` |
| `apps/run.bib/webapp/src/app/api/stripe/webhook/route.ts` (POST → signature verify → reconcile) | `apps/run.bib/webapp/src/app/api/bib/route.ts` structurally | New shape: **no auth session** (Stripe signs the request instead — verify via `whsec_*`); reads raw body for signature check; mutates `Bib.paidAmount` on `checkout.session.completed` |
| `apps/run.bib/webapp/src/app/pay/venmo/page.tsx` + `.../pay/cashapp/page.tsx` (instructions) | `apps/run.bib/webapp/src/app/page.tsx` (Plan 21-03 — server-component that reads session + entity) | Server-component that reads session, fetches `getBib(session.user.id)`, renders handle from SSM env + `runnerCode` QR-friendly text |

## Lambda + Infra — SES → Haiku → DDB

| Planned file | Closest analog | Rationale |
|---|---|---|
| `apps/run.bib/lambda/reconcile/index.mjs` (Node handler) | `infra/terraform/live/site/region/us-east-1/email/lambdas/email-forwarder/index.py` | Same "SES-written S3 object → parse email → act" shape; different runtime (Node.js 20 instead of Python 3.12) and different downstream (Haiku extract + DDB upsert instead of SES forward) |
| `apps/run.bib/lambda/reconcile/package.json` | `apps/run.bib/webapp/package.json` (Plan 21-01) | Node.js dep pinning + `npm ci` pattern; but exclude webapp-only deps (react, next) — Lambda only needs `@anthropic-ai/sdk`, `mailparser`, `@aws-sdk/client-dynamodb`, `@aws-sdk/client-ssm`, `@aws-sdk/client-ses`, `electrodb` |
| `apps/run.bib/lambda/reconcile/prompt.js` (Haiku system prompt) | (new — no analog in repo) | Standalone module so prompt iteration doesn't churn the handler |
| `infra/terraform/live/site/services/run.bib/lambdas/reconcile/terragrunt.hcl` | (need to inspect run.human/lambdas/on-process — same shape) | Terragrunt unit configuring the module; declares source_path, IAM scopes, S3 event source |
| `infra/terraform/modules/bib-reconcile-lambda/v1.0.0/main.tf` | `infra/terraform/modules/s3-uploads-processor/v1.0.0/lambda-process.tf` | Same `data "archive_file"` + `aws_lambda_function` + `aws_lambda_permission` + `aws_s3_bucket_notification` shape; runtime swaps to `nodejs20.x` |
| `infra/terraform/modules/bib-reconcile-lambda/v1.0.0/iam.tf` | `infra/terraform/modules/s3-uploads-processor/v1.0.0/iam.tf` | IAM role + policies for S3 GetObject + DDB UpdateItem + SSM GetParameter + SES SendEmail — same policy-doc pattern |

## Entity extensions

| Planned change | Existing entity | Rationale |
|---|---|---|
| `Bib.applyPayment({provider, amount_cents, reconciled_via})` helper | `apps/run.bib/webapp/src/entities/bib.ts` (Plan 21-02) | Atomic ElectroDB `.update().add({paidAmount: N}).append({paidStatusHistory: [{...}]})` — used by both Stripe webhook route AND the reconcile Lambda |
| `BibReconcile.createReconcile` unstub + `updateStatus(receiptId, {status, matchedOwnerSub})` + `attachOwner(receiptId, ownerSub)` | `apps/run.bib/webapp/src/entities/bib-reconcile.ts` (Plan 21-02) | Complete the stubs; expose from `entities/index.ts` for Lambda import |
| New `BudgetCounter` entity — `date` PK, `costUsdCents`, `invocationCount` | Follow existing `Bib` entity shape | Simple daily-rollup entity for Haiku $20/day cap |

## Naming / config conventions

- Lambda function name: `bib-reconcile-{site.label}-{region.label}` (mirror `processor-{site}-{key}-{region}` pattern)
- IAM role: `bib-reconcile-lambda-{site.label}-{region.label}`
- SSM cache TTL: 5 min (matches typical ECS task lifetime)
- Stripe SDK version: `stripe ^18.x` (latest stable Sept 2025)
- mailparser version: `mailparser ^3.x`
- Anthropic SDK version: `@anthropic-ai/sdk ^0.24.x` (has `messages.create` with tools; verify latest at plan time)

## No-Go patterns

- **Do NOT** use `useState` in the Stripe webhook route — it's a server route; sync-only handler
- **Do NOT** proxy Stripe API via a client-side call — session create MUST be server-side (raw `sk_test_*` never enters browser)
- **Do NOT** parse SES-forwarded emails from the raw S3 MIME manually — use `mailparser`
- **Do NOT** log the Anthropic API key or Stripe secret at any level. Use `redact()` on structured logs
- **Do NOT** invent test data in prod code paths — fixtures live in `apps/run.bib/lambda/reconcile/tests/fixtures/`
