# Roadmap: DEF CON Run 34

## Milestones

- [x] **v1.0 Meshtastic Flasher MVP** - Phases 1-4 (shipped 2026-03-02)
- [x] **v1.1 CMS Content Types** - Phases 5-9 (shipped 2026-03-05)
- [x] **v1.2 User Checkins** - Phases 10-13 (shipped 2026-03-06)
- [x] **v1.3 Meshtk Integration** - Phases 14-17 (shipped 2026-07-01)
- [ ] **v1.4 Flash Service Refresh** - Phases 18-19 (in progress)
- [ ] **v1.5 Bib Registration** - Phases 20-23 (planned)

## Phases

<details>
<summary>v1.0 Meshtastic Flasher MVP (Phases 1-4) - SHIPPED 2026-03-02</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for archived v1.0 roadmap.

</details>

<details>
<summary>v1.1 CMS Content Types (Phases 5-9) - SHIPPED 2026-03-05</summary>

See `.planning/milestones/v1.1-ROADMAP.md` for archived v1.1 roadmap.

</details>

<details>
<summary>v1.2 User Checkins (Phases 10-13) - SHIPPED 2026-03-06</summary>

See `.planning/milestones/v1.2-ROADMAP.md` for archived v1.2 roadmap.

- [x] Phase 10: CheckIn Data Layer (1/1 plans) — completed 2026-03-06
- [x] Phase 11: Check-in API Routes (1/1 plans) — completed 2026-03-06
- [x] Phase 12: CheckInModal + Header Integration (1/1 plans) — completed 2026-03-06
- [x] Phase 13: Profile Check-in Display (1/1 plans) — completed 2026-03-06

</details>

<details>
<summary>v1.3 Meshtk Integration (Phases 14-17) - SHIPPED 2026-07-01</summary>

See `.planning/milestones/v1.3-ROADMAP.md` for archived v1.3 roadmap.

- [x] Phase 14: Infrastructure Foundation (3/3 plans) — completed 2026-03-07
- [x] Phase 15: Container Images + Task Definition (3/3 plans) — completed 2026-03-07
- [x] Phase 16: Build/Deploy Pipeline (2/2 plans) — completed 2026-03-07
- [x] Phase 17: Meshmap Verification + Branding (1/1 plans) — completed 2026-03-07

> Phase 18 (Fleet Simulator + Easter Egg) deferred to `.planning/backlog/fleet-simulator-easter-egg.md`.

</details>

### v1.4 Flash Service Refresh (Phases 18-19) - ACTIVE

- [ ] **Phase 18: Build-Time Firmware & Device List Refresh** - Auto-resolve latest stable, vendor the correct bootable factory image, regenerate the ESP32-only device list — all at build time
- [ ] **Phase 19: Dependencies & DCR34 Branding/UX** - Bump Meshtastic/esptool deps with no regression and ship the "run.defcon.run firmware" identity with connect/bootloader/error UX alignment

## Phase Details

### Phase 18: Build-Time Firmware & Device List Refresh
**Goal**: A clean image build automatically vendors the correct, bootable latest-stable Meshtastic firmware and a refreshed ESP32-only device list, with zero external runtime dependency.
**Depends on**: Nothing (first phase of v1.4)
**Requirements**: FLSH-06, FLSH-07, FLSH-08, DEVC-06, DPLY-06
**Success Criteria** (what must be TRUE):
  1. Flashing an ESP32 device writes the vendored **factory** image at offset `0x00` (erase → write → MD5 verify) and produces a device that boots and connects — the highest-risk item, confirmed before the version-resolution change is relied upon.
  2. A clean `docker build` with no code edits produces a flasher pinned to the **current** Meshtastic stable release, resolved from `api.meshtastic.org/github/firmware/list` (`releases.stable[0]`) — no hardcoded version remains anywhere.
  3. `FIRMWARE_VERSION` is build-injected as the single source of truth (no manual placeholder in `src/config/firmware.ts`) and the resolved version is visible in the flasher.
  4. The device picker shows an ESP32-only hardware list regenerated at build from `api.meshtastic.org/resource/deviceHardware` (esp32/esp32-s3/esp32-c3/esp32-c6), with the DCR34 Recommended set preserved and sorted first.
  5. The running container makes no network calls to GitHub or `api.meshtastic.org` (offline-at-event guarantee verified).
**Plans**: 3 plans

Plans:
- [ ] 18-01-PLAN.md — Code contract: firmware.ts env-injected FIRMWARE_VERSION + .factory.bin filename, next.config assertion, README release checklist
- [ ] 18-02-PLAN.md — Dev-parity scripts: download-firmware.sh (API resolve + factory extract + .env.local) + new generate-hardware-list.sh
- [ ] 18-03-PLAN.md — Dockerfile.webapp rewrite (Stage 1 API resolve + factory + hardware-list, builder env plumbing + offline grep) + FLSH-08 hardware boot verification checkpoint

### Phase 19: Dependencies & DCR34 Branding/UX
**Goal**: The flasher runs on bumped Meshtastic/esptool dependencies with no regression, and presents a cohesive DCR34 "run.defcon.run firmware" identity with connect, bootloader-help, and error UX aligned to current flasher.meshtastic.org patterns.
**Depends on**: Phase 18 (branding surfaces the build-injected version and Recommended device list; the dependency bump must be validated against the refreshed firmware/factory-image flash path)
**Requirements**: DEPS-01, BRND-01, BRND-02
**Success Criteria** (what must be TRUE):
  1. `@meshtastic/core`, `@meshtastic/transport-web-serial`, and `esptool-js` are bumped to their latest compatible versions and the full pick → connect → flash → configure → done flow completes with no regression.
  2. The `tlora-t3s3 → flashMode 'dio'` quirk is preserved and that board still flashes successfully.
  3. The UI presents the firmware as **"run.defcon.run firmware"** with the underlying Meshtastic version shown as a subtitle (e.g. "run.defcon.run firmware · Meshtastic {version}"), replacing generic Meshtastic version strings.
  4. Connect, bootloader-help, and error states give clear DFU/bootloader guidance, chip-mismatch messaging, and actionable serial-error copy aligned with flasher.meshtastic.org.
**Plans**: TBD
**UI hint**: yes

### v1.5 Bib Registration (Planned)

**Milestone Goal:** Participants register a race bib at bib.defcon.run -- enter the name to print on the bib (auto-shrinking to fit, ~32-char cap) and give via preset tiers ($10/$20/$50/$500), paying at launch through **cash on-site, Stripe (cards + Apple/Google Pay), or PayPal/Venmo** behind one provider-agnostic seam (crypto BTC/ETH seam-ready but deferred) -- deployed to both regions using the same two-container (nginx + Next.js) ECS Fargate + CloudFront layout as flash.defcon.run, with the run.gpx auth pattern, and shipped through the existing GitHub Actions held-release pipeline (no new workflow).

**Layout source of truth:** `apps/run.flash/` + `infra/terraform/live/site/services/run.flash/service.hcl`. Bib mirrors this structure exactly, swapping flash-specific logic for bib registration + payment.

> **Phase-numbering:** Bib is milestone **v1.5**, phases **20-23**, sequenced right after v1.4 Flash Service Refresh's phases 18-19.

- [ ] **Phase 20: Infrastructure Foundation** - subdomain, ECR repos, ACM/CloudFront, SSM params (OIDC + Stripe), service.hcl, site.hcl wiring
- [ ] **Phase 21: App Scaffold + Bib Registration** - Next.js webapp mirroring run.flash, Bib ElectroDB entity, registration form, API routes, OIDC `bib` claim gate, nginx container
- [ ] **Phase 22: Payments (Cash + Stripe + PayPal/Venmo, crypto-ready)** - provider-agnostic seam, method chooser, give tiers, cash path, working Stripe + PayPal/Venmo providers, crypto seam deferred
- [ ] **Phase 23: Build/Deploy + Branding** - run.bib added to build.sh/deploy.sh/release-all.sh + buildpub.yml/deploy.yml, DC34 branding, both-region verification

### Phase 20: Infrastructure Foundation
**Goal**: All AWS infrastructure required by bib.defcon.run is provisioned and reachable in both regions, mirroring the flash.defcon.run footprint
**Depends on**: Nothing (first phase of v1.5)
**Requirements**: BIB-01, BIB-02, BIB-03, BIB-04, BIB-05
**Success Criteria** (what must be TRUE):
  1. `bib` is present in `site.hcl` `dns.subdomains`, and ACM cert + CloudFront distribution for bib.defcon.run resolve in both regions
  2. ECR repositories `dc34-run-bib-nginx` and `dc34-run-bib-app` exist in both regions and accept image pushes
  3. `services/run.bib/service.hcl` defines a two-container (nginx + app) ECS task and ALB load_balancer, read by `site.hcl` via `read_terragrunt_config`, and `terragrunt plan` is clean for existing services
  4. SSM parameters exist for bib OIDC client id/secret and Stripe secret + webhook signing secret under `/{site_label}/secrets/{region_label}/bib/...`
  5. bib reuses the shared `run-human-electro` DynamoDB table (no new table) -- access confirmed via env wiring in service.hcl
**Plans**: 2 plans

Plans:
- [ ] 20-01-PLAN.md — Subdomain + service.hcl + site.hcl wiring + ECR repos (copy run.flash service.hcl, swap names/domain/secrets)
- [ ] 20-02-PLAN.md — SSM params (OIDC + Stripe) + CloudFront/ACM verification + electro table env wiring

### Phase 21: App Scaffold + Bib Registration
**Goal**: A logged-in participant submits a bib (name on bib) that is written to their account and shown to them on return, served by the Next.js + nginx two-container task
**Depends on**: Phase 20
**Requirements**: BIB-06, BIB-07, BIB-21, BIB-08, BIB-18, BIB-09, BIB-10
**Success Criteria** (what must be TRUE):
  1. Next.js webapp scaffold exists at `apps/run.bib/webapp/` mirroring run.flash (app shell, providers, theme, fonts) and builds with `next build`
  2. A `Bib` ElectroDB entity is defined on the shared electro table keyed by `ownerSub`, with name-on-bib, bib number, size, payment status/amount/provider, and timestamps, plus an index to fetch a user's bib by `ownerSub`
  3. **Account-linked:** login is required; the chosen bib is written to the authenticated user (OIDC `sub`) and re-displayed on subsequent logins; one bib per account (idempotent), never anonymous
  4. The registration UI renders as a standard physical-looking **race bib** (large bib number, prominent name, DC34 branding) with a live preview that updates as the user types, reused on the confirmation page
  5. API routes create a bib (idempotent per account) and fetch the signed-in user's bib; unauthenticated requests are rejected
  6. Access is gated using the **run.gpx auth pattern** (copied `config/auth.ts` + `middleware.ts` + signin/access-denied, cookies + claim renamed to `bib`); users without the `bib` claim see access-denied
**Plans**: 2 plans

Plans:
- [ ] 21-01-PLAN.md — Webapp scaffold + nginx container + gpx auth (config/auth.ts + middleware + signin/access-denied, renamed to bib) + register the `bib` OIDC client in run.auth (config/oidc.ts + index.ts)
- [ ] 21-02-PLAN.md — Bib ElectroDB entity + race-bib visual component + registration form + create/fetch API routes

### Phase 22: Payments (Cash + Stripe + PayPal/Venmo, crypto-ready)
**Goal**: A registered participant picks a give amount ($10/$20/$50/$500) and pays at launch via **cash on-site, Stripe (cards + Apple/Google Pay), or PayPal/Venmo** — all through one provider-agnostic seam. Crypto (BTC/ETH) is left as a ready seam, deferred. Claude scaffolds working Stripe + PayPal integrations; the other dev owns only the real Stripe account/keys + go-live.
**Depends on**: Phase 21
**Requirements**: BIB-11, BIB-20, BIB-12, BIB-13, BIB-19, BIB-14
**Success Criteria** (what must be TRUE):
  1. The confirmation step offers preset give tiers ($10/$20/$50/$500) and a **payment-method chooser** (cash / Stripe / PayPal-Venmo); the chosen amount, currency, and `paymentProvider` are recorded on the registration
  2. All online providers go through one `PaymentProvider` seam (`lib/payments/`) with a registry, a provider-generic webhook route (`/api/payments/[provider]/webhook`), and a shared idempotent `paid` state transition — adding a provider is a new file, not a refactor
  3. **Stripe** provider works end-to-end in test mode (Checkout session → redirect → webhook → `paid`); real account/keys are the other dev's go-live step
  4. **PayPal/Venmo** provider works end-to-end in sandbox (PayPal Orders API create/capture; Venmo as a PayPal funding source) → `paid`
  5. **Cash on-site** persists `pay_on_site` with amount recorded; no processor; a `fake` provider exercises the full flow in CI with no external dependency
  6. The confirmation page shows current status (paid / pending / pay-on-site + amount + provider) sourced from the persisted registration, never the client redirect alone; the crypto seam is present and documented but not implemented (rail TBD: Coinbase Commerce vs BTCPay)
**Plans**: 3 plans

Plans:
- [ ] 22-01-PLAN.md — Give-tier + method-chooser UI, payment state machine, PaymentProvider seam + registry + fake provider + provider-generic webhook route + cash path
- [ ] 22-02-PLAN.md — Stripe provider (Checkout create + webhook verify/normalize) behind the seam + test-mode verification
- [ ] 22-03-PLAN.md — PayPal/Venmo provider (Orders create/capture + webhook verify/normalize) behind the seam + sandbox verification

### Phase 23: Build/Deploy + Branding
**Goal**: bib containers build, publish, and deploy to both regions through the existing release pipeline, with DC34 branding live at bib.defcon.run
**Depends on**: Phase 22
**Requirements**: BIB-15, BIB-16, BIB-17
**Success Criteria** (what must be TRUE):
  1. `apps/build.sh` and `apps/deploy.sh` accept `run.bib` (nginx + app components, VERSION files) and `release-all.sh` includes run.bib in its default app list
  2. `buildpub.yml` (apps input default + repo→domain map) and `deploy.yml` include run.bib so the held-release PR + per-region deploy flow covers bib with no new workflow
  3. bib.defcon.run serves the DC34-branded registration app in both regions, verified end-to-end (sign in → register → pay now/later)
**Plans**: 1 plan

Plans:
- [ ] 23-01-PLAN.md — Release pipeline wiring (build.sh/deploy.sh/release-all.sh + buildpub.yml/deploy.yml) + DC34 branding assets + both-region verification

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 14. Infrastructure Foundation | v1.3 | 3/3 | Complete | 2026-03-07 |
| 15. Container Images + Task Definition | v1.3 | 3/3 | Complete | 2026-03-07 |
| 16. Build/Deploy Pipeline | v1.3 | 2/2 | Complete | 2026-03-07 |
| 17. Meshmap Verification + Branding | v1.3 | 1/1 | Complete | 2026-03-07 |
| 18. Build-Time Firmware & Device List Refresh | v1.4 | 0/3 | Planned | - |
| 19. Dependencies & DCR34 Branding/UX | v1.4 | 0/0 | Not started | - |
| 20. Bib Infrastructure Foundation | v1.5 | 0/2 | Planned | - |
| 21. Bib App Scaffold + Registration | v1.5 | 0/2 | Planned | - |
| 22. Bib Payments (Cash + Stripe + PayPal/Venmo) | v1.5 | 0/3 | Planned | - |
| 23. Bib Build/Deploy + Branding | v1.5 | 0/1 | Planned | - |
