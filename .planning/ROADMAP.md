# Roadmap: DEF CON Run 34

## Milestones

- [x] **v1.0 Meshtastic Flasher MVP** - Phases 1-4 (shipped 2026-03-02)
- [x] **v1.1 CMS Content Types** - Phases 5-9 (shipped 2026-03-05)
- [x] **v1.2 User Checkins** - Phases 10-13 (shipped 2026-03-06)
- [x] **v1.3 Meshtk Integration** - Phases 14-17 (shipped 2026-07-01)
- [ ] **v1.4 Flash Service Refresh** - Phases 18-19 (in progress — code shipped 2026-07-01, hardware verification pending)
- [ ] **v1.4.1 nRF52840 / T-1000E Flash Support** - Phases 24-25 (planned, parallel-safe with v1.5)
- [ ] **v1.5 Bib Registration** - Phases 20-23 (planned)
- [ ] **v1.6 Header & Meshtastic UX Refresh** - Phases 26-27 (planned 2026-07-02)
- [ ] **v1.7 GPX Routes — Private Collection, Public Overlay & Strava Sync** - Phases 28-32 (autonomous build authorized 2026-07-02; workstream `v1-7-gpx-routes`, parallel-safe)

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

**Plans**: 2 plans
**UI hint**: yes

Plans:

- [ ] 19-01-PLAN.md — Bump @meshtastic/core, @meshtastic/transport-web-serial, esptool-js + preserve tlora-t3s3 → flashMode 'dio' quirk (DEPS-01)
- [ ] 19-02-PLAN.md — DCR34 "run.defcon.run firmware" identity + connect/bootloader-help/error UX alignment (BRND-01, BRND-02)

### v1.4.1 nRF52840 / T-1000E Flash Support (Planned — parallel-safe with v1.5)

**Milestone Goal:** flash.defcon.run supports flashing nRF52840-based Meshtastic devices — starting with the Seeed T1000-E SenseCap Card Tracker — alongside the existing ESP32 family. ESP32 flow is unchanged.

**Why parallel with v1.5:** v1.4.1 touches `apps/run.flash/` + `Dockerfile.webapp` only. v1.5 touches `apps/run.bib/` + new infra units. Zero file overlap → both milestones can run concurrently on independent branches.

**Not a fast follow to v1.4:** nRF52840 uses UF2/Web-USB-DFU, not `esptool-js`. Adding it needs a new device-family router in `use-flash.ts`, a new UF2 extract stage in `Dockerfile.webapp`, and a new bootloader-help UX ("double-tap RST"). See `.planning/backlog/nrf52840-t1000e-support.md` for the scope table.

- [ ] **Phase 24: Device-family router + nRF52 flash path** - Unblock `nrf52840` in Dockerfile Stage 1 filter, extract `.uf2` alongside `.factory.bin`, add family discriminator + router in `use-flash.ts`, implement Web USB DFU (or File System Access UF2 drop) write path
- [ ] **Phase 25: nRF52 UX + verification** - Bootloader-help variant for double-tap RST, chip-mismatch coverage for nRF chip families, four connect-error categories re-validated for the nRF path, T-1000E boot verification (hardware-in-loop)

### v1.5 Bib Registration (Planned)

**Milestone Goal:** Participants register a race bib at bib.defcon.run -- enter the name to print on the bib (auto-shrinking to fit, ~32-char cap) and give via preset tiers ($10/$20/$50/$500), paying at launch through **cash on-site, Stripe (cards + Apple/Google Pay), or PayPal/Venmo** behind one provider-agnostic seam (crypto BTC/ETH seam-ready but deferred) -- deployed to both regions using the same two-container (nginx + Next.js) ECS Fargate + CloudFront layout as flash.defcon.run, with the run.gpx auth pattern, and shipped through the existing GitHub Actions held-release pipeline (no new workflow).

**Layout source of truth:** `apps/run.flash/` + `infra/terraform/live/site/services/run.flash/service.hcl`. Bib mirrors this structure exactly, swapping flash-specific logic for bib registration + payment.

> **Phase-numbering:** Bib is milestone **v1.5**, phases **20-23**, sequenced right after v1.4 Flash Service Refresh's phases 18-19.

- [ ] **Phase 20: Infrastructure Foundation** - subdomain, ECR repos, ACM/CloudFront, SSM params (OIDC + Stripe), service.hcl, site.hcl wiring
- [ ] **Phase 21: App Scaffold + Bib Registration** - Next.js webapp mirroring run.flash, Bib ElectroDB entity, registration form, API routes, OIDC `bib` claim gate, nginx container
- [ ] **Phase 22: Payments (Cash + Stripe + PayPal/Venmo, crypto-ready)** - provider-agnostic seam, method chooser, give tiers, cash path, working Stripe + PayPal/Venmo providers, crypto seam deferred
- [ ] **Phase 23: Build/Deploy + Branding** - run.bib added to build.sh/deploy.sh/release-all.sh + buildpub.yml/deploy.yml, DC34 branding, both-region verification

### v1.6 Header & Meshtastic UX Refresh (Planned)

**Milestone Goal:** Fix the run.defcon.run header — remove Leaderboard entirely, replace the dead `/meshtastic` link with a real "this or that" landing page (Flash vs. MQTT network), keep Maps → gpx.defcon.run, surface a CMS-group-gated CMS link — and separately fix the cms.defcon.run incognito SSO glitch (native login flash → access-denied on reload).

**Split rationale:** two apps, two deploys. Phase 26 = `apps/run.human` frontend only. Phase 27 = `apps/run.cms` admin/SSO only. Zero file overlap → independent PRs, parallel-safe. Both are net-new/bugfix scoped, no infra changes.

> **Phase-numbering:** Header/Meshtastic UX is milestone **v1.6**, phases **26-27**, after v1.4.1's phases 24-25.

- [ ] **Phase 26: Header/Nav UX Refresh** - remove Leaderboard (header.tsx + dropdown-menu.tsx), new public `/meshtastic` "this or that" tile page (flash.defcon.run vs mqtt.defcon.run), keep Maps → gpx.defcon.run, CMS link in user dropdown gated on `cms` service. See `phases/26-header-nav-ux-refresh/26-CONTEXT.md`.
- [ ] **Phase 27: CMS Incognito SSO Fix** - fix native-login flash (admin/app.tsx module-load redirect guard misses SPA route change) + reload access-denied (OIDC session/refresh cookie sameSite/secure drop vs. services-claim delivery — repro to confirm). See `phases/27-cms-incognito-sso-fix/27-CONTEXT.md`.

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

### Phase 24: Device-family router + nRF52 flash path

**Goal**: `apps/run.flash/webapp` flashes an nRF52840 device (Seeed T1000-E) end-to-end via UF2/Web-USB-DFU alongside the existing ESP32 esptool-js path — with a single device-family router that routes by `deviceHardware.architecture`.
**Depends on**: Phase 19 (bumped `esptool-js` 0.6.0 baseline; router lives on the same code path)
**Requirements**: DEVC-07, FLSH-09, DPLY-07
**Success Criteria** (what must be TRUE):

  1. `Dockerfile.webapp` Stage 1 jq filter admits `nrf52840` alongside `esp32*` architectures; hardware-list contains the T-1000E slug + Recommended set is preserved.
  2. `Dockerfile.webapp` Stage 1 extracts `firmware-t1000-e-{version}.uf2` alongside the ESP32 `.factory.bin` set; both artifact families ship in the same image; DPLY-06 grep gate still passes.
  3. `use-flash.ts` has a family discriminator on `deviceHardware.architecture` — ESP32 family → existing esptool-js path (unchanged); `nrf52840` → new UF2/DFU write path.
  4. UF2/DFU path successfully writes the `.uf2` to a T-1000E in bootloader mode and reports completion; ESP32 path has zero regression against the Phase 19 Recommended set.
  5. `next build` + `tsc --noEmit` clean; no runtime calls to `api.meshtastic.org` or `github.com/meshtastic` under the new path.

**Plans**: TBD (target ~2 plans — router + Dockerfile extract, then Web-USB-DFU write path).
**UI hint**: minimal (router is code-only; UX polish is Phase 25).

### Phase 25: nRF52 UX + verification

**Goal**: Users flashing a T-1000E get the correct bootloader-help copy ("double-tap RST"), the four connect-error categories still fit, chip-mismatch surfaces nRF families, and one T-1000E is verified flashed end-to-end on hardware.
**Depends on**: Phase 24
**Requirements**: BRND-03, FLSH-10
**Success Criteria** (what must be TRUE):

  1. `bootloader-help.tsx` shows a device-family-aware variant — ESP32 keeps BOOT+RST; nRF52 shows double-tap RST + mass-storage / DFU device-name hint.
  2. `chip-mismatch.tsx` copy covers both `esp32*` families and `nrf52840` (naming both detected and expected sides).
  3. Four connect-error categories (`cancelled` silent, `in-use`, `no-response`, `generic`) re-validated against the Web-USB-DFU flow.
  4. **Hardware-in-loop:** one T-1000E flashes cleanly and joins the mesh after unplug/replug.
  5. **Hardware-in-loop:** at least one Recommended ESP32 still flashes with no copy or UX regression from the router split.

**Plans**: TBD (~1-2 plans).
**UI hint**: yes.

### Phase 26: Header/Nav UX Refresh

**Goal**: The run.defcon.run header has no dead links — Leaderboard is gone, Maps → gpx.defcon.run, Meshtastic → a real in-app "this or that" landing page offering flash.defcon.run and mqtt.defcon.run, and CMS-group members see a CMS link.
**Depends on**: none (independent of v1.4/v1.4.1/v1.5).
**Success Criteria** (what must be TRUE):

  1. Leaderboard removed from both `header.tsx` navItems and `dropdown-menu.tsx`; unused `FaTrophy` import dropped.
  2. New public route `src/app/(public)/meshtastic/page.tsx` renders two tiles — Flash & Join → `https://flash.defcon.run`, Network → `https://mqtt.defcon.run` — in the existing glass-card/teal (#00d4aa)/MuseoModerno design language, responsive (side-by-side desktop, stacked mobile).
  3. Header + hamburger Meshtastic links resolve to the new route (no 404); Maps still → gpx.defcon.run.
  4. A "CMS" link → `https://cms.defcon.run` appears in the user dropdown ONLY when `session.user.services.includes('cms')`.

**Plans**: TBD (~1-2 plans).
**UI hint**: yes.

### Phase 27: CMS Incognito SSO Fix

**Goal**: A fresh/incognito visit to cms.defcon.run redirects straight to SSO with no native-login flash, and after a valid `cms`-service login a reload stays authenticated instead of showing "Access Denied".
**Depends on**: none (separate app from Phase 26).
**Success Criteria** (what must be TRUE):

  1. Cold incognito load of `/{region}/admin` auto-redirects to SSO — the redirect fires on SPA navigation to the login route, not only at module load (`apps/run.cms/app/src/admin/app.tsx`).
  2. Repro instrumented to disambiguate the reload "Access Denied" cause: OIDC session/refresh cookie (`sameSite`/`secure`) drop vs. genuinely-missing `cms` service claim.
  3. Root cause from (2) fixed; valid `cms` user reloads the admin panel with no access-denied.
  4. Verified on both region prefixes (`/use1/admin`, `/cac1/admin`).

**Plans**: TBD (~1-2 plans).
**UI hint**: minimal (mostly auth/cookie plumbing; Part A is a redirect-timing fix).

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 14. Infrastructure Foundation | v1.3 | 3/3 | Complete | 2026-03-07 |
| 15. Container Images + Task Definition | v1.3 | 3/3 | Complete | 2026-03-07 |
| 16. Build/Deploy Pipeline | v1.3 | 2/2 | Complete | 2026-03-07 |
| 17. Meshmap Verification + Branding | v1.3 | 1/1 | Complete | 2026-03-07 |
| 18. Build-Time Firmware & Device List Refresh | v1.4 | 0/3 | Planned | - |
| 19. Dependencies & DCR34 Branding/UX | v1.4 | 0/2 | Planned | - |
| 20. Bib Infrastructure Foundation | v1.5 | 0/2 | Planned | - |
| 21. Bib App Scaffold + Registration | v1.5 | 0/2 | Planned | - |
| 22. Bib Payments (Cash + Stripe + PayPal/Venmo) | v1.5 | 0/3 | Planned | - |
| 23. Bib Build/Deploy + Branding | v1.5 | 0/1 | Planned | - |
| 24. Device-family router + nRF52 flash path | v1.4.1 | 0/TBD | Planned | - |
| 25. nRF52 UX + verification | v1.4.1 | 0/TBD | Planned | - |
| 26. Header/Nav UX Refresh | v1.6 | 0/TBD | Planned | - |
| 27. CMS Incognito SSO Fix | v1.6 | 0/TBD | Planned | - |

### Phase 33: OIDC Silent SSO

**Goal:** Make the OIDC redirect flow invisible for an already-authenticated user and let a relying party obtain an authorization code silently once the user is logged in anywhere under `*.defcon.run`, while preserving full OIDC semantics (auth code, PKCE, per-client id_token, consent). Approach A: invisible IdP interaction + hidden-iframe `prompt=none` bridge in the three NextAuth RPs (gpx, flash, bib). `run.cms` out of scope.
**Requirements**: SSO-01 (repoint interactions.url to server interaction route), SSO-02 (custom loadExistingGrant auto-consent first-party allowlist), SSO-03 (remember:true persist provider _session), SSO-04 (RP hidden-iframe silent-SSO unit, authored once), SSO-05 (unit placed identically in gpx/flash/bib + parity test), SSO-06 (IdP integration tests), SSO-07 (RP unit pure-logic tests), SSO-08 (e2e: full gpx + smoke flash/bib)
**Depends on:** existing run.auth OIDC provider + run.gpx/flash/bib NextAuth RPs (no prior phase dependency)
**Plans:** 6/6 plans complete

Plans:

- [x] 33-01-PLAN.md — IdP: repoint interactions.url + loadExistingGrant factory + remember:true + unit test (SSO-01/02/03)
- [x] 33-02-PLAN.md — RP silent-SSO unit authored canonically in run.gpx + mount + pages.error (SSO-04)
- [x] 33-03-PLAN.md — Replicate unit byte-identically into run.flash + run.bib + mount each (SSO-05)
- [x] 33-04-PLAN.md — IdP integration tests (prompt=none flows + interaction render split) (SSO-06)
- [x] 33-05-PLAN.md — Parity test + pure-logic unit tests in run.bib vitest (SSO-05/07)
- [x] 33-06-PLAN.md — e2e Playwright: full on gpx, smoke on flash + bib (SSO-08)

### Phase 40: Admin Activity Reports

**Goal:** Operator can see who is doing what (signups, logins, gpx uploads/shares, checkins), how many distinct users/IPs are active, and get tripwire alerts on anomalous activity — all CloudWatch-native, leveraging existing ALB/CloudFront/ECS logs. Pre-con posture: baseline ~zero, any activity is signal.
**Spec:** docs/superpowers/specs/2026-07-05-admin-activity-reports-design.md (approved 2026-07-05)
**Requirements**: AR-01 (logEvent helper), AR-02 (event call sites), AR-03 (admin-reports TF module), AR-04 (metric filters), AR-05 (dashboard), AR-06 (saved queries), AR-07 (tripwire alarms), AR-08 (log retention + Mapbox/Strava quota)
**Depends on:** none (existing logging infra already enabled)
**Plans:** 3/7 plans executed

Deliverables (from spec):

- `logEvent()` structured-event helper in run.auth / run.gpx / run.human (~8 call sites)
- Terraform module `admin-reports/v1.0.0`: metric filters (`DefconRun/Activity`), `admin-reports` dashboard (ALB/CloudFront/event metrics + distinct-active-users + top-IPs widgets), saved `admin/*` Logs Insights queries, SNS tripwire alarms (thresholds in site.hcl), 90d retention on `/ecs/*` log groups
- Mapbox account hardening checklist (URL-restrict token, per-app tokens, spending cap — no usage API exists)
- Strava rate-limit-header metric from strava-sync
- Phase 2 (separate, later): Athena over CloudFront/ALB S3 access logs

Plans:
**Wave 1**

- [x] 40-01-PLAN.md — run.auth logEvent + auth.signup/auth.login (wave 1)
- [x] 40-02-PLAN.md — run.gpx logEvent + 5 gpx events + strava rate-limit line (wave 1)
- [x] 40-03-PLAN.md — run.human logEvent + human.checkin/human.upload (wave 1)
- [ ] 40-04-PLAN.md — admin-reports module: metric filters + 90d retention + admin/* queries + wiring (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 40-05-PLAN.md — Mapbox hardening + reading-the-reports runbook (wave 2)
- [ ] 40-06-PLAN.md — admin-reports dashboard + SNS tripwire alarms (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 40-07-PLAN.md — deploy + prod end-to-end verification checkpoint (wave 3)

**Cross-cutting constraints:**

- logEvent never throws and extracts the first x-forwarded-for hop as ip
