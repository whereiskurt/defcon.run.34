# Requirements: DEF CON Run 34

**Defined:** 2026-07-01
**Core Value:** Participants and organizers have a seamless digital experience for DCR34 — from device setup to event discovery to route navigation — all through the browser.
**Active milestone:** v1.5 Bib Registration. Requirements for shipped milestones (v1.0–v1.3) are archived under `.planning/milestones/`.

## v1.5 Requirements

Requirements for the Bib Registration milestone (bib.defcon.run). Each maps to roadmap phases 19-22. Layout mirrors flash.defcon.run (two-container Next.js + nginx ECS Fargate + CloudFront, multi-region), shipped via the existing GitHub Actions held-release pipeline.

### Infrastructure

- [ ] **BIB-01**: `bib` added to `dns.subdomains`; ACM cert + CloudFront distribution for bib.defcon.run in both regions (us-east-1 + ca-central-1)
- [ ] **BIB-02**: ECR repositories `dc34-run-bib-nginx` and `dc34-run-bib-app` created in both regions
- [ ] **BIB-03**: `services/run.bib/service.hcl` defines a two-container (nginx + app) ECS task, ALB load_balancer, and service discovery — both-region, modeled on run.flash
- [ ] **BIB-04**: SSM parameters for bib — OIDC client id/secret, Stripe secret key + webhook signing secret, and PayPal client id/secret + webhook id under `/{site_label}/secrets/{region_label}/bib/...` (both processors wired at launch; crypto adds its own later)
- [ ] **BIB-05**: `site.hcl` reads `services/run.bib/service.hcl` via `read_terragrunt_config`; bib reuses the shared `run-human-electro` DynamoDB table (no new table)

### App & Registration

- [ ] **BIB-06**: Next.js webapp scaffold at `apps/run.bib/webapp/` mirroring run.flash (region basePath/middleware, providers, theme, fonts, auth config)
- [ ] **BIB-07**: `Bib` ElectroDB entity on the shared electro table — owner OIDC sub, name-on-bib, size, payment status, amount, timestamps, plus an index to fetch a user's registration
- [ ] **BIB-08**: Registration form — enter name on bib with validation (~32-character hard cap enforced client + server, allowed characters) and a live bib preview
- [ ] **BIB-09**: API routes — create registration (idempotent per user) and fetch the signed-in user's registration; unauthenticated requests rejected
- [ ] **BIB-18**: Registration UI rendered as a standard physical-looking race bib — large bib number, prominent name-on-bib, DC34 branding (2026), classic bib styling (border, registration-mark/safety-pin accents); live preview updates as the user types and is reused on the confirmation page; the name text **auto-shrinks to fit the bib width** (large for short names, scaling down as the name grows, no wrap/truncation) up to the ~32-char cap; built as one swappable component (prior-year layouts are external reference, not a blocker)
- [ ] **BIB-10**: Login REQUIRED to get a bib — OIDC auth via auth.defcon.run using the **run.gpx Auth.js pattern** (copy gpx `config/auth.ts` + `middleware.ts` + `signin`/`access-denied`, rename cookies + claim to `bib`): edge middleware redirects unauthenticated users to `/signin`, then gates on the `bib` service claim with live claim re-validation (lockout + sessionVersion)

### Payment

> **Multiple methods at launch:** v1.5 supports **cash on-site, Stripe (cards + Apple/Google Pay), and PayPal/Venmo** from day one, all behind one `PaymentProvider` seam (`lib/payments/`) with a registry, provider-generic webhook route, shared idempotent `paid` transition, and a `fake` provider for CI. Adding a provider is a new file, not a refactor.
>
> **Ownership:** Claude scaffolds working Stripe and PayPal/Venmo integrations against the seam. The other developer owns only the real **Stripe account + go-live keys** (test/sandbox creds drive development). **Crypto (BTC/ETH)** is seam-ready but **deferred** — not implemented in v1.5; rail (Coinbase Commerce vs BTCPay Server) chosen later.
>
> **Minimal switch-on / add-provider:** localized — (1) populate that provider's SSM secrets, (2) implement its single `lib/payments/<provider>.ts` (`createCheckout()` + `verifyWebhook()`), (3) register it + flip its enable flag. No schema or UI changes.
>
> **Testing:** Stripe test mode (`sk_test_…`), test cards (`4242…` success, `4000…9995` decline, `4000…3155` 3DS), Stripe CLI (`stripe listen --forward-to …/api/payments/stripe/webhook` + `stripe trigger`); PayPal **sandbox** (sandbox client id/secret + sandbox buyer accounts); the `fake` provider exercises register→pay→confirm in CI with no external dependency.

- [ ] **BIB-11**: Give-amount selection — preset tiers $10 / $20 / $50 / $500 (USD, config-driven) recorded on the registration as amount + currency
- [ ] **BIB-20**: Payment-method chooser at checkout — cash / Stripe / PayPal-Venmo, driven by the enabled-provider registry; the chosen `paymentProvider` is recorded on the registration (crypto option hidden until implemented)
- [ ] **BIB-12**: "Pay on site (cash)" — registration stored in `pay_on_site` state with the intended amount recorded; collected in person, no online charge
- [ ] **BIB-13**: `PaymentProvider` seam + **Stripe provider** — registry, provider-generic webhook route (`/api/payments/[provider]/webhook`) with signature verify + idempotent `paid` transition, `fake` provider for CI, and a working Stripe implementation (Checkout create + webhook normalize) verified in test mode
- [ ] **BIB-19**: **PayPal/Venmo provider** — working implementation behind the seam (PayPal Orders API create/capture; Venmo as a PayPal funding source), webhook verify/normalize, verified in PayPal sandbox
- [ ] **BIB-14**: Confirmation page shows authoritative payment status (paid / pending / pay-on-site + amount + provider) sourced from the persisted registration, not the client redirect alone

### Build & Deploy

- [ ] **BIB-15**: `build.sh`, `deploy.sh`, and `release-all.sh` support `run.bib` (nginx + app components, VERSION files)
- [ ] **BIB-16**: `buildpub.yml` (apps input default + repo→domain map) and `deploy.yml` include run.bib — piggyback the existing held-release PR + per-region deploy flow with no new workflow
- [ ] **BIB-17**: Both-region deployment verified at bib.defcon.run with DC34 branding (sign in → register → pay via cash / Stripe / PayPal end-to-end)

## Deferred (v2)

Tracked but not in the current roadmap.

### Payments (seam ready in v1.5)

- **PAY-01**: Crypto (BTC/ETH) payment provider behind the v1.5 `PaymentProvider` seam — rail decision pending (Coinbase Commerce hosted/custodial vs BTCPay Server self-hosted/non-custodial). Seam, DB `paymentProvider` field, and generic webhook route already support it; only the provider file + its secrets/infra remain.

## Traceability

Which phases cover which v1.5 requirements.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BIB-01 | Phase 19 | Planned |
| BIB-02 | Phase 19 | Planned |
| BIB-03 | Phase 19 | Planned |
| BIB-04 | Phase 19 | Planned |
| BIB-05 | Phase 19 | Planned |
| BIB-06 | Phase 20 | Planned |
| BIB-07 | Phase 20 | Planned |
| BIB-08 | Phase 20 | Planned |
| BIB-09 | Phase 20 | Planned |
| BIB-10 | Phase 20 | Planned |
| BIB-18 | Phase 20 | Planned |
| BIB-11 | Phase 21 | Planned |
| BIB-20 | Phase 21 | Planned |
| BIB-12 | Phase 21 | Planned |
| BIB-13 | Phase 21 | Planned |
| BIB-19 | Phase 21 | Planned |
| BIB-14 | Phase 21 | Planned |
| BIB-15 | Phase 22 | Planned |
| BIB-16 | Phase 22 | Planned |
| BIB-17 | Phase 22 | Planned |

**Coverage:**
- v1.5 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0 (crypto BTC/ETH provider is a deferred seam, tracked as PAY-01)

---
*Requirements defined: 2026-07-01 (v1.5 Bib Registration milestone)*
