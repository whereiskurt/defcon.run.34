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
- [x] **v1.9 CMS-Driven UI Copy Catalog** - Phases 35-39 (shipped 2026-07-06; edit UI copy live from Strapi, no deploy — SC-3 de-dup proven live)
- [ ] **v2.0 Admin & Reporting** - Phase 43 (planned 2026-07-11; read-only run.human /admin dashboard — users, activity, gpx usage)
- [ ] **v2.1 CTF Judge & Scoring** - Phases 44-48 (planned 2026-07-14; greenfield Phase-5 CTF judge + composed scoring + covert CSS submission channel — design `docs/superpowers/specs/2026-07-13-ctf-judge-and-covert-channel-design.md`; integration-bounded against the DC33 total-score work in the `leaderboard` worktree)

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
| 35. CMS Copy Catalog Foundation | v1.9 | 3/3 | Complete    | 2026-07-05 |
| 36. Runtime Copy Toolkit | v1.9 | 3/3 | Complete   | 2026-07-05 |
| 37. Bib Donate/Sponsor Proof Surface | v1.9 | 6/6 | Complete   | 2026-07-06 |
| 38. Custom Copy Admin Plugin | v1.9 | 3/3 | Complete   | 2026-07-06 |
| 39. Copy Migration — Remaining Bib + Shared Chrome | v1.9 | 6/6 | Complete   | 2026-07-06 |
| 43. run.human Admin Reporting Dashboard | v2.0 | 5/5 | Built — live-smoke verified | - |
| 44. CTF Judge Core + Scoring Engine + Data Model | v2.1 | 0/3 | Planned | - |
| 45. Visible QR Claim Page | v2.1 | 0/TBD | Planned | - |
| 46. Covert CSS Channel + Park-and-Claim | v2.1 | 0/TBD | Planned | - |
| 47. Admin CTF CRUD Fields + CTF Leaderboard | v2.1 | 0/TBD | Planned | - |
| 48. CloudFront + Integration Exposure | v2.1 | 0/TBD | Planned | - |

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

---

### v2.0 Admin & Reporting (Planned)

### Phase 43: run.human Admin Reporting Dashboard

**Goal:** Admins (users with `"admin"` in `services`) get a read-only dashboard at `run.defcon.run/admin` that lists run.human users with sign-up, activity, and gpx-usage signals — designed to surface who signed up and who is actively using gpx/services. Email is searchable but masked on screen. Design spec: `docs/superpowers/specs/2026-07-11-run-human-admin-dashboard-design.md`.
**Depends on:** existing run.auth OIDC `services` claim + run.human Auth.js session (no prior phase dependency); reuses the `services.includes("admin")` gate pattern from run.bib `admin-gate.ts`.
**Requirements**: ADMN-01 (admin-only gate: `services.includes("admin")` + synchronous fresh-claims revalidation on `/admin` entry; non-admin → 404), ADMN-02 (user list from `RunUser` scan with displayName/signup/last-login/last-activity/check-in attributes), ADMN-03 (email masked-by-default, server-side search, reveal-on-click; sourced from the run.human Auth.js adapter table), ADMN-04 (per-user gpx usage — `gpx_upload`/`gpx_save`/`gpx_share` consumption — via a new read-only bulk quota endpoint on run.auth over the existing `byQuotaRemaining` GSI), ADMN-05 (runner QR URL + bib `runnerCode` columns, resolved without per-row N fan-out), ADMN-06 (summary tiles + sortable/paginated table; sort by gpx usage, signup, last activity), ADMN-07 (CSV export of the current filtered/sorted view, admin-gated, full emails)
**Success Criteria** (what must be TRUE):

  1. A non-admin session (no `"admin"` in `services`) receives a 404 on both the `/admin` page and its API routes; an admin session gets the dashboard. A session whose cached JWT claims admin but whose fresh run.auth claims do not is denied on entry (revalidation closes the ~5-min staleness window).
  2. The dashboard lists run.human users with sign-up date, last login, last activity, and check-in counts, sortable and paginated, defaulting to most-recently-active.
  3. Emails are masked on screen by default; an admin can search by full email to filter to a user and reveal an individual email on demand — no full-email column is rendered unrevealed.
  4. Each user row shows gpx usage (routes/saves/shares) sourced in bulk (one query per quota type, not per-user fan-out), and the list can be sorted by gpx usage across all users to surface heavy users.
  5. Each row shows the runner's QR URL (`https://run.<domain>/<region>/r?h=<hash>`) and bib `runnerCode` (blank when absent).
  6. An admin can export the current filtered/sorted table to CSV (full emails, QR URLs, bib codes).

**Plans:** 5 plans (waves: 1={01,02,03} parallel, 2={04}, 3={05}) — **BUILT + LIVE-SMOKE-VERIFIED 2026-07-11 on `gsd/phase-43-work`.** Ran run.human locally against the REAL `run-human-electro`/`authjs` tables (dc34 creds + a dev-only revalidate bypass, since reverted): `/admin` rendered 46 real users (masked emails, bib codes, QR URLs, activity); `/admin` + `/api/admin/users` returned **404 without a session / 200 with an admin session**; CSV export streamed a dated attachment. Left for full sign-off: gpx columns with run.auth running, and interactive reveal/search/sort clicks.

Plans:

- [x] 43-01-PLAN.md — run.auth read-only bulk quota-by-type endpoint over the existing `byQuotaRemaining` GSI (`listQuotaByType` + internal-secret gate) (ADMN-04) — vitest 4/4
- [x] 43-02-PLAN.md — run.human shared admin gate (`isAdmin`/`requireAdmin`, no allowlist) + `revalidateAdmin` (synchronous fresh-claims, fail-closed); denial → 404 (ADMN-01)
- [x] 43-03-PLAN.md — run.human fan-out-free read helpers: `scanAllRunUsers`, `scanAllUploads`, authjs email + `scanAccountSubs`, `scanRunnerCodesBySub`, `getQuotaByType` (ADMN-02/03/04/05)
- [x] 43-04-PLAN.md — admin-report assembly (join + `maskEmail` + `toCsv` + `runnerQrUrl` + tiles) + `/api/admin/users` (404 gate, masked JSON, per-row reveal, `?q` search, sort, paginate, `?format=csv`) (ADMN-02/03/04/05/06/07) — vitest 16/16
- [~] 43-05-PLAN.md — `/admin` page (server component): gate-on-entry → `notFound()`, tiles, sortable/paginated masked table, reveal, search, Download CSV. Code BUILT + tsc-clean; **human-verify checkpoint (live admin login → dashboard, non-admin → 404) PENDING** (ADMN-01/06/07)

**Mid-build fix (not in original plans):** exposed `session.user.authUserId` (OIDC sub) in `config/auth.ts` — the gate must revalidate with the OIDC sub, not the adapter `session.user.id`, or it fails closed for real admins (known auth ID namespace mismatch).

**Known v1 gap:** the `services` column renders empty — `buildUserReport` sets `services: []` (services live on the Auth.js session / run.auth AuthProfile, not on any bulk read helper). Follow-up: add a run.auth bulk-services read (mirror the gpx bulk endpoint) to populate it.

---

### v2.1 CTF Judge & Scoring (Planned)

Greenfield build of the Phase-5 CTF judge. Today q.defcon.run only *forwards* `/ctf/<challenge>/<value>` → `run.defcon.run/use1/ctf/claim` (which 404s); nothing validates, scores, or tracks solves. This milestone builds the judge, a composed scoring model, per-user solve tracking, a covert always-`200 text/css` submission channel, and a CTF-only admin leaderboard. Design spec: `docs/superpowers/specs/2026-07-13-ctf-judge-and-covert-channel-design.md`.

**Waves:** 1 = {44} · 2 = {45, 46, 47} parallel · 3 = {48}.
**Integration boundary:** expose `ctfScore`/`CtfSolve` for the separate DC33 total-score migration (`leaderboard` worktree); do NOT build the global leaderboard here.

### Phase 44: CTF Judge Core + Scoring Engine + Data Model

**Goal:** The greenfield judge foundation everything else depends on — data model, scoring math, and the `judgeSolve` core — all attributed to the signed-in `RunUser` (`session.user.authUserId`), on the shared `run-human-electro` table, idempotent and cap-safe under concurrency.
**Depends on:** existing run.human `electroClient` + the resolver's `Ctf` entity mirror pattern (no prior phase dependency).
**Requirements:** CTF-01 (`Ctf` extended: `answerHash`, `pointMax`, `pointFloor`, `maxSolves`, `firstBloodBonus`, `timeTiers[]`, `solveCount`; new `CtfSolve` (pk `$run#challenge_<c>` / sk `$ctfsolve_1#user_<sub>`, gsi1 by user) + `CtfPending` (nonce, TTL) entities; `RunUser.ctfScore`/`ctfSolves`; ElectroDB key-parity with resolver mirror), CTF-02 (`computePoints(n, ctf)`: active time-tier ceiling sets the max; linear per-solve decline from ceiling→floor across `N`; `+firstBloodBonus` when `n==1`; `n>N`→0), CTF-03 (`judgeSolve`: attempt-cap/rate-limit → hashed-answer validate → conditional-put `CtfSolve` [idempotent claim] → atomic `ADD solveCount` ordinal → score → `ADD RunUser.ctfScore/ctfSolves`), CTF-04 (hygiene: answers stored salted-hashed; raw guess NEVER logged — extend the resolver's `ctfHandoffLog` no-value invariant to the judge).
**Success Criteria:**
  1. `computePoints` is correct across tier boundaries, first-blood (`n==1`), cap edges (`n==N`, `n==N+1`, `N==1`), and floor/ceiling.
  2. Concurrency/idempotency proven by test: same-user double-submit scores once (still returns prior points), distinct concurrent users get distinct gap-free ordinals, replay never double-scores.
  3. No plaintext answer and no raw guess is ever persisted or logged.
**Plans:** 3 plans (waves: 1={44-01 entities, 44-02 scoring+hashing} parallel, 2={44-03 judge})

Plans:

- [ ] 44-01-PLAN.md — Data model: extend `Ctf` (answerHash/pointMax/pointFloor/maxSolves/firstBloodBonus/timeTiers/solveCount, keep legacy `answer`) + new `CtfSolve`/`CtfPending`/`CtfAttempt` entities + `RunUser.ctfScore`/`ctfSolves` + key-parity tests (CTF-01)
- [ ] 44-02-PLAN.md — Pure primitives: `computePoints`/`activeTierCeiling` scoring engine (injectable clock) + `hashAnswer`/`verifyAnswer` salted-hash seam + boundary tests (CTF-02, CTF-04)
- [ ] 44-03-PLAN.md — `judgeSolve` core (injectable `CtfStore` seam, locked 7-step claim-then-allocate flow, never-throw) + `ctfJudgeLog` no-value hygiene builder + concurrency/idempotency/hygiene tests (CTF-03, CTF-04)

### Phase 45: Visible QR Claim Page

**Goal:** Build `run.defcon.run/use1/ctf/claim` (currently 404) — the honest, visible front door for physical QR scans that q.defcon.run 302-forwards to.
**Depends on:** Phase 44 (`judgeSolve`, data model).
**Requirements:** CTF-05 (`/use1/ctf/claim` route: read session → `judgeSolve` → render visible solved / points / first-blood result), CTF-06 (unauth claim parks the flag against a nonce + prompts sign-in; on the next signed-in visit the parked nonce is claimed and credited exactly once).
**Success Criteria:**
  1. Signed-in + correct flag → visible award (points, first-blood when applicable); wrong/disabled → graceful non-award page.
  2. Unauth scan → parks the flag + prompts sign-in; the later signed-in claim credits exactly once (never double).
**Plans:** TBD.

### Phase 46: Covert CSS Channel + Park-and-Claim

**Goal:** The clandestine in-page submission path — an always-`200 text/css` asset on run.defcon.run whose response is indistinguishable in the network tab, carrying the award ack inside the CSS body, wired to the `!!!` easter-egg trigger and a DC33-style celebration.
**Depends on:** Phase 44 (`judgeSolve`, `CtfPending`).
**Requirements:** CTF-07 (always-`200 text/css` endpoint; `v=` param decodes a reversible, build-date-plausible numeric flag; unknown/wrong/unauth → plain decoy sheet), CTF-08 (award ack = an innocuous CSS custom property; identical HTTP status, `Content-Type`, and ≈body-size across win/wrong/unauth; no differential logging — invisibility invariants), CTF-09 (egg-side client: `!!!` trigger injects the `<link>`, reads the marker via `getComputedStyle` → DC33 celebration [rain + effects] on win only; unauth path parks a nonce for later credit).
**Success Criteria:**
  1. Covert curl matrix (signed-in-win / signed-in-wrong / unauth) is indistinguishable except for the value buried in the CSS body; no auth/win/flag tell in status, headers, size, or logs.
  2. The `getComputedStyle` read fires the celebration on a genuine win only; an unauth win parks a nonce that credits on the next signed-in visit.
**Plans:** TBD.

### Phase 47: Admin CTF CRUD Fields + CTF Leaderboard

**Goal:** Extend the existing `/admin/qr` CTF CRUD with the new scoring fields (hash-on-save) and build the CTF-only leaderboard reachable at `q.defcon.run/admin/leaderboard`.
**Depends on:** Phase 44 (data model). Parallel-safe with 45/46.
**Requirements:** CTF-10 (`CtfForm` extended: `pointMax`/`pointFloor`, `maxSolves`, `firstBloodBonus`, `timeTiers[]` via the existing datetime-local + preset-chip picker; answer hashes on save — plaintext never persisted; one-time migration of existing `Ctf.answer` plaintext → `answerHash`), CTF-11 (CTF-only leaderboard: rank users by `RunUser.ctfScore`, drill into a challenge's `CtfSolve` rows [user, ordinal, points, first-blood, channel, time]; admin-gated; optional CSV with the OWASP formula-injection guard).
**Success Criteria:**
  1. CTF CRUD round-trips all new fields; existing `Ctf` rows are migrated to `answerHash` with no plaintext left.
  2. The leaderboard ranks by `ctfScore` and drills into `CtfSolve` under the existing `ADMIN_GROUPS` gate.
**Plans:** TBD.

### Phase 48: CloudFront + Integration Exposure

**Goal:** Wire the mixed-origin CloudFront so the covert path and the q-hosted admin leaderboard actually resolve correctly and uncached, and expose the CTF signal the DC33 total-score mapper consumes.
**Depends on:** Phases 46 (covert path) + 47 (admin route/leaderboard).
**Requirements:** CTF-12 (CloudFront covert-path behavior: routes to the app/ALB origin [not an S3/`*.css` static behavior], `CachingDisabled`, forwards the session cookie; verify no higher-precedence extension behavior intercepts), CTF-13 (`q.defcon.run/admin/*` → run.human ALB origin behavior [cookie-forward, no-cache] so `q.defcon.run/admin/leaderboard` renders under run.human's `ADMIN_GROUPS` gate without turning the resolver into an app server), CTF-14 (document + expose the `ctfScore`/`CtfSolve` read for the DC33 total-score migration; do NOT build the global board).
**Success Criteria:**
  1. Live curl matrix: the covert path hits the app origin, is uncached, forwards the cookie, and differs only in the CSS body across signed-in-vs-not / right-vs-wrong.
  2. `q.defcon.run/admin/leaderboard` renders under the admin gate; the CTF signal is documented and queryable by the DC33 mapper.
**Plans:** TBD (terraform + live verification).

---

<details>
<summary>v1.9 CMS-Driven UI Copy Catalog (Phases 35-39) - SHIPPED 2026-07-06</summary>

See `.planning/milestones/v1.9-ROADMAP.md` for the archived v1.9 roadmap and
`.planning/milestones/v1.9-REQUIREMENTS.md` for the requirements record.

Edit static UI copy live from Strapi with no deploy: a single `ui-string` catalog
served through a cached, fallback-safe copy toolkit, edited via a custom three-column
admin page, proven on bib donate/sponsor and unified across the shared `common.*` chrome.
SC-3 de-dup proven live on prod 2026-07-06 (one CMS edit changed run.defcon.run in ~2min,
no deploy). Deferred to v2: MIGR-04 (flash/human/auth/gpx migration), I18N-01 (locales).

- [x] Phase 35: CMS Copy Catalog Foundation (3/3 plans) — 2026-07-05
- [x] Phase 36: Runtime Copy Toolkit (3/3 plans) — 2026-07-05
- [x] Phase 37: Bib Donate/Sponsor Proof Surface (6/6 plans) — 2026-07-06
- [x] Phase 38: Custom Copy Admin Plugin (3/3 plans) — 2026-07-06
- [x] Phase 39: Copy Migration — Remaining Bib + Shared Chrome (6/6 plans) — 2026-07-06

</details>
