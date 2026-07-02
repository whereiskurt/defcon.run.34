# Roadmap: v1.5 Bib Registration

**Workstream:** v1-5-bib
**Parallel-safe with:** v1.4.1 nRF52840 (zero file overlap — this touches only `apps/run.bib/` + new infra units)
**Created:** 2026-07-02
**Base branch:** main (post-v1.4 shipped)

## Milestone Goal

Participants register a race bib at bib.defcon.run — logged in, they see their bib preview and can help sponsor DCR34 via Venmo/CashApp comment-code reconciliation or Stripe. Amounts ≥ $10 unlock name-on-bib for the physical print run.

## Design Contract (from Kurt 2026-07-02)

### User flow

1. User logs in (OIDC via run.auth). Login required for ALL giving; there is no anonymous path.
2. First visit → bib preview renders with placeholder number `1337`.
3. User enters a name → replaces `1337` in the primary display area.
4. As they interact, a "Help Sponsor!" call-to-action opens the payment picker (Venmo / CashApp / Stripe).
5. Custom-amount slider (no fixed tiers) → user picks how much.
6. Payment path:
   - **Stripe** → immediate webhook confirmation → `paid_status=paid`, `paid_amount` incremented.
   - **Venmo / CashApp** → user gets a specific handle (default `@defconrun`, overridable) AND a required comment string containing their **runner reconciliation code** (`BIB-XXXX`, 4-char, stable per user).
7. Payment receipt lands in `defcon.run@gmail.com`. Admin (Kurt/Jesse) forwards to `bibpayment@run.defcon.run` (SES-received). Lambda invokes Haiku to extract `{amount, comment_text, sender_display_name}` from the email body. Reconciliation matches by:
   - Primary: `BIB-XXXX` code found in the comment/body.
   - Fallback: sender_display_name → user's stored name/email.
   - No match → email back to `defcon.run@gmail.com` as an unresolved-queue notification.
8. Name on physical bib: shown iff `paid_amount ≥ $10 AND admin has not yet fired the global "lock" flag`.
9. Name editable at any time until the admin lock; amount always editable (top-ups accumulate); size field does NOT exist (no sizes on bibs).
10. Global admin-controlled deadline / lock flag freezes all bibs once bib print goes to production.

### Data model (Bib entity)

Keyed by `ownerSub` (OIDC subject). One bib per account (idempotent create).

Fields:
- `ownerSub` (partition key) — OIDC subject of the user
- `nameOnBib` (string, editable until lock) — what shows in the primary display area
- `runnerCode` (string, immutable, `BIB-XXXX` 4-char alphanumeric) — reconciliation key on payment comments
- `paidAmount` (number, cents; accumulative over multiple donations)
- `paidStatusHistory` (list of `{provider, amount, timestamp, reconciled_via}`) — audit trail
- `nameLocked` (bool, admin-set global at close) — freezes `nameOnBib`
- `createdAt`, `updatedAt` (ISO8601)

Indexes:
- `runnerCode-index` (GSI) — for Haiku Lambda lookups by comment code

### Reconciliation queue

Separate DDB entity `BibReconcile`:
- `receiptId` (partition key, generated) — email Message-ID hash
- `receivedAt`
- `provider` (venmo|cashapp)
- `extractedAmount`, `extractedComment`, `extractedSenderName`
- `status` (`matched` | `unmatched` | `ambiguous`)
- `matchedOwnerSub` (if matched)

On `unmatched` or `ambiguous`, Lambda sends a notification email to `defcon.run@gmail.com` with the extracted fields for manual reconciliation.

### Bib UI

- Live preview updates as user types.
- Bib visual template: DC34 bib SVG (already committed in earlier v1.5 asset work).
- Primary display area shows `1337` until `nameOnBib` is non-empty, then shows `nameOnBib` (auto-shrink to fit, ~32-char cap).
- Sponsor CTA + custom-amount slider on the same page.
- Payment provider picker → provider-specific instructions (handle + required comment `BIB-XXXX`).

### Auth (OIDC)

Mirror the `run.gpx` pattern exactly:
- Copy `config/auth.ts` + `middleware.ts` + signin/access-denied
- Rename cookie prefix + claim to `bib`
- Register new OIDC client `bib` in `run.auth` (config/oidc.ts + index.ts)

### Payments — SSM configuration

- `/dc34/secrets/use1/bib/stripe/secret_key` (Kurt sets — starts `sk_test_*`)
- `/dc34/secrets/use1/bib/stripe/webhook_signing_secret` (Kurt sets — starts `whsec_*`)
- `/dc34/secrets/use1/bib/venmo/handle` (default `@defconrun`, overridable)
- `/dc34/secrets/use1/bib/cashapp/handle` (default `$defconrun`, overridable)
- `/dc34/secrets/use1/bib/anthropic/api_key` (Kurt sets — starts `sk-ant-*`, Haiku Lambda)

### Deploy pattern

Mirror `apps/run.flash/` two-container (nginx + Next.js) ECS Fargate + CloudFront layout. Uses the buildpub.yml release-PR pattern. New `run.bib` in `apps/build.sh` + `apps/deploy.sh` + `apps/release-all.sh` + `buildpub.yml` (apps input default + repo→domain map) + `deploy.yml`. No new workflow.

### Deferred to v1.6+ (out of v1.5 scope)

- Shareable `/bib/{ownerSub}` URL for QR-code integration with existing meshtastic runner flow.
- Multi-region (Phase 23 covers both-region deploy but sequential).
- Crypto payment provider (BTC/ETH seam ready but no provider live at launch).

## Phases

- [ ] **Phase 20: Infrastructure Foundation** (2 plans expected)
- [ ] **Phase 21: App Scaffold + Bib Registration** (2-3 plans expected)
- [ ] **Phase 22: Payments (Stripe + Venmo/CashApp reconciliation via Haiku)** (3-4 plans expected)
- [ ] **Phase 23: Build/Deploy + Branding** (1 plan expected)

---

## Phase 20: Infrastructure Foundation

**Goal:** All AWS infrastructure required by bib.defcon.run is provisioned and reachable in `use-east-1`, mirroring the flash.defcon.run footprint (multi-region deploy is Phase 23).

**Depends on:** Nothing (first phase of v1.5)
**Requirements:** BIB-01, BIB-02, BIB-03, BIB-04, BIB-05

**Success Criteria:**
1. `bib` is present in `site.hcl` `dns.subdomains`, and ACM cert + CloudFront distribution for bib.defcon.run resolve in `use1`
2. ECR repositories `dc34-run-bib-nginx` and `dc34-run-bib-app` exist in `use1` and accept image pushes
3. `services/run.bib/service.hcl` defines a two-container (nginx + app) ECS task and ALB load_balancer, read by `site.hcl` via `read_terragrunt_config`, and `terragrunt plan` is clean for existing services
4. SSM parameters exist for the five bib secrets listed above (all encrypted with `alias/dc34-ssm-use1`)
5. bib reuses the shared `run-human-electro` DynamoDB table (no new table) plus a new `Bib` + `BibReconcile` ElectroDB entity — access confirmed via env wiring in service.hcl
6. New SES receive rule for `bibpayment@run.defcon.run` writes to `ses-inbox-dc34-use1` with a prefix like `bib-payments/`

## Phase 21: App Scaffold + Bib Registration

**Goal:** A logged-in participant creates a bib with a `runnerCode`, edits their `nameOnBib`, and sees the live preview render with the DC34 bib template.

**Depends on:** Phase 20
**Requirements:** BIB-06, BIB-07, BIB-08, BIB-09, BIB-10, BIB-18, BIB-21

**Success Criteria:**
1. Next.js webapp scaffold exists at `apps/run.bib/webapp/` mirroring run.flash (app shell, providers, theme, fonts) and builds with `next build`
2. `Bib` + `BibReconcile` ElectroDB entities defined on the shared electro table with the schemas from the design contract above
3. Account-linked: login required (via run.gpx auth pattern with cookie + claim renamed to `bib`); one bib per account (idempotent create)
4. Registration UI renders as a DC34-branded race bib (SVG template) with live preview updating as user types
5. Primary display area shows `1337` placeholder until `nameOnBib` non-empty, then shows the name (auto-shrink ≤ 32 chars)
6. `runnerCode` (BIB-XXXX) generated at first bib creation, stored immutably, shown to user
7. API routes: `POST /api/bib` (create, idempotent per user), `PATCH /api/bib` (name edit, blocked when nameLocked=true), `GET /api/bib` (fetch signed-in user's bib)
8. Access gated using the run.gpx auth pattern (copied config/auth.ts + middleware.ts + signin/access-denied, renamed to `bib`)

## Phase 22: Payments (Stripe + Venmo/CashApp reconciliation via Haiku)

**Goal:** Users donate via Stripe (immediate webhook confirm) OR Venmo/CashApp (Haiku-based email reconciliation using the runnerCode as comment key). Amounts accumulate; ≥ $10 unlocks name-on-print.

**Depends on:** Phase 21
**Requirements:** BIB-11, BIB-12, BIB-13, BIB-14, BIB-19, BIB-20

**Success Criteria:**
1. Sponsor CTA with custom-amount slider (no fixed tiers)
2. Stripe payment intent flow — user hits Stripe Checkout, webhook (`checkout.session.completed`) verifies signature via `whsec_*`, then updates `paidAmount += event.amount_total` and appends to `paidStatusHistory`
3. Venmo instructions page shows the configured handle from SSM + user's runnerCode as the required comment (`BIB-XXXX`)
4. CashApp instructions page shows the configured handle + runnerCode
5. SES receives forwarded receipts at `bibpayment@run.defcon.run`. Lambda parses via Haiku (model `claude-haiku-4-5-20251001`, key from SSM, $20/day budget cap), extracts `{amount, comment, sender_name}`, upserts `BibReconcile` record.
6. Reconciliation matching: primary by `runnerCode` in comment; fallback by name/email; on match, `Bib.paidAmount += extracted_amount` + audit trail row.
7. On unmatched/ambiguous, Lambda sends a notification email to `defcon.run@gmail.com` with the raw extraction, marks `BibReconcile.status=unmatched`.
8. `nameOnBib` displays on physical bib print export iff `paidAmount ≥ 1000` (cents) AND `nameLocked=true` (admin has fired the global lock).

## Phase 23: Build/Deploy + Branding

**Goal:** bib containers build, publish, and deploy to `use1` (Phase 23 covers use1 only at launch; multi-region can follow) through the existing release pipeline, with DC34 branding live.

**Depends on:** Phase 22
**Requirements:** BIB-15, BIB-16, BIB-17

**Success Criteria:**
1. `apps/build.sh` + `apps/deploy.sh` accept `run.bib` (nginx + app components, VERSION files); `release-all.sh` includes it in default app list
2. `buildpub.yml` (apps input default + repo→domain map) + `deploy.yml` include `run.bib`
3. bib.defcon.run serves the DC34-branded registration app in `use1`, verified end-to-end (sign in → register → pay via Stripe test mode → paidAmount updates → bib preview shows the name once ≥$10)

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 20. Infrastructure Foundation | 0/TBD | Ready to plan | - |
| 21. App Scaffold + Bib Registration | 0/TBD | Planned | - |
| 22. Payments (Stripe + Venmo/CashApp) | 0/TBD | Planned | - |
| 23. Build/Deploy + Branding | 0/TBD | Planned | - |

## Hardware / Human verification policy

Same as v1.4: any SC that requires manual live-payment testing (Stripe live mode, real Venmo/CashApp receipt) MUST be flagged in STATE.md > Blockers rather than falsely marked green. Stripe TEST mode can and should be exercised in the sandbox.

## Kurt-provided values

To be populated by Kurt before deploy:
- Stripe `sk_test_*` + `whsec_*` — Kurt has the `aws ssm put-parameter` templated commands from 2026-07-02
- Anthropic API key `sk-ant-*` — same
- Venmo/CashApp handles — default `@defconrun` / `$defconrun`; overridable via SSM
