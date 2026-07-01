# Milestones

## v1.4 Bib Registration (Planned)

**Phases:** 19-22, 4 phases
**Goal:** Participants register a race bib at bib.defcon.run — name-on-bib (auto-shrink, ~32 chars) + give tiers ($10/$20/$50/$500), paying at launch via cash on-site, Stripe, or PayPal/Venmo behind one provider-agnostic seam (crypto BTC/ETH seam-ready, deferred) — deployed to both regions with the flash.defcon.run two-container layout, the run.gpx auth pattern, and the existing GitHub Actions held-release pipeline. See `.planning/AUTONOMOUS-BUILD.md`.

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
