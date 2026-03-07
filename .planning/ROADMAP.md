# Roadmap: DEF CON Run 34

## Milestones

- [x] **v1.0 Meshtastic Flasher MVP** - Phases 1-4 (shipped 2026-03-02)
- [x] **v1.1 CMS Content Types** - Phases 5-9 (shipped 2026-03-05)
- [x] **v1.2 User Checkins** - Phases 10-13 (shipped 2026-03-06)
- [ ] **v1.3 Meshtk Integration** - Phases 14-18 (in progress)

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

### v1.3 Meshtk Integration (In Progress)

**Milestone Goal:** Replicate the defcon.run.33 MQTT/meshtk infrastructure in defcon.run.34 -- mosquitto broker, meshtk proxy, meshmap, and fleet simulator deployed via NLB to both regions at mqtt.defcon.run.

- [x] **Phase 14: Infrastructure Foundation** - NLB, security groups, ECR repos, ACM certs, Route53 DNS, S3 buckets, SSM params, ecs-service PP2 fix (completed 2026-03-07)
- [x] **Phase 15: Container Images + Task Definition** - Mosquitto, meshtk, nginx/meshobserv, ghosts Dockerfiles and 4-container ECS task (completed 2026-03-07)
- [x] **Phase 16: Build/Deploy Pipeline** - build.sh, deploy.sh, release-all.sh adapted for mqtt multi-container service (completed 2026-03-07)
- [ ] **Phase 17: Meshmap Verification + Branding** - Validate meshmap features ported from DC33, apply DC34 branding
- [ ] **Phase 18: Fleet Simulator + Easter Egg** - Ghost fleet with GPX movement and meshmap easter egg

## Phase Details

### Phase 14: Infrastructure Foundation
**Goal**: All AWS infrastructure required by mqtt.defcon.run is provisioned and reachable in both regions
**Depends on**: Nothing (first phase of v1.3)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07, INFRA-08, INFRA-09, INFRA-10
**Success Criteria** (what must be TRUE):
  1. NLB in both regions accepts TCP connections on ports 1883, 8883, 443, and 8443 with TLS termination on the TLS ports
  2. mqtt.defcon.run resolves to the nearest regional NLB via latency-based DNS
  3. ECR repositories for mqtt-mosquitto, mqtt-nginx, and mqtt-meshtk exist in both regions and accept image pushes
  4. ecs-service module allows Proxy Protocol v2 to be explicitly disabled per load_balancer entry (not auto-enabled for all NLB TCP targets)
  5. Security group attached to ECS tasks permits inbound NLB traffic on all MQTT service ports (1883/8883/443/8443/9001)
**Plans**: 3 plans

Plans:
- [ ] 14-01-PLAN.md — Module patches: ecs-service PP2 toggle, network SG output, nlb-dns module
- [ ] 14-02-PLAN.md — Config files: service.hcl, site.hcl wiring, NLB enable, SSM params
- [ ] 14-03-PLAN.md — Regional resources: S3 buckets, nlb-dns wiring, ecs-service mock updates

### Phase 15: Container Images + Task Definition
**Goal**: All four container images build successfully and run as a single ECS task with correct networking and health checks
**Depends on**: Phase 14
**Requirements**: CONT-01, CONT-02, CONT-03, CONT-04, CONT-05, CONT-06, CONT-07
**Success Criteria** (what must be TRUE):
  1. Mosquitto container accepts MQTT connections on port 1883 with password authentication and ACL enforcement
  2. Meshtk proxy container inspects packets between clients and mosquitto, rate limits abusive connections, and writes inspection logs to S3
  3. Nginx container serves meshmap HTML on port 443 and meshobserv subscribes to MQTT, decrypts Meshtastic traffic, and writes nodes.json
  4. 4-container ECS task starts successfully with mosquitto healthy before meshtk and ghosts begin, no port conflicts
  5. Ghosts container failure does not prevent the remaining three containers from running
**Plans**: 3 plans

Plans:
- [ ] 15-01-PLAN.md — Directory setup + Mosquitto container: apps/mqtt/ dir, meshtk symlink, .gitignore, mosquitto Dockerfile/entrypoint/ACL
- [ ] 15-02-PLAN.md — Meshtk proxy + Nginx/meshobserv containers: multi-stage Go Dockerfiles, supervisord, nginx.conf
- [ ] 15-03-PLAN.md — ECS task definition + build script: 4-container service.hcl, NLB port updates, apps/mqtt/build.sh

### Phase 16: Build/Deploy Pipeline
**Goal**: mqtt containers can be built, pushed, and deployed to both regions using the same scripts as other DCR34 services
**Depends on**: Phase 15
**Requirements**: CONT-08, CONT-09
**Success Criteria** (what must be TRUE):
  1. build.sh builds and pushes all three mqtt container images (mosquitto, nginx, meshtk) to ECR in the target region
  2. deploy.sh deploys the mqtt ECS service using VERSION files and release-all.sh includes mqtt in parallel multi-region releases
**Plans**: 2 plans

Plans:
- [ ] 16-01-PLAN.md — Build scripts: VERSION files, build.sh + version.sh mqtt support, service.hcl VERSION file reads
- [ ] 16-02-PLAN.md — Deploy scripts: deploy.sh mqtt VERSION copy, release-all.sh multi-component support, buildpub.yml update

### Phase 17: Meshmap Verification + Branding
**Goal**: Meshmap displays live Meshtastic network state with DC34 branding, fully ported from DC33
**Depends on**: Phase 16
**Requirements**: MESH-01, MESH-02, MESH-03, MESH-04, MESH-05, MESH-06, MESH-07, MESH-08, MESH-09, MESH-10, MESH-11
**Success Criteria** (what must be TRUE):
  1. Meshmap at mqtt.defcon.run shows live node positions on a Leaflet map, with popups displaying node identity (longName, shortName, hwModel, role) and device telemetry (battery, voltage, channel utilization)
  2. Neighbor topology lines connect nearby nodes with SNR and distance tooltips, and markers cluster at low zoom levels (disabling at zoom 10)
  3. Meshobserv decrypts AES-CTR Meshtastic channel traffic and node search finds nodes by name or hex ID
  4. Dark mode toggle persists via localStorage and node markers fade in opacity based on last-seen age (36-hour fade)
  5. All labels, event name, and year references updated from DC33 to DC34
**Plans**: TBD

Plans:
- [ ] 17-01: TBD

### Phase 18: Fleet Simulator + Easter Egg
**Goal**: Simulated ghost fleet populates meshmap with moving nodes and a hidden easter egg rewards discovery
**Depends on**: Phase 17
**Requirements**: FLEET-01, FLEET-02, FLEET-03, FLEET-04
**Success Criteria** (what must be TRUE):
  1. Fleet simulator publishes simulated node positions via MQTT that appear on meshmap following GPX-based movement paths
  2. Simulation lifecycle ramps up nodes gradually, maintains steady-state, and ramps down with configurable timing
  3. Konami code or theme toggle on meshmap reveals ghost nodes with custom icons and triggers an accomplishment API call to run.defcon.run
**Plans**: TBD

Plans:
- [ ] 18-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 14 -> 15 -> 16 -> 17 -> 18

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 14. Infrastructure Foundation | 3/3 | Complete    | 2026-03-07 | - |
| 15. Container Images + Task Definition | 3/3 | Complete    | 2026-03-07 | - |
| 16. Build/Deploy Pipeline | 2/2 | Complete   | 2026-03-07 | - |
| 17. Meshmap Verification + Branding | v1.3 | 0/? | Not started | - |
| 18. Fleet Simulator + Easter Egg | v1.3 | 0/? | Not started | - |
