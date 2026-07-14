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
- [ ] **v2.2 Leaderboard & Activity Table** - Phases 49-52 (planned 2026-07-14; hidden, admin-gated DC33-style leaderboard that doubles as each runner's activity table in run.human — `Accomplishment` scoring, client-canvas GPX polyline thumbnails, consumes the CTF judge's `ctfScore`. Spec: `docs/superpowers/specs/2026-07-13-leaderboard-activity-table-design.md`. NOTE: v2.1 / phases 44-48 are the CTF judge worktree `hiddenctfsub`.)

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
| 49. Leaderboard Data Layer — Accomplishment Entity + Scoring | v2.2 | 4/4 | Verified (goal-backward PASS, 31 tests) | 2026-07-14 |
| 50. GPX Integration — Polyline + Internal Accomplishment Endpoint | v2.2 | 0/TBD | Planned | - |
| 51. Leaderboard API — Scan/Rank/Cache + Admin Routes | v2.2 | 0/TBD | Planned | - |
| 52. Leaderboard UI — PolylineRenderer + Accordion + Hidden Page | v2.2 | 0/TBD | Planned | - |

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

### v2.2 Leaderboard & Activity Table (Planned)

**Milestone Goal:** Bring back the DEF CON 33 leaderboard — which doubled as each runner's personal activity table — into run.human, shipping **HIDDEN behind the admin group** (no nav link) so it can be perfected before launch. A signed-in admin sees a ranked HeroUI accordion of runners; expanding a row reveals that runner's DEF CON runs, each with a client-side `<canvas>` map thumbnail drawn from a stored decimated GPX polyline (DC33 `PolylineRenderer` port — no S3/Lambda thumbnail pipeline). Scoring lives in a new `Accomplishment` ElectroDB entity (this board owns check-ins + GPX) rolled up onto `RunUser.activityScore`; the displayed global score sums in the CTF judge's `RunUser.ctfScore` **read-only** (no cross-write — respects the CTF design's §11 boundary). Spec: `docs/superpowers/specs/2026-07-13-leaderboard-activity-table-design.md`. Numbering: CTF judge worktree owns v2.1 / phases 44-48; this milestone is v2.2 / phases 49-52.

### Phase 49: Leaderboard Data Layer — Accomplishment Entity + Scoring

**Goal:** A new `Accomplishment` ElectroDB entity on `run-human-electro` becomes the leaderboard's source of truth for the runs this board owns (check-ins + GPX), with `byType`/`byYear` GSIs mirroring DC33. `RunUser` gains denormalized `activityScore` + `activityCounts{checkin,gpx}` + `latestActivityAt`, bumped atomically **only** via `createAccomplishment`/`deleteAccomplishment` so totals never drift. A pure, unit-tested scoring module defines point constants and the rank comparator, and computes the displayed `globalScore = activityScore + (ctfScore ?? 0)` — reading the CTF judge's rollup off the same `RunUser` row (defaults to 0 until CTF ships). `createCheckIn`/`deleteCheckIn` create/delete the matching `activity` accomplishment (carrying the check-in's `isPrivate`), idempotently.
**Depends on:** none (first phase of v2.2; extends the existing run.human `RunUser` + `CheckIn` entities). Shares the `RunUser` entity edit with the CTF judge worktree — additive, non-conflicting (see spec §5.2).
**Requirements:** LDBR-01 (`Accomplishment` entity: `pk=userId sk=accomplishmentId`, `type`/`source`/`isPrivate`/`metadata{points,polyline,distance,gpxFileId,checkInId}`, `byType`+`byYear` GSIs; `createAccomplishment` writes the row and atomically bumps RunUser rollups; duplicate-guard on `source`+external id), LDBR-02 (`RunUser` += `activityScore`/`activityCounts`/`latestActivityAt`, default-zero, updated only through create/delete helpers; additive-merge-safe with CTF `ctfScore`/`ctfSolves`), LDBR-03 (`lib/leaderboard-scoring.ts`: point constants `{checkin:1,gpx:1,strava:1}`, `globalScore = activityScore + (ctfScore??0)`, rank comparator globalScore→total-count→`latestActivityAt`→`createdAt`; pure + unit-tested), LDBR-04 (check-in hook: `createCheckIn`/`deleteCheckIn` create/delete the `activity` accomplishment carrying `isPrivate`, idempotent), LDBR-12 (CTF read-only: scoring reads `RunUser.ctfScore`/`ctfSolves`; NEVER writes CTF into `Accomplishment` — CTF §11 boundary)
**Success Criteria** (what must be TRUE):

  1. Creating a check-in writes exactly one `activity` `Accomplishment` (source `checkin`, carrying the check-in's `isPrivate`) and atomically raises `RunUser.activityScore` and `activityCounts.checkin`; deleting it reverses both, flooring at 0.
  2. `globalScore` for any `RunUser` equals `activityScore + ctfScore` and degrades to `activityScore` when `ctfScore` is unset — proven by a unit test with and without a CTF rollup on the row.
  3. The rank comparator orders by `globalScore` desc → total activity+ctf count desc → `latestActivityAt` desc → `createdAt` asc, unit-tested across tie cases.
  4. No CTF write path exists in this phase's code — `Accomplishment.source` cannot be `ctf`/`qr`; CTF only enters via the read-time sum.

**Plans:** 4 plans (waves: 1={01,02} parallel, 2={03}, 3={04}) — **BUILT + VERIFIED 2026-07-14** on `gsd/phase-49-leaderboard-data-layer-accomplishment-entity-scoring`. Goal-backward verification PASS (4/4 must-haves; all 4 SCs traced to shipped code). Gates: vitest 31/31, tsc clean (only 2 pre-existing out-of-scope errors, untouched). Landmines clean: additive RunUser edit (no reorder, no `ctfScore`/`ctfSolves`), single-writer rollup, no CTF write path. Accepted deviation: a `strava`-source accomplishment persists but does not bump the rollup (Strava reserved this milestone).

Plans:
- [x] 49-01-PLAN.md — RunUser rollups: `activityScore`/`activityCounts`/`latestActivityAt` + `updateRunUserActivityCounts` (LDBR-02) [wave 1] — vitest 4/4
- [x] 49-02-PLAN.md — Pure scoring module `lib/leaderboard-scoring.ts`: POINTS, `globalScore`, rank comparator (LDBR-03, LDBR-12) [wave 1] — vitest 12/12
- [x] 49-03-PLAN.md — `Accomplishment` entity + `createAccomplishment`/`getAccomplishmentsByUser`/`deleteAccomplishment` + dup-guard (LDBR-01, LDBR-12) [wave 2] — vitest 10/10
- [x] 49-04-PLAN.md — Check-in hook: `createCheckIn`/`deleteCheckIn` create/delete the activity accomplishment, idempotent (LDBR-04) [wave 3] — vitest 5/5

### Phase 50: GPX Integration — Polyline Extraction + Internal Accomplishment Endpoint

**Goal:** GPX uploads (owned by the separate `run.gpx` service) become leaderboard accomplishments without coupling run.human to run.gpx's table. On GPX activation (`confirm/route.ts`, after the status flip, only when the file has an individual owner — skip `GLOBAL` community files), `run.gpx` fetches the full GPX body from S3, decimates the parsed track to a ~100-point `{lat,lng}` polyline (in-memory), and POSTs an accomplishment payload to a new secret-gated internal endpoint on run.human. That endpoint validates `AUTH_INTERNAL_SECRET`, resolves the caller's raw OIDC `sub` → run.human `RunUser.userId` via the `authjs` accounts GSI1 bridge, and calls the **already-built** `createAccomplishment` (source `gpx`, idempotent on `gpxFileId`, points `POINTS.gpx`). Notify failure is non-fatal to the upload. **Scope simplification (YAGNI, decided from the seam explore): the decimated polyline is computed in-memory and sent to run.human where it persists on the `Accomplishment.metadata.polyline` (already exists) — NO new `GpxFile.polyline` attribute / run.gpx schema change.**
**Depends on:** Phase 49 (`Accomplishment` entity + `createAccomplishment` + `POINTS` — already gpx-ready: `source:"gpx"`, `metadata.polyline`, idempotency all present).
**Requirements:** LDBR-05 (`run.gpx` confirm-route hook: fetch full GPX body from S3 + decimate to ~100-point `{lat,lng}` polyline in-memory + POST to run.human via `RUN_HUMAN_INTERNAL_URL` + `X-Internal-Secret`; skip `GLOBAL` files; non-fatal on failure; reuse the haversine/trkpt-regex from `seed-local-routes.ts` + write the new downsample step; NO `GpxFile` schema change), LDBR-06 (run.human `POST /api/internal/accomplishment`: `AUTH_INTERNAL_SECRET` gate, extract a shared exported `getAdapterUserIdBySub` from the private duplicate in `internal/user/[oidcSub]/route.ts`, idempotent on `gpxFileId` via existing `createAccomplishment`, drops with a log when no `RunUser` exists for the sub)
**Success Criteria** (what must be TRUE):

  1. Activating a non-`GLOBAL` GPX file produces exactly one `gpx` `Accomplishment` for the owning run.human `RunUser` (carrying a decimated `metadata.polyline` + distance/elevation), raising `activityScore` + `activityCounts.gpx`.
  2. Re-sending the same `gpxFileId` is a no-op (no double-score) — idempotency proven by test.
  3. The internal endpoint rejects a wrong/absent `AUTH_INTERNAL_SECRET` and correctly maps OIDC `sub` → adapter `userId`; a `sub` with no run.human `RunUser` is dropped with a log, not errored.
  4. A GPX-notify failure (or a `GLOBAL` file) leaves the upload/save successful (best-effort, never blocks the user); `GLOBAL` files produce no accomplishment.

**Plans:** 2 plans (waves: 1={01}, 2={02}) — endpoint contract first, then the run.gpx hook that POSTs to it.

Plans:
- [ ] 50-01-PLAN.md — run.human `POST /api/internal/accomplishment` (secret gate + shared `getAdapterUserIdBySub` + pure payload builder → existing `createAccomplishment`) (LDBR-06) [wave 1]
- [ ] 50-02-PLAN.md — run.gpx confirm-route hook: full S3 fetch + pure decimate-to-≤100-`{lat,lng}` + best-effort POST to run.human, skip `GLOBAL`, non-fatal (LDBR-05) [wave 2]

### Phase 51: Leaderboard API — Scan/Rank/Cache + Admin-Gated Routes

**Goal:** Two admin-gated read APIs back the board. `GET /api/leaderboard` scans `RunUser`, computes `globalScore` per row, assigns `globalRank` over the full sorted list (filter narrows display, not rank), paginates, and caches for 60s with stale-while-revalidate (DC33 parity). `GET /api/leaderboard/[userId]/accomplishments` lazily returns a runner's runs (incl. `polyline` metadata). Both use `requireAdmin` → 404 on denial; no privacy filter now (admin-only surface), with the filter hook point marked for launch.
**Depends on:** Phase 49 (reads `RunUser` rollups). Soft on Phase 50 for GPX runs to appear, but ranks correctly without it.
**Requirements:** LDBR-07 (`GET /api/leaderboard`: `scanAllRunUsers` → `globalScore` → `globalRank` over full sorted list → paginate; 60s cache + stale-while-revalidate; `requireAdmin`→404; count chips from `activityCounts`+`ctfSolves`), LDBR-08 (`GET /api/leaderboard/[userId]/accomplishments`: admin-gated, returns runs incl. polyline metadata; no privacy filter now with the filter hook point marked)
**Success Criteria** (what must be TRUE):

  1. A non-admin session receives 404 on both routes; an admin session gets JSON; entry revalidates fresh admin claims.
  2. `globalRank` is assigned over the full sorted user set and is stable under a `filter` that narrows the returned page.
  3. Repeated calls within 60s are served from cache; a stale entry is served while a refresh runs (no request blocks on the scan).
  4. The per-user route returns a runner's accomplishments including `metadata.polyline` for GPX/check-in runs.

### Phase 52: Leaderboard UI — PolylineRenderer + Accordion + Hidden Admin Page

**Goal:** The DC33 look, ported. `PolylineRenderer` draws a client `<canvas>` — one OpenStreetMap tile + the decoded polyline + green-start/red-end dots + a dark-mode filter. `LeaderboardTable` is a HeroUI accordion: each row shows `globalRank` / `globalScore` 🥕 / display name / count chips, the current admin's own row highlighted, with search + fast-filter chips and pagination; expanding a row lazy-loads that runner's runs with thumbnails. Runner-class emoji derive from `RunUser.mqttUsertype`. The page lives at `(protected)/leaderboard/page.tsx`, gated `requireAdmin` → `notFound()` (+ `revalidateAdmin` on entry) and **linked from no navigation** — hidden until launch.
**Depends on:** Phase 51 (consumes the leaderboard API).
**Requirements:** LDBR-09 (`PolylineRenderer` client-canvas thumbnail: OSM tile + route + start/end dots + dark-mode; DC33 port), LDBR-10 (`LeaderboardTable` accordion: rank/`globalScore`/name/count chips, current-user highlight, search + filter chips, pagination, expand→runs with thumbnails; runner-class emoji from `mqttUsertype`), LDBR-11 (hidden admin page `(protected)/leaderboard/page.tsx`: `requireAdmin`→`notFound()` + `revalidateAdmin` on entry; NOT linked in any nav/header/dropdown)
**Success Criteria** (what must be TRUE):

  1. A non-admin visiting `/leaderboard` gets a 404 (page not advertised); an admin sees the ranked accordion.
  2. The board renders no navigation entry anywhere — header, dropdown, or profile — grep-verifiable.
  3. Expanding a row renders each run's `<canvas>` thumbnail from its stored polyline (OSM tile + route + start/end dots), with the current admin's own row highlighted.
  4. Rank/score/count chips match the API's `globalScore`/`globalRank`/counts, and runner-class emoji reflect `mqttUsertype`.

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
