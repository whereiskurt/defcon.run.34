# PLAN — v1.5 Phase 22 Payments

**Workstream:** v1-5-bib
**Phase:** 22 — Payments (Stripe + Venmo/CashApp reconciliation via Haiku)
**Depends on:** Phase 21 (`Bib`/`BibReconcile` entities + `/api/bib` + auth wiring)
**Requirements:** BIB-11, BIB-12, BIB-13, BIB-14, BIB-19, BIB-20 (SC1-SC8 from ROADMAP)

## Overview

Four atomic plans across the webapp Stripe surface, the two comment-code instruction pages, the Terragrunt Lambda infrastructure, and the Node.js reconciliation handler. Plans 22-01 + 22-02 land the sync path (webapp only). Plans 22-03 + 22-04 land the async reconciliation path (Lambda + IAM + prompt).

**Total tasks:** ~15 (4/3/4/4)
**Executor gate order:** 22-01 → 22-02 → 22-03 → 22-04. Plans 22-01 and 22-02 CAN run parallel (no file overlap). Plan 22-03 blocks on 22-04's handler-code shape only for the ARN wiring; parallelizable if 22-04 stubs the handler first.

---

## Plan 22-01: Stripe Checkout Session + slider UI + webhook (sync path)

**SCs delivered:** SC1, SC2, SC6 (partial — Stripe path)
**Blocker:** requires SSM `stripe/secret_key` (`sk_test_*`) + `stripe/webhook_signing_secret` (`whsec_*`)

### Tasks

**22-01-01** — Add `stripe ^18.x` dep + `src/lib/stripe.ts` (SSM-backed singleton client)
- Add `stripe` to `apps/run.bib/webapp/package.json`; `npm install`
- New file `src/lib/stripe.ts` exports `getStripeClient()` (5-min TTL SSM cache; falls back to env var for dev)
- Gate: `tsc --noEmit` clean
- Commit: `v1.5 Phase 22-01-01: Stripe SDK dep + SSM-backed client singleton`

**22-01-02** — SponsorForm component (slider + provider picker)
- New `src/components/SponsorForm.tsx`: HeroUI-free slider (`<input type="range" min={100} max={100000} step={100}>` for $1-$1000 in $1 steps, custom-amount slider), provider radio (Stripe | Venmo | CashApp), submit button
- Client-side sends `{amount_cents, provider}` to `/api/checkout` for Stripe (returns URL to redirect); routes to `/pay/venmo` or `/pay/cashapp` for those providers (Plan 22-02)
- Amount display: `$XX.XX` formatted from cents
- Gate: `next build` clean
- Commit: `v1.5 Phase 22-01-02: SponsorForm slider + provider picker component`

**22-01-03** — Checkout API route + landing page mount
- New `src/app/api/checkout/route.ts`: `POST` — auth guard, Zod-validated body (`{amount_cents: z.number().int().min(100).max(100000), provider: z.literal("stripe")}`), calls `stripe.checkout.sessions.create({...})` with `success_url: ${BIB_PUBLIC_URL}/use1/?status=success`, `cancel_url: ${BIB_PUBLIC_URL}/use1/?status=cancel`, metadata `{owner_sub, runner_code, source: "bib"}`
- Modify `src/app/page.tsx`: mount `<SponsorForm />` below `<BibForm />`
- Server-component surfaces `?status=success|cancel` toast on redirect back
- Gate: `next build` clean; route `/api/checkout` present in build output
- Commit: `v1.5 Phase 22-01-03: /api/checkout Stripe Session route + landing page CTA mount`

**22-01-04** — Stripe webhook route + `Bib.applyPayment` helper
- Extend `src/entities/bib.ts`: export `applyPayment({ownerSub, provider, amount_cents, reconciled_via, timestamp})` using ElectroDB `.update().add({paidAmount}).append({paidStatusHistory: [{...}]})` atomically
- New `src/app/api/stripe/webhook/route.ts`: `POST` — read raw body via `req.text()`, `stripe.webhooks.constructEvent(body, sig, whsec)` for signature verify, handle `checkout.session.completed` → extract `session.metadata.owner_sub` + `session.amount_total` → `Bib.applyPayment(...)` with `reconciled_via: "stripe_webhook_${session.id}"`; return 200 on success, 400 on bad signature, 500 on entity failure (Stripe will retry)
- IMPORTANT: `runtime = "nodejs"` (not edge) in the route module — Stripe SDK needs `crypto` for signature verification
- Node.js fixture test in `apps/run.bib/webapp/src/__tests__/stripe-webhook.test.ts` for signature verify against a fake session (mock Stripe SDK)
- Gate: `next build` clean; `vitest run` — new test passes
- Commit: `v1.5 Phase 22-01-04: Stripe webhook route + Bib.applyPayment atomic mutation`

---

## Plan 22-02: Venmo + CashApp instructions pages

**SCs delivered:** SC3, SC4
**Blocker:** none — reads handles from env (SSM-backed via next.config exposure)

### Tasks

**22-02-01** — Venmo instructions page
- New `src/app/pay/venmo/page.tsx`: server-component that reads session + `getBib(session.user.id)` + handle from env `BIB_VENMO_HANDLE` (default `@defconrun`)
- Renders: "Send `$<amount>` to `<handle>` on Venmo with the comment `<runnerCode>`" — big amount + copy-to-clipboard button; link to `venmo://` deep-link with prefilled fields where supported
- 32-char cap on comment (runnerCode = 8 chars so well under)
- Gate: `next build` clean; route `/pay/venmo` present
- Commit: `v1.5 Phase 22-02-01: Venmo instructions page with handle + runnerCode`

**22-02-02** — CashApp instructions page
- New `src/app/pay/cashapp/page.tsx`: mirror Venmo page with handle `$defconrun` and `cashapp://` deep-link
- Same SSM env source (`BIB_CASHAPP_HANDLE`)
- Gate: `next build` clean; route `/pay/cashapp` present
- Commit: `v1.5 Phase 22-02-02: CashApp instructions page with handle + runnerCode`

**22-02-03** — SponsorForm handoff routing + `next.config.ts` handle env wiring
- Extend SponsorForm (from 22-01-02): on submit, if `provider === "venmo"` route to `/pay/venmo?amount_cents=X`; if `provider === "cashapp"` route to `/pay/cashapp?amount_cents=X`
- Wire `BIB_VENMO_HANDLE` and `BIB_CASHAPP_HANDLE` in `next.config.ts` env (server-only, not `NEXT_PUBLIC_*`); pass to server components
- SSM loader at cold start populates these env vars (via existing `src/lib/ssm.ts` from 22-01)
- Gate: `next build` clean; grep confirms handles read from env (not hardcoded)
- Commit: `v1.5 Phase 22-02-03: SponsorForm provider routing + SSM-backed handle env`

---

## Plan 22-03: SES → Haiku Lambda infrastructure (Terragrunt)

**SCs delivered:** SC5 (infrastructure only — code in 22-04)
**Blocker:** none for planning; executor needs AWS creds to `terragrunt plan`

### Tasks

**22-03-01** — Lambda source directory scaffold
- New `apps/run.bib/lambda/reconcile/`:
  - `package.json` with deps: `@anthropic-ai/sdk`, `mailparser`, `electrodb`, `@aws-sdk/client-dynamodb`, `@aws-sdk/client-ssm`, `@aws-sdk/client-ses`
  - `index.mjs` stub handler (imports + no-op — real logic in 22-04)
  - `prompt.js` skeleton (imports Haiku system prompt from AI-SPEC)
  - `.gitignore` for `node_modules/` at build time (packaged in zip)
- Gate: `npm ci --omit=dev` succeeds; `node -e "import('./index.mjs')"` — module loads cleanly
- Commit: `v1.5 Phase 22-03-01: reconcile Lambda scaffold (Node.js)`

**22-03-02** — Terragrunt module `bib-reconcile-lambda/v1.0.0/`
- New `infra/terraform/modules/bib-reconcile-lambda/v1.0.0/`:
  - `main.tf`: `aws_lambda_function` (runtime `nodejs20.x`, handler `index.handler`, `data "archive_file"` from `apps/run.bib/lambda/reconcile/`)
  - `iam.tf`: role + policies for S3 GetObject (`ses-inbox-dc34-use1/bib-payments/*`), DDB GetItem/UpdateItem on shared electro table, SSM GetParameter on `/dc34/secrets/use1/bib/*`, SES SendEmail from `bibpayment@run.defcon.run`
  - `main.tf`: `aws_s3_bucket_notification` on `ses-inbox-dc34-use1` filtered by `bib-payments/` prefix invoking the lambda
  - `variables.tf`, `outputs.tf`
- Gate: `terragrunt validate` (no plan yet — plan needs Lambda zip which needs 22-03-01 already built)
- Commit: `v1.5 Phase 22-03-02: bib-reconcile-lambda Terragrunt module (IAM + S3 trigger)`

**22-03-03** — Live terragrunt unit
- New `infra/terraform/live/site/services/run.bib/lambdas/reconcile/terragrunt.hcl`
- Reads shared electro table ARN + `ses-inbox-dc34-use1` bucket + SSM param ARNs from parent site vars
- Points source to `bib-reconcile-lambda/v1.0.0` module
- Gate: `terragrunt plan --non-interactive` clean (module resources listed, no drift on existing infra)
- Commit: `v1.5 Phase 22-03-03: run.bib reconcile lambda live terragrunt unit`

**22-03-04** — `BudgetCounter` DDB entity + Phase 22 infra close-out
- New `apps/run.bib/webapp/src/entities/budget-counter.ts`: `date` PK, `costUsdCents`, `invocationCount` — helpers `getBudget(date)`, `incrementBudget(date, cents)`
- Import into `entities/index.ts` for Lambda consumption
- Gate: `tsc --noEmit` clean; unit test for increment idempotence (via UpdateItem ADD)
- Commit: `v1.5 Phase 22-03-04: BudgetCounter entity for Haiku $20/day cap`

---

## Plan 22-04: Reconciliation Lambda handler (Node.js + Anthropic SDK)

**SCs delivered:** SC5 (full), SC6, SC7, SC8 (partial — nameLocked print gate in `Bib.canPrintName()` helper)
**Blocker:** requires SSM `anthropic/api_key` (`sk-ant-*`)

### Tasks

**22-04-01** — Haiku extraction with forced tool use
- Extend `apps/run.bib/lambda/reconcile/index.mjs`:
  - S3 event handler: fetch object bytes, parse via `mailparser` → `{ text, headers }`
  - Trim body to first 10k chars (token efficiency; email footers full of legal copy)
  - Call Haiku via `@anthropic-ai/sdk` messages.create with `tool_choice: {type: "tool", name: "record_payment"}`
  - Extract tool_use block → typed `{provider, amount_cents, currency, sender_display_name, comment_text, confidence, notes}`
- New `apps/run.bib/lambda/reconcile/prompt.js`: system prompt from AI-SPEC verbatim
- Fixtures at `apps/run.bib/lambda/reconcile/tests/fixtures/venmo-01.eml`, `cashapp-01.eml`, `junk-01.eml`; vitest for the extractor (mock Anthropic SDK — assert prompt shape + tool choice)
- Gate: `vitest run` — 3/3 test cases pass with mock Anthropic
- Commit: `v1.5 Phase 22-04-01: Haiku extraction with forced tool use`

**22-04-02** — Reconciliation matching
- Extend Lambda handler after extract:
  - `Bib.getByRunnerCode(comment_text.match(/BIB-[A-HJ-NP-Z2-9]{4}/)?.[0])` — primary match
  - Fallback: normalized-fuzzy match on `sender_display_name` vs any `Bib.nameOnBib` (case-insensitive contains) — best-effort, `confidence: "medium"` if match by fallback
  - On match: `Bib.applyPayment({ownerSub, provider, amount_cents, reconciled_via: "haiku_reconcile_${receiptId}"})` + `BibReconcile.updateStatus(receiptId, {status: "matched", matchedOwnerSub})`
  - On no match: `BibReconcile.updateStatus(receiptId, {status: "unmatched"})`
- Extractor idempotence: `receiptId` = hash of email Message-ID; `BibReconcile.createReconcile` uses `ConditionExpression: attribute_not_exists(receiptId)` — dup receipts return early
- vitest for match + fallback + no-match cases (in-memory entity mock)
- Gate: `vitest run` — 6/6 test cases pass
- Commit: `v1.5 Phase 22-04-02: reconciliation matching (runnerCode primary + name fallback)`

**22-04-03** — Budget cap + notification email + `Bib.canPrintName()`
- Extend Lambda handler prologue: check `BudgetCounter.getBudget(today)`; if `costUsdCents >= 2000`, skip Haiku call, `BibReconcile.updateStatus(status: "ambiguous", notes: "daily_budget_exhausted")`, send admin email, exit
- After successful Haiku call: `BudgetCounter.incrementBudget(today, 100)` (100¢ = $0.001 per invocation, conservative)
- On `status ∈ {unmatched, ambiguous}`: `SES.SendEmail` to `defcon.run@gmail.com` from `bibpayment@run.defcon.run` with body `{receipt raw excerpt + extraction + reason}`
- Extend `Bib` entity: `canPrintName()` helper — `nameLocked === true && paidAmount >= 1000`
- vitest for budget-cap short-circuit + SES notification (mock SES SDK)
- Gate: `vitest run` — 10/10 total tests pass
- Commit: `v1.5 Phase 22-04-03: $20/day budget cap + admin notification + canPrintName helper`

**22-04-04** — Phase 22 close-out gate + SUMMARY
- Update SUMMARY.md at phase directory: 4 plans / ~15 tasks; SC coverage matrix
- Grep guards: `grep -r "anthropic/api_key" apps/ infra/` — reads SSM path only; no key literal anywhere
- Terragrunt `plan --all` clean
- Empty commit with body summarizing what was NOT touched (Phase 20 SES config, Phase 21 API routes, Phase 24 flash files)
- Gate: all previous gates + `grep -r "sk_live_" apps/` → 0 hits; `grep -r "sk-ant-" apps/` → 0 hits (only SSM paths)
- Commit: `v1.5 Phase 22-04-04: Phase 22 close gate — SSM paths only, no key literals`

---

## Success Criteria Coverage

| SC | Plan / Task |
|----|-------------|
| SC1 Sponsor CTA + custom-amount slider | 22-01-02 SponsorForm |
| SC2 Stripe Checkout + webhook + amount_total | 22-01-03 + 22-01-04 |
| SC3 Venmo instructions with handle + BIB-XXXX | 22-02-01 + 22-02-03 |
| SC4 CashApp instructions with handle + BIB-XXXX | 22-02-02 + 22-02-03 |
| SC5 SES → Lambda → Haiku → BibReconcile | 22-03-01, 22-03-02, 22-03-03, 22-04-01, 22-04-02 |
| SC6 Match by runnerCode + fallback | 22-04-02 |
| SC7 Unmatched → notification email | 22-04-03 |
| SC8 canPrintName = paidAmount ≥ 1000 && nameLocked | 22-04-03 (helper); Phase 23 surfaces it in print UI |

## Blockers (stay routed to STATE.md)

- **Live Stripe (`sk_live_*`) + real Venmo/CashApp receipts E2E** — HITL for Kurt post-merge
- **SSM values from Kurt:** `sk_test_*`, `whsec_*`, `sk-ant-*`
- **run.auth redeploy** — required for `bib` OIDC client (registered in Plan 21-01-05) to take effect; fold into Phase 23 release or interim run.auth deploy

## Verification methodology

- `next build` + `tsc --noEmit` at every task boundary (both webapp + Lambda)
- `vitest run` at Lambda-code tasks (22-04-01/02/03)
- `terragrunt validate` + `terragrunt plan --non-interactive` at 22-03-03
- No live-Stripe or live-Anthropic calls in sandbox — all mocked

## Deviations expected

- Vitest scaffolded in Plan 21-03; extend to `apps/run.bib/lambda/reconcile/`
- Bump `Bib.getByRunnerCode` if not already exposed from Plan 21-02 (verify at 22-04-02 start)
