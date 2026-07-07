# Phase 23 Context — Build/Deploy + Branding

**Gathered:** 2026-07-02
**Status:** Ready to plan
**Directive:** Kurt 2026-07-02 — "less HITL, you go hard."

## Phase Boundary

Ship v1.5 end-to-end. `bib.defcon.run/use1/` serves the defcon.run-branded registration app from real AWS. Every user-facing surface (bib registration, sponsor, general donate, admin report) is reachable behind CloudFront. The Haiku Lambda is live and consuming SES receipts. run.auth is redeployed with the `bib` OIDC client active.

## Success Criteria

Original ROADMAP §Phase 23 SCs, updated for Kurt's 2026-07-02 rescope:

1. `apps/build.sh` + `apps/deploy.sh` + `apps/release-all.sh` accept `run.bib` — **ALREADY DONE in #230** (Plan 22 prep CI wiring).
2. `.github/workflows/buildpub.yml` + `deploy.yml` include `run.bib` — **ALREADY DONE in #230**.
3. **New (autonomous):** `bib.defcon.run/use1/` serves the defcon.run-branded registration app in `use1`, reachable via HTTPS, `/api/health` returns 200.
4. **New (autonomous):** run.auth redeployed so the `bib` OIDC client from Plan 21-01-05 is active (login flow → run.bib callback works, not 404).
5. **New (autonomous):** `bib-reconcile-lambda` deployed to `us-east-1` with SES S3 trigger armed against `bib-payments/` prefix.
6. **New (autonomous):** All SSM params populated + audited (Stripe test key, whsec, Anthropic key, admin allowlist, Venmo/CashApp handles). SSM audit passes.
7. **HITL (Kurt):** User-facing E2E — sign in → register → sponsor Stripe test → paidAmount updates → sponsor charm renders.
8. **HITL (Kurt):** Real Venmo/CashApp receipt forwarded to `bibpayment@run.defcon.run` → Lambda extraction succeeds → BibReconcile row + Bib.paidAmount update.

## Autonomous vs HITL split

**Autonomous (drive from sandbox):**
- Terragrunt plan/apply on new units — WHEN AWS creds work (Kurt getting them set up)
- Trigger `workflow_dispatch buildpub.yml apps=run.bib,run.auth regions=use1` via `gh` (klanker-maker has `actions:write` per memory `[[reference_klanker_maker_scopes]]`)
- Watch workflow runs via `gh run watch` and iterate on any red CI
- SSM parameter audits via AWS SDK / CLI
- Real `curl bib.defcon.run/use1/api/health` smoke
- Stripe API test event send via the `sk_test_*` key
- Post-deploy SUMMARY / STATE / ROADMAP updates

**HITL only (Kurt drives):**
- 4-step live user-facing E2E in a real browser (Stripe Checkout redirect + session cookie flow)
- Real Venmo/CashApp forwarded email through gmail into SES
- Any SSO login flow that needs a browser (I have no browser; Kurt authenticates SSO)

## Existing state audit

**Merged CI/infra (from Phase 20 + Phase 22 prep):**
- `apps/build.sh`, `apps/deploy.sh`, `apps/release-all.sh` — `run.bib` case added, CloudFront domain map wired
- `.github/workflows/buildpub.yml` — `run.bib` in default apps list; `run-bib`→`bib.defcon.run` in CF invalidation map
- `.github/workflows/deploy.yml` — same CF invalidation map
- `infra/terraform/live/site/site.hcl` — `bib` subdomain, ECR (`dc34-run-bib-{nginx,app}`), CloudFront distribution wired
- `infra/terraform/live/site/services/run.bib/service.hcl` — ECS task + service + ALB
- `infra/terraform/live/site/region/us-east-1/bib-reconcile/terragrunt.hcl` — Lambda unit (from Plan 22-03)
- SSM param definitions from Phase 20 (paths provisioned, values loaded/pending)

**Merged code (from Phase 21 + Phase 22):**
- `apps/run.bib/webapp/` — 12 routes emit (bib registration, sponsor, checkout, webhook, admin report)
- `apps/run.bib/nginx/` — reverse proxy sidecar
- `apps/run.bib/lambda/reconcile/` — Node.js Lambda handler code
- `apps/run.auth/webapp/src/config/oidc.ts` — `bib` client entry (needs redeploy to take effect)

**Stripe (from earlier this session via API):**
- Product `prod_UoOw1e2QiETfr0` (Bib Sponsorship)
- Product `prod_UoOwrhvDGjgzol` (General Donation)
- Webhook `we_1Tom8n1QpHZG1eJhxGmNv4S7` → `bib.defcon.run/use1/api/stripe/webhook` (subscribed to `checkout.session.completed`)

**SSM status:**
- ✅ `/dc34/secrets/use1/bib/anthropic/api_key` — Kurt loaded
- ✅ `/dc34/secrets/use1/bib/stripe/secret_key` — Kurt loaded
- ✅ `/dc34/secrets/use1/bib/stripe/publishable_key` — Kurt loaded
- ⏳ `/dc34/secrets/use1/bib/stripe/webhook_signing_secret` — placeholder loaded; real `whsec_C9DDXh41lrexKi6w8pKZMRXlWodwYXIb` command sent to Kurt
- ⏳ `/dc34/secrets/use1/bib/admin/allowlist` — command sent to Kurt (needs emails)
- ⏳ `/dc34/secrets/use1/bib/venmo/handle` — default `@defconrun` (may or may not be loaded)
- ⏳ `/dc34/secrets/use1/bib/cashapp/handle` — default `$defconrun`

## Blockers routed to STATE.md

- Live Stripe live-mode E2E (Kurt does eventually, post-launch)
- Real receipt SES E2E (Kurt does once bib.defcon.run is live)
- 4-step user-facing E2E (Kurt does once bib.defcon.run is live)

## Decisions locked

- `use1` only for launch (multi-region deferred to v1.6+)
- No new Terragrunt modules needed — Phase 20 + Phase 22-03 modules cover everything
- Deploy order: (a) Terragrunt apply infra first, (b) build/push images second, (c) redeploy run.auth for OIDC, (d) verify

## Deferred to v1.6+

- Multi-region deploy (cac1, apse1)
- Anonymous general donation flow
- Venmo/CashApp general-donation matcher (currently only bib-attached)
- byWillPayInPerson GSI (currently uses scan)
- run.auth `admin` service claim (Option B admin gate variant)
