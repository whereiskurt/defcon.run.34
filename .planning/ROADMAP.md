# Roadmap: DEF CON Run 34

## Milestones

- [x] **v1.0 Meshtastic Flasher MVP** - Phases 1-4 (shipped 2026-03-02)
- [x] **v1.1 CMS Content Types** - Phases 5-9 (shipped 2026-03-05)
- [x] **v1.2 User Checkins** - Phases 10-13 (shipped 2026-03-06)
- [x] **v1.3 Meshtk Integration** - Phases 14-17 (shipped 2026-07-01)
- [ ] **v1.4 Flash Service Refresh** - Phases 18-19 (in progress — code shipped 2026-07-01, hardware verification pending)
- [ ] **v1.4.1 nRF52840 / T-1000E Flash Support** - Phases 24-25 (planned, parallel-safe with v1.5)
- [x] **v1.5 Bib Registration** - Phases 20-23 (shipped 2026-07-03; bib.defcon.run live, first release v0.0.18)
- [ ] **v1.6 Header & Meshtastic UX Refresh** - Phases 26-27 (planned 2026-07-02)
- [ ] **v1.7 GPX Routes — Private Collection, Public Overlay & Strava Sync** - Phases 28-32 (autonomous build authorized 2026-07-02; workstream `v1-7-gpx-routes`, parallel-safe)
- [x] **v1.9 CMS-Driven UI Copy Catalog** - Phases 35-39 (shipped 2026-07-06; edit UI copy live from Strapi, no deploy — SC-3 de-dup proven live)
- [ ] **v2.0 Admin & Reporting** - Phase 43 (planned 2026-07-11; read-only run.human /admin dashboard — users, activity, gpx usage)
- [ ] **v2.1 CTF Judge & Scoring** - Phases 44-48 (**BUILT autonomously 2026-07-14, PR open — NOT merged/deployed**; greenfield Phase-5 CTF judge + composed scoring + covert CSS submission channel — design `docs/superpowers/specs/2026-07-13-ctf-judge-and-covert-channel-design.md`; ~122 CTF unit tests + `next build` pass; Phase-48 CloudFront/Terraform authored + validate-clean but NOT applied, deploy-specs accompany; integration-bounded against the DC33 total-score work in the `leaderboard` worktree)
- [x] **v2.3 CTF Flag Types & Form Redesign** - Phase 53+ (planned 2026-07-14; extends the shipped CTF judge into multiple answer types — Static + Rotating OTP + repeatable ledger + reward-effect return — plus an admin form redesign. Slice 1a = Phase 53 [backend, no UI]; Slices 1b/2/3 become later phases. Design: `docs/superpowers/specs/2026-07-14-ctf-flag-types-and-form-redesign-design.md`) (completed 2026-07-15)
- [ ] **v2.2 Leaderboard & Activity Table** - Phases 49-52 (**ALL 4 PHASES BUILT + VERIFIED 2026-07-14**, code goal-backward PASS; ships HIDDEN behind the admin group. Hidden, admin-gated DC33-style leaderboard that doubles as each runner's activity table in run.human — `Accomplishment` scoring, client-canvas GPX polyline thumbnails, consumes the CTF judge's `ctfScore`. ~104 tests. LEFT: 1 local-browser render checkpoint (signed-in admin) + `npm run build`. Spec: `docs/superpowers/specs/2026-07-13-leaderboard-activity-table-design.md`. NOTE: v2.1 / phases 44-48 are the CTF judge worktree `hiddenctfsub`.)

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

<details>
<summary>v1.5 Bib Registration (Phases 20-23) - SHIPPED 2026-07-03</summary>

See `.planning/milestones/v1.5-ROADMAP.md` for the archived v1.5 roadmap and `.planning/milestones/v1.5-phases/` for phase artifacts. Accomplishments summarized in `.planning/MILESTONES.md`.

- [x] Phase 20: Infrastructure Foundation (2/2 plans) — ACM/CloudFront, ECR, service.hcl, SSM, shared electro table
- [x] Phase 21: App Scaffold + Bib Registration — Next.js scaffold, Bib/BibReconcile entities, /api/bib, gpx auth pattern, DC34 bib preview
- [x] Phase 22: Payments — Stripe Checkout (2 products) + Venmo/CashApp + custom-amount slider + SES→Haiku reconciliation Lambda (diverged from the planned provider-seam/tiers/PayPal design)
- [x] Phase 23: Build/Deploy + Branding — run.bib wired into build/deploy/release + buildpub/deploy, live at bib.defcon.run (v0.0.18), iterated through feedback batches 1-3

</details>

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
| 44. CTF Judge Core + Scoring Engine + Data Model | v2.1 | 3/3 | Built — 44/44 tests green | 2026-07-14 |
| 45. Visible QR Claim Page | v2.1 | 2/2 | Built — 61/61 CTF tests green | 2026-07-14 |
| 46. Covert CSS Channel + Park-and-Claim | v2.1 | 4/4 | Built — 96/96 CTF tests green | 2026-07-14 |
| 47. Admin CTF CRUD Fields + CTF Leaderboard | v2.1 | 3/3 | Built — 164/164 CTF tests green | 2026-07-14 |
| 48. CloudFront + Integration Exposure | v2.1 | 3/3 | Built (authored + terraform-validate; NOT applied — deploy-specs for human apply) | 2026-07-14 |
| 49. Leaderboard Data Layer — Accomplishment Entity + Scoring | v2.2 | 4/4 | Verified (goal-backward PASS, 31 tests) | 2026-07-14 |
| 50. GPX Integration — Polyline + Internal Accomplishment Endpoint | v2.2 | 2/2 | Verified (goal-backward PASS, 21 tests) | 2026-07-14 |
| 51. Leaderboard API — Scan/Rank/Cache + Admin Routes | v2.2 | 3/3 | Verified (goal-backward PASS, 29 tests) | 2026-07-14 |
| 52. Leaderboard UI — PolylineRenderer + Accordion + Hidden Page | v2.2 | 3/3 | Verified (code PASS; 1 local-browser checkpoint) | 2026-07-14 |
| 53. CTF Flag Types — Slice 1a Backend (Answer-Type Framework + Rotating OTP) | v2.3 | 4/4 | Built + code-reviewed | 2026-07-15 |
| 54. CTF Flag Types — Slice 1b Frontend (Admin Form Redesign + otp-enroll Reward) | v2.3 | 4/4 | Complete   | 2026-07-15 |
| 55. CTF Flag Types — Slice 2 Scoring Windows (Day/Time/TZ Gating + DEF CON Run-Hours Quick Set) | v2.3 | 3/3 | Complete   | 2026-07-15 |
| 56. CTF Flag Types — Slice 3 Wordlist One-Time Codes (CtfCode Entity + Atomic Single-Use Claim) | v2.3 | 3/3 | Complete   | 2026-07-15 |
| 65. CTF Single-Use OTP Flag Option (Judge-Enforced First-Come Claim) | v2.3.1 | 3/3 | Built — 451 CTF/admin tests green | 2026-07-18 |

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

- [x] 44-01-PLAN.md — Data model: extend `Ctf` (answerHash/pointMax/pointFloor/maxSolves/firstBloodBonus/timeTiers/solveCount, keep legacy `answer`) + new `CtfSolve`/`CtfPending`/`CtfAttempt` entities + `RunUser.ctfScore`/`ctfSolves` + key-parity tests (CTF-01)
- [x] 44-02-PLAN.md — Pure primitives: `computePoints`/`activeTierCeiling` scoring engine (injectable clock) + `hashAnswer`/`verifyAnswer` salted-hash seam + boundary tests (CTF-02, CTF-04)
- [x] 44-03-PLAN.md — `judgeSolve` core (injectable `CtfStore` seam, locked 7-step claim-then-allocate flow, never-throw) + `ctfJudgeLog` no-value hygiene builder + concurrency/idempotency/hygiene tests (CTF-03, CTF-04)

### Phase 45: Visible QR Claim Page

**Goal:** Build `run.defcon.run/use1/ctf/claim` (currently 404) — the honest, visible front door for physical QR scans that q.defcon.run 302-forwards to.
**Depends on:** Phase 44 (`judgeSolve`, data model).
**Requirements:** CTF-05 (`/use1/ctf/claim` route: read session → `judgeSolve` → render visible solved / points / first-blood result), CTF-06 (unauth claim parks the flag against a nonce + prompts sign-in; on the next signed-in visit the parked nonce is claimed and credited exactly once).
**Success Criteria:**

  1. Signed-in + correct flag → visible award (points, first-blood when applicable); wrong/disabled → graceful non-award page.
  2. Unauth scan → parks the flag + prompts sign-in; the later signed-in claim credits exactly once (never double).

**Plans:** 2 plans

- [x] 45-01-PLAN.md — Park-and-claim helpers (`ctf-pending.ts` createPending/claimPending) + judge pre-hashed-guess seam (wave 1, tdd)
- [x] 45-02-PLAN.md — Visible `/use1/ctf/claim` route + own silent-SSO-free `(ctf)` layout + result card / nonce keeper (wave 2)

### Phase 46: Covert CSS Channel + Park-and-Claim

**Goal:** The clandestine in-page submission path — an always-`200 text/css` asset on run.defcon.run whose response is indistinguishable in the network tab, carrying the award ack inside the CSS body, wired to the `!!!` easter-egg trigger and a DC33-style celebration.
**Depends on:** Phase 44 (`judgeSolve`, `CtfPending`).
**Requirements:** CTF-07 (always-`200 text/css` endpoint; `v=` param decodes a reversible, build-date-plausible numeric flag; unknown/wrong/unauth → plain decoy sheet), CTF-08 (award ack = an innocuous CSS custom property; identical HTTP status, `Content-Type`, and ≈body-size across win/wrong/unauth; no differential logging — invisibility invariants), CTF-09 (egg-side client: `!!!` trigger injects the `<link>`, reads the marker via `getComputedStyle` → DC33 celebration [rain + effects] on win only; unauth path parks a nonce for later credit).
**Success Criteria:**

  1. Covert curl matrix (signed-in-win / signed-in-wrong / unauth) is indistinguishable except for the value buried in the CSS body; no auth/win/flag tell in status, headers, size, or logs.
  2. The `getComputedStyle` read fires the celebration on a genuine win only; an unauth win parks a nonce that credits on the next signed-in visit.

**Plans:** 4 plans

- [x] 46-01-PLAN.md — Covert primitives: reversible+total flag codec + presence-only ≈equal-size CSS-ack builder (wave 1)
- [x] 46-02-PLAN.md — Covert `text/css` route at `/use1/assets/theme` (always-200, decoy/win, judge+park, no differential log) (wave 2)
- [x] 46-03-PLAN.md — DC33 CtfCelebration overlay (self-terminating, not reduced-motion-gated) (wave 1)
- [x] 46-04-PLAN.md — Egg client (encode → inject link → getComputedStyle read-back) + `!!!` trigger wired on run.defcon.run (wave 3)

### Phase 47: Admin CTF CRUD Fields + CTF Leaderboard

**Goal:** Extend the existing `/admin/qr` CTF CRUD with the new scoring fields (hash-on-save) and build the CTF-only leaderboard reachable at `q.defcon.run/admin/leaderboard`.
**Depends on:** Phase 44 (data model). Parallel-safe with 45/46.
**Requirements:** CTF-10 (`CtfForm` extended: `pointMax`/`pointFloor`, `maxSolves`, `firstBloodBonus`, `timeTiers[]` via the existing datetime-local + preset-chip picker; answer hashes on save — plaintext never persisted; one-time migration of existing `Ctf.answer` plaintext → `answerHash`), CTF-11 (CTF-only leaderboard: rank users by `RunUser.ctfScore`, drill into a challenge's `CtfSolve` rows [user, ordinal, points, first-blood, channel, time]; admin-gated; optional CSV with the OWASP formula-injection guard).
**Success Criteria:**

  1. CTF CRUD round-trips all new fields; existing `Ctf` rows are migrated to `answerHash` with no plaintext left.
  2. The leaderboard ranks by `ctfScore` and drills into `CtfSolve` under the existing `ADMIN_GROUPS` gate.

**Plans:** 3 plans (all wave 1, parallel — zero file overlap).

Plans:

- [x] 47-01-PLAN.md — CtfForm scoring fields (pointMax/pointFloor/maxSolves/firstBloodBonus/timeTiers via the QR datetime+preset editor) + hash-on-save in qr-admin (answerHash, no plaintext, no-clobber on blank edit) + vitest (CTF-10)
- [x] 47-02-PLAN.md — Idempotent plaintext→answerHash migration: pure `ctf-migration.ts` (reuses `hashAnswer`) + dry-run/`--confirm` `migrate-ctf-answerhash.mts` tsx script + idempotency/parity tests (CTF-10)
- [x] 47-03-PLAN.md — CTF-only leaderboard: `ctf-leaderboard.ts` (rank by ctfScore + CtfSolve drill + formula-guarded CSV) + gated `(protected)/admin/leaderboard` page + AdminConsole link + gated `/api/admin/ctf-leaderboard` CSV route (CTF-11)

### Phase 48: CloudFront + Integration Exposure

**Goal:** Wire the mixed-origin CloudFront so the covert path and the q-hosted admin leaderboard actually resolve correctly and uncached, and expose the CTF signal the DC33 total-score mapper consumes.
**Depends on:** Phases 46 (covert path) + 47 (admin route/leaderboard).
**Requirements:** CTF-12 (CloudFront covert-path behavior: routes to the app/ALB origin [not an S3/`*.css` static behavior], `CachingDisabled`, forwards the session cookie; verify no higher-precedence extension behavior intercepts), CTF-13 (`q.defcon.run/admin/*` → run.human ALB origin behavior [cookie-forward, no-cache] so `q.defcon.run/admin/leaderboard` renders under run.human's `ADMIN_GROUPS` gate without turning the resolver into an app server), CTF-14 (document + expose the `ctfScore`/`CtfSolve` read for the DC33 total-score migration; do NOT build the global board).
**Success Criteria:**

  1. Live curl matrix: the covert path hits the app origin, is uncached, forwards the cookie, and differs only in the CSS body across signed-in-vs-not / right-vs-wrong.
  2. `q.defcon.run/admin/leaderboard` renders under the admin gate; the CTF signal is documented and queryable by the DC33 mapper.

**Plans:** 3 plans (author + `terraform validate` only — NO apply/deploy; DEPLOY-SPECs where a blind production-distro edit is unsafe)

- [x] 48-01-PLAN.md — CTF-12: covert-path `/use1/assets/theme` → use1 ALB behavior on the run.defcon.run cloudfront module (authored edit + DEPLOY-SPEC)
- [x] 48-02-PLAN.md — CTF-13: inert `q /admin/*` → run.human behavior on the qr-resolver distro (authored, count-gated + DEPLOY-SPEC)
- [x] 48-03-PLAN.md — CTF-14: `docs/ctf-score-integration.md` documenting the `ctfScore`/`CtfSolve` read for the DC33 mapper

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

**Plans:** 2 plans (waves: 1={01}, 2={02}) — endpoint contract first, then the run.gpx hook that POSTs to it. **BUILT + VERIFIED 2026-07-14.** Goal-backward PASS (4/4 must-haves; all 4 SCs traced end-to-end across both apps). Gates: run.human vitest 16/16 + tsc clean (only pre-existing out-of-scope errors), run.gpx vitest 5/5 + tsc fully clean. Boundaries: `source` server-fixed `gpx` (LDBR-12), no GpxFile schema change (YAGNI), shared `getAdapterUserIdBySub` (private duplicate removed), Phase-49 entity/scoring untouched.

Plans:

- [x] 50-01-PLAN.md — run.human `POST /api/internal/accomplishment` (secret gate + shared `getAdapterUserIdBySub` + pure payload builder → existing `createAccomplishment`) (LDBR-06) [wave 1] — vitest 16/16 (incl. 3-branch route test)
- [x] 50-02-PLAN.md — run.gpx confirm-route hook: full S3 fetch + pure decimate-to-≤100-`{lat,lng}` + best-effort POST to run.human, skip `GLOBAL`, non-fatal (LDBR-05) [wave 2] — vitest 5/5

### Phase 51: Leaderboard API — Scan/Rank/Cache + Admin-Gated Routes

**Goal:** Two admin-gated read APIs back the board. `GET /api/leaderboard` scans `RunUser`, computes `globalScore` per row, assigns `globalRank` over the full sorted list (filter narrows display, not rank), paginates, and caches for 60s with stale-while-revalidate (DC33 parity). `GET /api/leaderboard/[userId]/accomplishments` lazily returns a runner's runs (incl. `polyline` metadata). Both use `requireAdmin` → 404 on denial; no privacy filter now (admin-only surface), with the filter hook point marked for launch.
**Depends on:** Phase 49 (reads `RunUser` rollups). Soft on Phase 50 for GPX runs to appear, but ranks correctly without it.
**Requirements:** LDBR-07 (`GET /api/leaderboard`: `scanAllRunUsers` → `globalScore` → `globalRank` over full sorted list → paginate; 60s cache + stale-while-revalidate; `requireAdmin`→404; count chips from `activityCounts`+`ctfSolves`), LDBR-08 (`GET /api/leaderboard/[userId]/accomplishments`: admin-gated, returns runs incl. polyline metadata; no privacy filter now with the filter hook point marked)
**Success Criteria** (what must be TRUE):

  1. A non-admin session receives 404 on both routes; an admin session gets JSON; entry revalidates fresh admin claims.
  2. `globalRank` is assigned over the full sorted user set and is stable under a `filter` that narrows the returned page.
  3. Repeated calls within 60s are served from cache; a stale entry is served while a refresh runs (no request blocks on the scan).
  4. The per-user route returns a runner's accomplishments including `metadata.polyline` for GPX/check-in runs.

**Plans:** 3 plans (waves: 1={01,03}, 2={02}) — **BUILT + VERIFIED 2026-07-14.** Goal-backward PASS (4/4 must-haves; all 4 SCs traced). Gates: vitest 29/29, tsc clean (only pre-existing out-of-scope errors). Boundaries: both routes deny → 404 never 403; rank over full set stable under filter; 60s stale-while-revalidate never blocks; REUSE-only (Phase 49/50 untouched); no PII in row DTO; marked no-op privacy hook for launch.

Plans:

- [x] 51-01-PLAN.md — Pure core `lib/leaderboard-data.ts`: `buildLeaderboard` (rank over full sorted set → filter → paginate) + `isStale`/`LEADERBOARD_CACHE_TTL_MS` + unit tests (LDBR-07) [wave 1] — vitest 15/15
- [x] 51-02-PLAN.md — `lib/leaderboard-cache.ts` 60s stale-while-revalidate scan cache + `GET /api/leaderboard` (admin-gate→404 → cached scan → buildLeaderboard) + route test (LDBR-07) [wave 2] — vitest 10/10
- [x] 51-03-PLAN.md — `GET /api/leaderboard/[userId]/accomplishments` (admin-gate→404, `getAccomplishmentsByUser`, marked no-op privacy hook) + route test (LDBR-08) [wave 1] — vitest 4/4

### Phase 52: Leaderboard UI — PolylineRenderer + Accordion + Hidden Admin Page

**Goal:** The DC33 look, ported. `PolylineRenderer` draws a client `<canvas>` — one OpenStreetMap tile + the decoded polyline + green-start/red-end dots + a dark-mode filter. `LeaderboardTable` is a HeroUI accordion: each row shows `globalRank` / `globalScore` 🥕 / display name / count chips, the current admin's own row highlighted, with search + fast-filter chips and pagination; expanding a row lazy-loads that runner's runs with thumbnails. Runner-class emoji derive from `RunUser.mqttUsertype`. The page lives at `(protected)/leaderboard/page.tsx`, gated `requireAdmin` → `notFound()` (+ `revalidateAdmin` on entry) and **linked from no navigation** — hidden until launch.
**Depends on:** Phase 51 (consumes the leaderboard API).
**Requirements:** LDBR-09 (`PolylineRenderer` client-canvas thumbnail: OSM tile + route + start/end dots + dark-mode; DC33 port), LDBR-10 (`LeaderboardTable` accordion: rank/`globalScore`/name/count chips, current-user highlight, search + filter chips, pagination, expand→runs with thumbnails; runner-class emoji from `mqttUsertype`), LDBR-11 (hidden admin page `(protected)/leaderboard/page.tsx`: `requireAdmin`→`notFound()` + `revalidateAdmin` on entry; NOT linked in any nav/header/dropdown)
**Success Criteria** (what must be TRUE):

  1. A non-admin visiting `/leaderboard` gets a 404 (page not advertised); an admin sees the ranked accordion.
  2. The board renders no navigation entry anywhere — header, dropdown, or profile — grep-verifiable.
  3. Expanding a row renders each run's `<canvas>` thumbnail from its stored polyline (OSM tile + route + start/end dots), with the current admin's own row highlighted.
  4. Rank/score/count chips match the API's `globalScore`/`globalRank`/counts, and runner-class emoji reflect `mqttUsertype`.

**Plans:** 3 plans

Plans:

- [x] 52-01-PLAN.md — PolylineRenderer client canvas + pure polyline-geometry seam (LDBR-09) — vitest 14/14
- [x] 52-02-PLAN.md — LeaderboardTable HeroUI accordion + pure leaderboard-ui helpers (LDBR-10) — vitest 7/7
- [x] 52-03-PLAN.md — Hidden admin `(protected)/leaderboard/page.tsx` gate + no-nav test (LDBR-11) — vitest 2/2

**Verified 2026-07-14:** code goal-backward PASS (SC1 gate, SC2 no-nav, SC4 chips/emoji fully verified; SC3 canvas-draw + accordion-expand routed to the one remaining local-browser checkpoint — inherently browser-only). Gates: vitest 23/23 (phase-52) / 99/99 (full run.human leaderboard surface), tsc clean (only pre-existing out-of-scope errors). `git diff` = exactly the 8 planned UI files; Phases 49/50/51 untouched.

### Phase 53: CTF Flag Types — Slice 1a Backend (Answer-Type Framework + Rotating OTP + Repeatable Ledger + Effect Return)

**Goal:** Extend the shipped CTF judge from a single static-answer model into a multi-answer-type backend — all additive to the `Ctf` entity, fully unit-testable, with **no UI blast radius** and the covert-CSS invariant preserved. Adds the `answerType` framework (`static` | `otp`; a row with no `answerType` reads as `static` so every shipped flag keeps working), a `ctf-otp.ts` TOTP core ported from the real `meshtk` Go (generation + new verify/skew logic, base32 decode, SHA1, **period-120 default**), a `CtfScoreEvent` append-only ledger for repeatable flags with **atomic once-per-window** idempotency (time-bucket sort key — no read-then-write race), judge gates for **unlock/chaining**, **answer-type dispatch**, and **per-24h / per-player-max / global-max** limits (all "fail = indistinguishable non-solve"), and the **`effect`-return plumbing** (`judgeSolve` loads + returns `effect`; the non-covert solve response surfaces it, incl. the new `otp-enroll` kind; the covert path stays byte-identical). Delivers the daily-chain vision *except* time-of-day windows (Slice 2).
**Depends on:** Phase 44 (CTF judge core — `judgeSolve`, `Ctf`/`CtfSolve` entities, `computePoints`, `allocateOrdinal`, `accrue`, `narrowCtf`; all present in this worktree via v2.1 merge). Additive-only to `Ctf` and the judge; no changes to the covert CSS path (`covert-egg.ts`) or the leaderboard rollup.
**Requirements:** CTFT-01 (`Ctf` entity additive fields, all optional, backward-compatible: `answerType:"static"|"otp"` [absent ⇒ `static`], `otp` map `{secret(base32),digits,period:120,algorithm:"SHA1",skew}`, `unlockAfter` [prerequisite challenge **name**], `perPlayerIntervalHours`, `perPlayerMax`, `globalMax` [0/absent ⇒ unlimited; distinct from the `maxSolves` scoring-curve denominator — comment both loudly]), CTFT-02 (`src/lib/ctf-otp.ts` TOTP core ported from `~/working/meshtk/pkg/otp/totp.go` via Node `crypto` + a base32 decoder: `parseOtpauth`, `totpAt`, `adjacentCodes`, `verifyTotp` — **verify/skew is NEW logic the Go lacks**, built over `totpAt`±skew with `crypto.timingSafeEqual`; SHA1 now with a switch left for SHA256/512; unit-tested against RFC 6238 vectors [parameterized — RFC vectors are 30s/8-digit]), CTFT-03 (`CtfScoreEvent` append-only ledger entity: `pk=challenge`, `sk=user#<bucket>`, `byUser` GSI, attrs `challenge`/`user`/`points`/`channel`/`scoredAt`/`tierCeiling`; repeatable flags [`answerType==="otp"` OR `perPlayerMax>1` OR `perPlayerIntervalHours` set] write `CtfScoreEvent`; static one-award flags keep `CtfSolve` unchanged; accrual sums into `RunUser.ctfScore`/`ctfSolves` via `accrue` exactly as today), CTFT-04 (judge gates on `judgeSolve`, ordered, every failure indistinguishable from a wrong answer: **unlock** [if `unlockAfter` set and player has no score for it → non-solve], **answer-type dispatch** [`static`→`verifyAnswerHash`; `otp`→`verifyTotp`], **cadence** [once-per-`perPlayerIntervalHours` via atomic conditional-put on `CtfScoreEvent` keyed `user#<bucket>` where bucket = floor of `scoredAt` to the interval], **per-player-max** [atomic per-`(challenge,user)` count/counter], **global-max** [reuse the atomic `allocateOrdinal`; if returned `n > globalMax` → award 0 / no accrue — never a partition query]), CTFT-05 (effect-return plumbing: `judgeSolve` adds `effect` to the loaded `Ctf` [`narrowCtf`], to `JudgeResult`, and surfaces it on the **non-covert** solve response **only**; new recognized `effect` kind `{kind:"otp-enroll", otpauth, nextFlag?}`; the covert CSS path stays byte-identical and carries no reward payload), CTFT-06 (edit-semantics guard: disallow flipping `answerType` static↔repeatable once solves exist [history would split across `CtfSolve` + `CtfScoreEvent`] — the spec's chosen resolution).
**Success Criteria** (what must be TRUE):

  1. A `Ctf` row with no `answerType` scores **identically to a static flag today** (backward compat proven by test); all new fields are optional and additive — no shipped row's behavior changes.
  2. `verifyTotp` accepts a guess equal to the current-period code or any within `±skew`, rejects outside it, and compares constant-time; the TOTP core matches RFC 6238 test vectors (parameterized to the vectors' 30s/8-digit params) and generates the meshtk code at period 120.
  3. A repeatable OTP flag scores **at most once per `perPlayerIntervalHours` window per player** — two concurrent submits of the same rolling code award **exactly once** (atomic bucket-sk conditional put, no read-then-write race); `perPlayerMax` caps a player's total scoring solves; `globalMax` stops scoring for everyone after N events (atomic ordinal; `n > globalMax` ⇒ award 0).
  4. The **unlock gate** withholds scoring for a flag with `unlockAfter` until the player has scored the prerequisite, and a locked/failed gate is **indistinguishable** from a wrong answer (covert-channel invariant intact).
  5. On a non-covert solve, `judgeSolve` loads and returns the flag's `effect` and the solve API surfaces it (incl. `otp-enroll`); the covert CSS path (`covert-egg.ts`) stays **byte-identical** and carries no reward payload — grep/test-verified.
  6. `CtfScoreEvent` accrual sums into `RunUser.ctfScore`/`ctfSolves` exactly as the shipped `accrue`; static one-award flags still write `CtfSolve` and are untouched.

**Plans:** 4/4 plans complete
**Wave 1**

- [x] 53-01-PLAN.md — Data model: additive `Ctf` fields + `CtfScoreEvent` ledger + pure flag-type helpers + edit-semantics guard (CTFT-01, CTFT-03, CTFT-06) [wave 1]
- [x] 53-02-PLAN.md — `ctf-otp.ts` TOTP core (port + new verify/skew, RFC vectors) (CTFT-02) [wave 1]

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 53-03-PLAN.md — Judge gates + atomic repeatable ledger writes into `judgeSolve` (CTFT-03, CTFT-04) [wave 2]

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 53-04-PLAN.md — `effect`-return plumbing (non-covert only) + covert byte-identical invariant (CTFT-05) [wave 3]

### Phase 54: CTF Flag Types — Slice 1b Frontend (Admin Form Redesign + otp-enroll QR/Rolling-Code Reward Renderer)

**Goal:** Ship the run.human UI half of the CTF flag-types milestone on top of Phase 53's backend — a shippable run.human PR with its own tests, no covert-CSS blast radius. Two deliverables: (1) a restructured `CtfForm.tsx` (design "A") that exposes the answer-type framework (Static / Rotating OTP), the Static→**Reward on solve → OTP enrollment** seed configurator with a reveal preview, per-24h + per-player-max + global-max limits, unlock/chaining, an always-editable Advanced drawer that presets pre-fill, and a live scoring preview mirroring `computePoints` — while **removing the dead `Points` field** and keeping answers/secrets write-only/masked; and (2) a **new client `otp-enroll` reward renderer** wired to the non-covert solve response (which 1a extended to carry `effect`) that draws a real QR of the `otpauth://` seed via the existing `qrcode@^1.5.4` dep, shows the rolling code (previous/current/next + countdown) via `adjacentCodes`, offers an "Add to Authenticator" deep link, and names the `effect.nextFlag` it unlocks. Delivers the full daily-chain vision *except* time-of-day windows (Slice 2). No infra changes, no data migration (all Phase-53 fields additive; existing rows read as `static`).
**Depends on:** Phase 53 (Slice 1a backend — additive `Ctf` fields, `answerType` dispatch, `CtfScoreEvent` ledger, and the `effect`-return plumbing incl. `otp-enroll` on the non-covert solve response; all present in this worktree). Additive-only to the admin form and the solve-response client; must not touch the covert CSS path (`covert-egg.ts`) or the leaderboard rollup.
**Requirements:** CTFT-07 (`CtfForm.tsx` redesign per design "A": **Name** + **challenge-type presets** [Flat points · First-blood race · Timed drop · Easter egg · Custom] that pre-fill scoring; **Answer type** section [Static / Rotating OTP] with per-type controls and, for Static, the **Reward → OTP enrollment** seed configurator + reveal preview; **Scoring window & limits** section surfacing per-24h + `perPlayerMax` + `globalMax`; **Unlock & chaining** section [hidden-until-`unlockAfter`]; always-editable **Advanced drawer** [raw curve/tier/anti-spam/effect knobs, presets pre-fill]; **live scoring preview** mirroring `computePoints`; **remove the dead `Points` field**; answers/secrets masked / write-only / never prefilled in edit mode; plain-language help copy for Ceiling, anti-spam, and the one-award/cadence note; edit-mode type + answer-type inference), CTFT-08 (client **`otp-enroll` reward renderer** — a NEW handler [none exists today; confetti is boolean-driven and `effect` never reaches the client] keyed on `effect.kind==="otp-enroll"` from the non-covert solve response: real `otpauth://` **QR via `qrcode@^1.5.4`** client-side [no new dep], **rolling code** [previous/current/next + `remainingSeconds` countdown] via `adjacentCodes`, an **"Add to Authenticator"** `otpauth://` deep-link action, and optional **next-flag** copy from `effect.nextFlag`; covert path unaffected).
**Success Criteria** (what must be TRUE):

  1. An admin can create/edit a **Static** and a **Rotating OTP** flag entirely through the redesigned `CtfForm.tsx`; a challenge-type preset pre-fills the Advanced drawer's scoring knobs, and the Advanced knobs remain editable after a preset is applied.
  2. The Static **Reward → OTP enrollment** control configures the handed-out seed and shows a reveal preview; the dead `Points` field is gone; answers/secrets are masked and are **never** prefilled when editing an existing flag.
  3. The live scoring preview matches `computePoints` for the current form state, and the per-24h / `perPlayerMax` / `globalMax` limits plus `unlockAfter` are all settable and round-trip through save/edit.
  4. On a non-covert solve whose response carries `effect.kind==="otp-enroll"`, the new renderer draws a scannable QR of the `otpauth://` string, shows the correct current code with a live countdown and adjacent codes, exposes an "Add to Authenticator" deep link, and names `effect.nextFlag` when present.
  5. The covert CSS solve path (`covert-egg.ts`) and its byte-identical response are untouched; no new runtime dependency is added (QR uses the existing `qrcode@^1.5.4`); phase-scoped tests cover preset→Advanced mapping, preview-vs-`computePoints`, masked-secret non-prefill, and `otp-enroll` render.

**Plans:** 4/4 plans complete

**Wave 1**

- [x] 54-01-PLAN.md — Pure form model: presetToAdvanced map, previewPoints (binds computePoints), edit-mode inference, redactCtfSecrets (CTFT-07) [wave 1]
- [x] 54-02-PLAN.md — Browser-safe OTP core split + adjacentCodesAsync (Web Crypto, no new dep; Phase-53 contract preserved) (CTFT-08) [wave 1]

**Wave 2** *(blocked on Wave 1)*

- [x] 54-03-PLAN.md — otp-enroll reward renderer (CtfOtpEnroll: QR + rolling code + deep link + next flag) wired into non-covert ClaimClient + covert-invariant test (CTFT-08) [wave 2]

**Wave 3** *(blocked on Wave 2)*

- [x] 54-04-PLAN.md — CtfForm design-A redesign: sections, segmented presets, limits, unlock, Advanced drawer, live preview, remove Points, reward configurator + reveal preview (CTFT-07) [wave 3]

### Phase 55: CTF Flag Types — Slice 2 Scoring Windows (Day/Time/TZ Gating + DEF CON Run-Hours Quick Set)

**Goal:** Add time-of-day / day-of-week scoring windows to the CTF judge as a new ordered gate, additive to the `Ctf` entity and the redesigned admin form — a shippable run.human PR with its own tests, covert-CSS invariant preserved. Adds an optional `scoreWindow` config `{ days, startTime, endTime, tz }` where `tz` is an **IANA zone** (e.g. `America/Los_Angeles`); the judge evaluates `now` in `scoreWindow.tz` via `Intl.DateTimeFormat` (DST automatic) as gate **step 3** — if `scoreWindow` is set and `now` is outside the day/time window → **non-solve, indistinguishable from a wrong answer**. The admin form's **Scoring window & limits** section gains the day/time/tz picker (PT/ET/UTC → stored as IANA id) and the **"DEF CON run hours" quick set** (Thu–Sun 6–8 AM PT). Absent `scoreWindow` ⇒ always-open (every existing flag unchanged).
**Depends on:** Phase 54 (redesigned `CtfForm.tsx` provides the Scoring window & limits section to extend) and Phase 53 (judge gate ordering + additive-`Ctf` pattern). Additive-only; must not touch the covert CSS path (`covert-egg.ts`) or the leaderboard rollup.
**Requirements:** CTFT-09 (`Ctf` additive optional `scoreWindow` field `{ days:number[]|weekday-set, startTime, endTime, tz:IANA-id }`, backward-compatible: absent ⇒ always scorable; distinct from cadence/caps), CTFT-10 (judge **scoring-window gate** as ordered step 3 in `judgeSolve`: evaluate `now` in `scoreWindow.tz` via `Intl.DateTimeFormat`, DST-correct; outside window ⇒ non-solve indistinguishable from a wrong answer — covert invariant intact; never log the guess), CTFT-11 (admin form **day/time/tz picker** in the Scoring window & limits section: weekday multi-select + start/end time + tz selector [PT/ET/UTC → stored IANA id] + **"DEF CON run hours" quick set** chip = Thu–Sun 6–8 AM `America/Los_Angeles`; round-trips through save/edit; live preview reflects window state).
**Success Criteria** (what must be TRUE):

  1. A flag with `scoreWindow` set to Thu–Sun 6–8 AM PT scores **only** when `now` (evaluated in `America/Los_Angeles`) falls inside that window and is a **non-solve** (indistinguishable from wrong) otherwise; a flag with no `scoreWindow` is unaffected.
  2. Window evaluation is **DST-correct** — "6–8 AM PT" resolves to PDT in August and PST off-season via `Intl.DateTimeFormat`, proven by a test crossing a DST boundary.
  3. An admin can set the day/time/tz window through the form and apply the **"DEF CON run hours"** quick set in one click; the value round-trips through save→edit and the stored `tz` is an IANA id.
  4. The covert CSS solve path (`covert-egg.ts`) stays byte-identical; the window gate fires before answer validation in the documented order and never logs the guess or secret.

**Plans:** 3 plans

**Wave 1**

- [x] 55-01-PLAN.md — Foundation: pure DST-correct `isWithinScoreWindow` + `DEFCON_RUN_HOURS`/`TZ_OPTIONS` in `ctf-score-window.ts`, additive `Ctf.scoreWindow` attribute, form-model bridge helpers + redaction round-trip (CTFT-09) [wave 1]

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 55-02-PLAN.md — Judge scoring-window gate as ordered step 3 in `judgeSolve` (inside/outside/DST/backward-compat/covert-indistinguishable) (CTFT-10) [wave 2]
- [x] 55-03-PLAN.md — Admin day/time/tz picker + DEF CON run-hours quick set in the Scoring window & limits section + `qr-admin` write passthrough (CTFT-11) [wave 2]

### Phase 56: CTF Flag Types — Slice 3 Wordlist One-Time Codes (CtfCode Entity + Atomic Single-Use Claim)

**Goal:** Add a third answer type — `wordlist` — a pool of single-use codes consumed first-come, atomically. New `CtfCode` ElectroDB entity (`pk = challenge`, `sk = codeHash`; attrs `codeHash` [salted with the existing answer scheme], `claimedBy`, `claimedAt`); a claim is a conditional update `attribute_not_exists(claimedBy)` → exactly one winner under concurrency, no read-then-write race. Plaintext codes are **never stored** — the admin bulk-loads pre-hashed codes. The judge's answer-validation step gains a `wordlist` branch: hash the guess and conditional-claim a matching unclaimed `CtfCode`; a used or unknown code is a **non-solve indistinguishable from a wrong answer**. The admin form's Answer-type section gains the **Wordlist** option with bulk code entry. Shippable run.human PR with its own tests including the two-claimers-one-wins race; covert-CSS invariant preserved.
**Depends on:** Phase 54 (Answer-type section of the redesigned form to add the Wordlist option) and Phase 53 (judge answer-type dispatch + `CtfScoreEvent`/one-award ledger to record the scoring event). Additive-only; must not touch the covert CSS path (`covert-egg.ts`) or the leaderboard rollup.
**Requirements:** CTFT-12 (new `CtfCode` ElectroDB entity: `pk=challenge`, `sk=codeHash`, attrs `codeHash` [salted, same scheme as answers], `claimedBy`, `claimedAt`; plaintext never persisted), CTFT-13 (judge **`wordlist` answer-type branch** in `judgeSolve`: hash the guess and **atomic conditional-claim** a matching unclaimed `CtfCode` via `attribute_not_exists(claimedBy)` — exactly one concurrent claimer wins; used/unknown code ⇒ non-solve indistinguishable from a wrong answer; scoring event recorded through the existing ledger/accrue path; never log the guess), CTFT-14 (admin form **Wordlist** option in the Answer-type section: bulk-load codes [hashed client- or server-side before storage per the answer-salt scheme], write-only [plaintext never round-tripped to the client], with a loaded/remaining count surfaced).
**Success Criteria** (what must be TRUE):

  1. A `wordlist` flag admits each code exactly once: two concurrent submissions of the **same** unclaimed code result in **exactly one** scoring solve and one non-solve (atomic `attribute_not_exists(claimedBy)` conditional claim — proven by a race test).
  2. A previously-claimed or unknown code is a **non-solve indistinguishable from a wrong answer** (covert-channel invariant intact); a valid unclaimed code scores through the existing accrue path and marks the `CtfCode` `claimedBy`/`claimedAt`.
  3. Plaintext codes are **never stored** and never round-tripped to the client — only salted `codeHash` values persist; the admin can bulk-load codes and see a loaded/remaining count.
  4. The covert CSS solve path (`covert-egg.ts`) stays byte-identical; existing static/otp flags are unaffected by the new answer-type branch; the guess is never logged.

**Plans:** 3 plans

Plans:

- [x] 56-01-PLAN.md — CtfCode entity (pk=challenge, sk=codeHash; claimedBy/claimedAt) + key-parity test (CTFT-12)
- [x] 56-02-PLAN.md — judge wordlist branch: atomic claimCode (attribute_not_exists) + two-claimers-one-wins race + indistinguishable non-solve + covert grep gate (CTFT-13)
- [x] 56-03-PLAN.md — admin Wordlist option: bulk-load hashed codes (add-only) + loaded/unclaimed count line, plaintext never round-tripped (CTFT-14)

---

### Phase 65: CTF Single-Use OTP Flag Option (Judge-Enforced First-Come Claim)

**Goal:** Add a per-flag `otp.singleUse` toggle so a rotating-OTP CTF flag can be **first-come-first-served** — the FIRST logged-in player to redeem a given code wins globally; everyone else gets a NON_SOLVE indistinguishable from a wrong answer. Default `false`/absent = today's **shared** behavior (every player who submits the same code scores), so no migration and no shipped-flag change. Single-use is enforced **only in the judge** (`run.human` `/ctf/claim` → `judgeSolve`, post-login); the public `q.defcon.run` resolver Lambda is **never** touched — anonymous traffic must never trigger a DynamoDB write. Shippable run.human PR with its own tests including the two-claimers-one-wins race and the shared-behavior regression; covert-CSS invariant preserved.
**Depends on:** Phase 53 (judge answer-type dispatch + `CtfScoreEvent` ledger + OTP `verifyTotp` branch) and Phase 56 (the code-hash-keyed atomic single-use claim pattern — `CtfCode`/`claimCode` is the closest analog). Additive-only; must not touch the covert CSS path (`covert-egg.ts`), the resolver Lambda, or the leaderboard rollup.
**Requirements:** CTFT-15 (config flag: add `singleUse?: boolean` to the `otp` map — `Ctf.otp` entity in `qr.ts`, `JudgeOtp` in `ctf-judge.ts`, `CtfSeedOtp` in `ctf-seed-rows.ts`, and the admin form model — default `false` ⇒ shared behavior, no migration), CTFT-16 (new lightweight `CtfOtpClaim` ElectroDB entity `pk=challenge`, `sk=codeHash`, attrs `claimedBy`, `claimedAt`, `ttl` [DynamoDB TTL]; the single-use claim is a **create-if-absent** conditional put `attribute_not_exists(pk)` — exactly one concurrent claimer wins, no read-then-write race; plus a runtime-pure claim/identity helper module with type-only entity imports, mirroring `ctf-solve-merge.ts`), CTFT-17 (judge single-use OTP path in `judgeSolve`: when `otp.singleUse` and `verifyTotp` passes, compute `codeHash = hashAnswer(guess)`, perform the global atomic claim, award the winner through the existing `recordScoreEvent`/`accrue` path keyed `bucket=codeHash`, and set the claim-row TTL to `now + period·(skew+2)`; a lost/consumed code ⇒ NON_SOLVE indistinguishable from a wrong answer; **judge-only**, never the resolver; never log the guess/codeHash), CTFT-18 (admin form toggle for `singleUse` in the Rotating-OTP section — default off; shared vs single-use is an operator choice per flag).
**Success Criteria** (what must be TRUE):

  1. A `singleUse` OTP flag admits each code **once globally**: two concurrent submissions of the **same valid** code by two different logged-in players result in **exactly one** scoring solve and one NON_SOLVE (atomic create-if-absent `attribute_not_exists(pk)` claim — proven by a race test).
  2. `otp.singleUse` absent/`false` preserves today's **shared** behavior exactly: multiple distinct players submitting the same valid code each score (regression test); no migration, no shipped-flag change.
  3. Single-use enforcement lives **only** in `judgeSolve`; the resolver Lambda / `q.defcon.run` routing is unchanged (no DynamoDB write from public traffic). The claim row carries a **DynamoDB TTL** (auto-expiring consumed-code marker); the same physical code is one claim across skew offsets (keyed by `codeHash`, not a time bucket).
  4. A used/unknown code returns the SAME NON_SOLVE a wrong answer yields (covert-channel invariant T-53-04-01 intact); the covert CSS path (`covert-egg.ts`) stays byte-identical; existing static/otp/wordlist flags are unaffected; the guess/codeHash is never logged.

**Plans:** 3 plans

Plans:

- [x] 65-01-PLAN.md — config flag on `Ctf.otp` + `CtfSeedOtp`; `CtfOtpClaim` create-if-absent entity (+ttl); runtime-pure `ctf-otp-claim` helper; pure identity/TTL/gate + key-parity + seed default-off tests (CTFT-15, CTFT-16) [wave 1]
- [x] 65-02-PLAN.md — judge single-use OTP path: `JudgeOtp.singleUse` + `narrowCtf` + `CtfStore.claimOtpCode` + finalize; race / cross-user / winner-resubmit-no-double-accrue / TTL / shared-OTP regression / indistinguishable-non-solve tests + covert & resolver-untouched grep gates (CTFT-15, CTFT-17) [wave 2]
- [x] 65-03-PLAN.md — admin `singleUse` toggle (Rotating-OTP section) + write/redaction passthrough; passthrough + redaction-preserved tests (CTFT-15, CTFT-18) [wave 2]

---

### Phase 66: Authoritative Meshtastic Pubkeys in DynamoDB (meshtk decrypt firewall)

**Goal:** Point meshtk's decrypt path at the authoritative X25519 pubkey run.flash already captures, instead of the unauthenticated broadcast `nodes.json` feed — closing two failure modes with one root (staleness: a re-keyed radio serves a wrong key forever; poisoning: any MQTT publisher can assert any node's pubkey). Three pieces: (1) run.human promotes radios to a first-class `MeshRadio` ElectroDB entity keyed by `nodeId` (+ `nodeNum`, `byUser` GSI) with a one-off backfill from every `RunUser.meshtasticRadios[]`; `register-radio` writes the entity converting device base64 pubkey → `0x` hex. (2) run.flash adds a "Sync keys" action reusing ONLY the existing SECURITY_CONFIG read-back + `register-radio` POST (reflash/re-key path). (3) meshtk (separate repo `~/working/meshtk` on `main`) gains a new `internal/keycache` — ONE process-wide shared cache, cache-first, singleflight + negative caching + circuit breaker, plain 1–2 min TTL expiry, direct `GetItem` by `nodeId`/`nodeNum` (never `Scan`) — replacing `decryptPKI`'s `nodes.json` key source, behind a `nodes.json` fallback flag for bring-up.
**OVERRIDING CONSTRAINT:** keep DDB load minimal — the in-memory keycache is the primary path; DDB is read at most ~once per node per TTL, shared process-wide across the whole ~34-client ghost fleet (never per-packet, never per-client). Up-to-TTL key staleness is acceptable. Every design choice is subordinate to this.
**Depends on:** the existing run.flash → `POST /api/register-radio` → `POST /api/internal/meshtastic-radios` write path and `RunUser.meshtasticRadios[]` model; meshtk `internal/credcache/` (`CacheAuthenticator`) as the pattern analog and `Server.CredCache.{TableName,TableRegion,DynamoDBEndpoint}` config wiring. Additive to the ghost PKI decrypt saga (commits `cbce8c8`/`da99ecd`/`9bf200c`). Spans two repos: monorepo (run.human + run.flash + terraform) = one PR; meshtk = its own branch/PR (built into run.mqtt image).
**Out of scope:** Layer 2 cred↔node ACL binding (traffic spoofing defense — deferred, spec §9); retiring/generating `nodes.json` from DDB (PR #806). This spec only removes meshtk's *decrypt-key* dependency on `nodes.json`.
**Requirements:**

  - **MRAD-01** — `MeshRadio` ElectroDB entity on the shared `ELECTRO_TABLE`: pk `nodeId` (`!hex`, direct `GetItem`), attrs `nodeNum` (uint32), `userId`, `publicKey` (`0x` hex), `privateKey`, `verified`/`verificationCode`/`verifiedAt`/`verificationAttempts`/`resendAttempts`, `impersonate`, `showOnMap`, `source` (`flash`|`sync`|`manual`), `createdAt`/`updatedAt`; `byUser` GSI (pk `userId`) for listing/admin/deferred Layer-2 join. meshtk hot path is a direct key `get` — no GSI on the hot path.
  - **MRAD-02** — `register-radio` write: `POST /api/internal/meshtastic-radios` upserts the `MeshRadio` entity (keyed `nodeId`, `userId` from resolved RunUser), converting the device base64 pubkey → `0x` hex once at the write boundary.
  - **MRAD-03** — one-off, idempotent, re-runnable backfill script creating a `MeshRadio` item from every existing `RunUser.meshtasticRadios[]` entry (base64→hex where needed).
  - **MRAD-04** — enumerate EVERY reader/writer of `RunUser.meshtasticRadios[]` (spec §8a main risk); **planning decides** (spec §11 open question) between full reader-migration to `MeshRadio` + retire embedded list, vs. dual-write keeping the embedded list as the user-facing denormalized copy — chosen by enumerated reader count/risk. No user-facing regression either way.
  - **MRAD-05** — run.flash "Sync keys" action running ONLY the existing `requestSecurityKeys`/`onConfigPacket` security read-back + `register-radio` POST (no full re-provision); handles reflash-regenerates-keys.
  - **MRAD-06** — meshtk `internal/keycache`: ONE process-wide shared cache (mirror `credcache` `CacheAuthenticator`), cache-first, singleflight dedup, negative caching, circuit breaker, plain 1–2 min TTL expiry, direct `GetItem` `MeshRadio` by `nodeNum`/`nodeId` (never `Scan`) — fleet-wide ≤ ~one DDB read per node per TTL, independent of packet/client volume.
  - **MRAD-07** — meshtk `decryptPKI` resolves the sender pubkey from `keycache` (DDB authoritative) instead of `FetchPublicKeyFromDefcon` (nodes.json); fallback flag `fallback=nodes.json` (bring-up) | `fallback=none` (miss → NACK, closes poisoning); every fallback logged for enrollment-coverage measurement.
  - **MRAD-08** — terraform `byUser` GSI on the shared `ELECTRO_TABLE` if the table's GSIs are terraform-managed (else document ElectroDB app-managed); meshtk keycache config wiring parallels `Server.CredCache.{TableName,TableRegion,DynamoDBEndpoint}`.

**Success Criteria** (what must be TRUE):

  1. A radio's real on-device X25519 pubkey lands in `MeshRadio` as `0x` hex via `register-radio`, and a ghost/meshtk decrypts that radio's DM using the DDB key with `nodes.json` ignored (`fallback=none`) — the live-incident verification (KPH's real key ⇒ ricky decrypts a KPH DM).
  2. DDB read load is bounded by design: fleet-wide ≤ ~one `GetItem` per node per 1–2 min TTL, no per-packet/per-client reads, unknown senders negative-cached, concurrent misses collapsed by singleflight — proven by keycache unit tests (hit/miss/negative/singleflight/circuit-breaker, ported from credcache).
  3. Security regression: a NODEINFO injected on the broker with a bogus pubkey (the exact hotfix exploit) does NOT change decrypt behavior when `fallback=none` (poisoning closed). A re-flash → **Sync keys** re-registers the device and meshtk decrypts against the new key within one TTL. Unverified radios (`verified=false`) still resolve a key (decrypt ≠ authorization).
  4. No user-facing regression in run.human radio management; backfill is idempotent/re-runnable; the live NODEINFO-injection stopgap is superseded. Scope excludes Layer 2 ACL binding and nodes.json-from-DDB (#806). Monorepo work is ONE PR; meshtk is its own PR; nothing deployed until approval.

**Plans:** 7 plans (2 PRs — monorepo + meshtk)

Plans:

- [x] 66-01-PLAN.md — MeshRadio ElectroDB entity (pk nodeId, byUser GSI) + CRUD helpers + TS key-parity test + MRAD-08 no-terraform doc (MRAD-01, MRAD-08) [wave 1]
- [x] 66-02-PLAN.md — register-radio writes MeshRadio: pure canonicalization/base64→0x-hex lib + internal route upsert (MRAD-02) [wave 2]
- [x] 66-03-PLAN.md — hard-switch: migrate EVERY meshtasticRadios[] reader/writer onto MeshRadio + retire embedded list/type/helpers (MRAD-04) [wave 3]
- [x] 66-04-PLAN.md — idempotent re-runnable backfill script (embedded list → MeshRadio, base64→hex, pad-8 nodeId) (MRAD-03) [wave 3]
- [x] 66-05-PLAN.md — run.flash "Sync keys" (read-back + register only, no re-provision) (MRAD-05) [wave 1]
- [x] 66-06-PLAN.md — [meshtk repo] internal/keycache: cache-first GetItem resolver + singleflight/negative/circuit-breaker + ported table-tests + Go key-parity (MRAD-06) [wave 1]
- [x] 66-07-PLAN.md — [meshtk repo] decryptPKI + reply-encrypt swap to keycache behind fallback flag + KeyCacheConfig wiring + security-regression test (MRAD-07, MRAD-08) [wave 2]

### Phase 70: gpx-studio Shared Dialog Shell (Map Layers + My Maps)

**Goal:** Replace gpx.defcon.run studio's two inconsistent surfaces — the hover-opened layers popover (title-less, three competing collapse affordances, native-tooltip stutter) and the My Maps dialog (cryptic icon-strip actions, muddled hierarchy, bolted-on footer) — with two centered dialogs built from ONE shared component kit, per the approved design contract `.planning/sketches/006-shared-dialog-shell/DESIGN.md` and winning mockup (Sketch 006 Variant B "Carded sections"). Presentation-layer only: all layer/data wiring (PublicOverlaysLayer, MyConRunsLayer, CommunityRoutesLayer, cloud-sync) is untouched. Delivery is FULLY AUTONOMOUS end-to-end: implement → quality gates → PR → CI release (buildpub.yml) → CI deploy (deploy.yml) → Playwright prod probe, using the standing ship flow in `.claude/worktrees` memory (`reference_gpx_studio_ui_dev_recipe`).
**Depends on:** shadcn-svelte Dialog primitives already in `gpx-studio/website/src/lib/components/ui/`; existing LayerControl/PublicOverlays/MyConRuns/CommunityRoutes/CloudStorage/StravaStrip components; DESIGN.md + mockup as canonical refs.
**Out of scope:** check-in filter semantics (window/match/types unchanged), layer data classes, mobile FAB menu, My Maps folder navigation internals, any run.gpx webapp (Next.js) changes.
**Requirements:**

  - **DLGS-01** — Shared dialog kit in `gpx-studio/website/src/lib/components/dialog-shell/`: Shell (icon+title+optional subtitle, ✕, Esc/outside-click close, ~420px, body scroll ≤~72vh), Section (left rotating chevron ▾/▸, uppercase tracked label, optional trailing count/⋯menu/master-checkbox; carded treatment: surface-2 card, 1px border, 8px radius; master OFF → collapse+dim+cascade), Row (checkbox/radio · color dot or icon · label · trailing), Chips (segmented single-select + multi-select with type-color tint), HintBar (fixed bottom strip showing hovered/focused row's description).
  - **DLGS-02** — Map Layers dialog replaces the LayerControl hover popover: opens on CLICK of the layers button (hover-open/mouseleave-close and the svelte:window composedPath handler deleted); sections BASEMAP (radio rows) → USER CHECK-INS (master in header; segmented Hour/Today/Whole con + handle search + type chips) → DEF CON 34 ROUTES → RABBIT ROUTES → MY DEF CON RUNS → COMMUNITY ROUTES; empty sections hidden; `quickStartAction` routes/runners opens the dialog; all layer-instance wiring in LayerControl.svelte preserved.
  - **DLGS-03** — My Maps rebuilt on the shared shell: MY FILES section FIRST (count badge + header ⋯ menu: New folder / Refresh / Export all) then SHARED WITH YOU (folder rows, SHARED badge, ›); file rows show labeled Edit + ⋯ menu (Share / Assign day / Save as Route / Export GPX / Delete) replacing the five-icon strip (fade-in on hover/focus on pointer devices, always visible on touch); footer = quiet helper text left + primary "👟 Add run" right; hint bar below footer.
  - **DLGS-04** — Stutter eliminated: zero native `title=` tooltips on route/file rows (descriptions flow to the hint bar via data-hint); no hover-open anywhere.
  - **DLGS-05** — StravaStrip card chips made explicit: imported-untagged shows actionable "Pick a day" chip; never-imported shows "+ Import" chip; tagged cards unchanged (✓ day).
  - **DLGS-06** — Autonomous ship + prod verification: vitest (webapp) green, svelte-check delta zero NEW errors on touched files (baseline ~26–30 upstream), build-frontend.sh clean; PR opened + squash-merged (--admin, standing flow); `buildpub.yml -f apps=run.gpx -f regions=use1` (check for in-flight same-app runs first) then `deploy.yml -f region=us-east-1 -f pr_number=skip -f invalidate_cache=true`; Playwright prod probe confirms: layers button click-opens dialog, no `title` attrs in route rows, My Maps section order + footer Add run, hint bar updates on hover.

**Success Criteria** (what must be TRUE):

  1. Clicking the layers control opens a "Map Layers" dialog whose six sections all share one collapse affordance; toggling a group's master checkbox off collapses and dims it exactly as before; basemap switching, per-route toggles, check-in filters all still drive the map identically.
  2. Mousing across the route list produces NO floating tooltip and no flicker; route descriptions appear in the dialog's bottom hint bar.
  3. My Maps shows MY FILES above SHARED WITH YOU, labeled row actions (Edit + labeled ⋯ menu), header ⋯ housing New folder/Refresh/Export all, and Add run as the footer primary — with every existing action still functional (share, day-assign, route-publish, export, delete).
  4. All five StravaStrip card states read as actionable or done ("Pick a day" / "+ Import" / ✓ day) and open the same popover modes as today.
  5. gpx v0.0.10x is LIVE on use1 with the above verified by an automated Playwright probe against https://gpx.defcon.run — no human step anywhere between "plan approved" and "probe green" except the standing PR-merge authorization granted for this phase.

**Plans:** TBD

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
