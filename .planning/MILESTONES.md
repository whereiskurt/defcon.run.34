# Milestones

## v1.9 CMS-Driven UI Copy Catalog (Shipped: 2026-07-06)

**Phases completed:** 5 phases (35-39), 21 plans

**Key accomplishments:**

- `ui-string` Strapi catalog (`key·locale·value·namespace·notes`) with `(key,locale)` uniqueness (lifecycle 4xx guard + DB unique-index backstop), read-only API-token find/findOne, and a master-only S3 `copy.json` export regenerated on every create/update/delete
- Cached, fallback-safe copy toolkit: `loadCopy` wraps the Strapi→S3→committed-snapshot resolver in the Next.js Data Cache (`revalidate:300`); `t()` merged-map O(1) lookup with `{placeholder}` interpolation; `CopyProvider`/`useCopy` for client modals/toasts; XSS-safe inline markdown; UI never renders a raw dotted key
- Bib donate/sponsor proof surface fully catalog-driven end-to-end — the hardest case (client-side, interpolated, modal-heavy) — validating the whole approach
- Custom three-column `label·locale·value` Strapi admin page (first `register()`/`addMenuLink` in the repo) with client-side namespace filter, inline edit, add-row, and atomic bulk upsert reusing the Phase-35 uniqueness guard + S3 export
- Shared chrome unified under `common.header.*` / `common.profileMenu.*` keys read by BOTH run.bib and run.human — words de-dup without a shared React component (words-only scope); toolkit copy-ported into run.human with CopyProvider mounted in both group layouts
- **SC-3 headline proof, live on prod (2026-07-06):** operator import lifted the live catalog 64 → 93 keys; editing one shared `common.header.maps` row changed the wording on run.defcon.run in ~2m18s with no deploy and no shared component, then reverted. Discovered en route: what looked "already deployed" was code-only — the catalog rows had never been imported (the snapshot fallback masked the empty catalog until the source was read directly)

**Known verification overrides / deferrals at close:** 5 non-v1.9 items acknowledged and deferred (see STATE.md Deferred Items) — Phase 18/19 (v1.4 hardware verification), Phase 33 (OIDC silent SSO), and 2 backlog quick-tasks. Cross-region (cac1) copy convergence is N/A for the shipped topology (only us-east-1 deployed for copy-migrated apps). Deferred to v2: MIGR-04 (flash/human/auth/gpx migration), I18N-01 (locales + switcher).

---

## v1.5 Bib Registration (Shipped: 2026-07-03)

**Phases completed:** 4 phases (20-23), 12 plans — live at bib.defcon.run (us-east-1), first prod release v0.0.18

**Key accomplishments:**

- Two-container (nginx + Next.js) ECS Fargate service for bib.defcon.run modeled on run.flash — ACM + CloudFront (global+regional), ECR repos, `services/run.bib/service.hcl`, SSM secrets, reusing the shared `run-human-electro` DynamoDB table (no new table)
- Next.js webapp mirroring run.flash (region basePath/middleware, providers, theme) with the run.gpx Auth.js pattern — login required for ALL giving, no anonymous path; `Bib` + `BibReconcile` ElectroDB entities + `/api/bib` routes
- Login-gated `/orderform` (root `/` 307-redirects to it) with a 3-section layout: free "Get your bib" (nameOnBib + willPayInPerson + live DC34-SVG bib preview, `1337` placeholder replaced by the entered name), "Sponsor this bib" (custom-amount slider), and "Just donate"
- **Payments diverged from the original spec (Kurt design contract, 2026-07-02):** the planned `PaymentProvider` registry + preset tiers ($10/$20/$50/$500) + PayPal were dropped in favor of **Stripe Checkout (2 products) + Venmo/CashApp** with a **custom-amount slider**; name prints on the physical bib iff paidAmount ≥ $10 and an admin `nameLocked` flag hasn't fired; no size field
- `BIB-XXXX` immutable per-user runner reconciliation code as the Venmo/CashApp comment key, matched by a **SES → Haiku Lambda** (`claude-haiku-4-5-20251001`, $20/day budget cap) that extracts `{amount, comment, sender}` from forwarded receipt emails; unmatched → notification back to `defcon.run@gmail.com`
- run.bib wired into build.sh/deploy.sh/release-all.sh + buildpub.yml/deploy.yml (nginx + app components) piggybacking the existing held-release pipeline; iterated live through feedback batches 1-3 (green palette, amount chips, runner-code placement, sponsor+donate tiles) across ~25 hotfix releases

**Open at close (carried forward, not blocking):**

- Admin allowlist held only `whereiskurt@gmail.com` at close — Jesse's identity needs adding to `/dc34/secrets/use1/bib/admin/allowlist` (fail-closed by design)
- Live-payment HITL verification pending — real Stripe live-mode + a real Venmo/CashApp receipt round-trip can't run in sandbox; confirm live-vs-test Stripe product IDs (PR #309 pointed at sandbox) before real launch
- Deferred to v1.6+: anonymous `/api/checkout/general`, Venmo/CashApp general-donation matcher fallback, optional `byWillPayInPerson` GSI. Crypto (BTC/ETH) remains a deferred v2 item (PAY-01)

Archives: `.planning/milestones/v1.5-{REQUIREMENTS,ROADMAP,WORKSTREAM-STATE}.md` + `v1.5-phases/`.

---

## v1.3 Meshtk Integration (Shipped: 2026-07-01)

**Phases completed:** 4 phases, 9 plans, 18 tasks

**Key accomplishments:**

- Per-LB proxy_protocol_v2 toggle in ecs-service, conditional NLB SG output, and new nlb-dns latency-routing module
- MQTT service.hcl with 3 ECR repos, 4-port NLB listener mapping (1883/8883/443/8443), NLB enabled in both regions, and mqtt.defcon.run ACM/Route53 registration
- S3 blocklist and logs buckets per region with 30-day lifecycle, latency-based nlb-dns Route53 records for mqtt.defcon.run, and ecs-service mock outputs for run-mqtt
- Alpine-based Mosquitto broker container with entrypoint-generated config, 3 service accounts, and port 1884 TCP-only listener
- Multi-stage Go Dockerfiles for meshtk MQTT proxy (port 1883) and nginx/meshobserv meshmap server (port 80) with supervisord process management
- 4-container ECS task with dependency-ordered startup (mosquitto->meshtk->nginx+ghosts), NLB 443->nginx:80 port mapping, and local build.sh
- Extended build.sh and version.sh for 3 mqtt container components with per-component VERSION files and HCL file-based version reads
- Extended deploy.sh, release-all.sh, and buildpub.yml with mqtt 3-component build/deploy support using get_components() abstraction
- Full DC33 meshmap ported to DC34 with branding updates, path fixes, ghost mode cleanup, and Dockerfile asset serving

---

## v1.2 User Checkins (Shipped: 2026-03-06)

**Phases completed:** 4 phases, 4 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---

## v1.2 User Checkins (In Progress)

**Phases:** 10-13, 4 phases
**Goal:** Participants can GPS check-in from the browser with privacy controls, quota enforcement, and a map-based profile view of their check-in history.

---

## v1.1 CMS Content Types (Shipped: 2026-03-05)

**Phases completed:** 5 phases (5-9), 5 plans executed + 2 phases manually verified

**Key accomplishments:**

- Fixed worker Litestream sync safety (WAL checkpoint + safe swap)
- Upgraded S3 upload provider to Strapi 5
- Defined Event, Route, and POI content type schemas with shared coordinates component
- Wired bidirectional many-to-many relations (Events<->Routes, Routes<->POIs)
- Configured public REST API permissions with population, filtering, field selection
- Built DCR34-branded OIDC login page and error pages for cms.defcon.run
- CMS sync and seed data verified manually across regions

---

## v1.0 Meshtastic Flasher MVP (Shipped: 2026-03-02)

**Phases completed:** 4 phases, 9 plans, 0 tasks

**Key accomplishments:**

- (none recorded)

---
