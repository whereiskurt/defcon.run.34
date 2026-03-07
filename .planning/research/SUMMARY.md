# Project Research Summary

**Project:** defcon.run.34 v1.3 Meshtk Integration
**Domain:** MQTT broker infrastructure + Meshtastic mesh network visualization for DEF CON 34
**Researched:** 2026-03-06
**Confidence:** HIGH

## Executive Summary

The v1.3 milestone ports proven MQTT infrastructure from defcon.run.33 into the existing multi-region ECS Fargate platform. The system consists of four tightly-coupled containers -- Mosquitto MQTT broker, meshtk packet inspection proxy, meshmap/meshobserv live visualization, and a fleet simulator -- deployed as a single ECS task per region. This is not greenfield development; the application code exists and works. The challenge is infrastructure integration: wiring NLB listeners, security groups, ECR repos, and Route53 DNS into the existing Terraform module ecosystem.

The single most important architectural decision is that `mqtt.defcon.run` points exclusively to the NLB, not CloudFront. MQTT is a raw TCP protocol that CloudFront cannot proxy. Attempting to split DNS between CloudFront and NLB for the same domain is impossible (Route53 alias records support only one target per name+type). The meshmap web UI is lightweight enough that NLB-served HTTPS is sufficient -- no CDN caching needed. This simplifies the architecture dramatically compared to every other service in the platform.

The highest-risk items are invisible infrastructure behaviors: the ecs-service Terraform module auto-enables Proxy Protocol v2 on all NLB TCP target groups (which breaks Mosquitto), and the default security group outputs exclude MQTT ports (which blocks all NLB traffic to ECS tasks). Both must be fixed in Phase 1 before any container deployment. The application-layer work (Dockerfiles, configs, build scripts) is lower risk because the .33 source code provides working reference implementations.

## Key Findings

### Recommended Stack

The stack adds three new container images to the existing ECS Fargate platform with no new runtime frameworks or infrastructure patterns beyond NLB. All existing Terraform modules (network, ecs-task, ecs-service, certs, ecr) are reused with minor modifications.

**Core technologies:**
- **Eclipse Mosquitto 2.0.22-alpine**: MQTT broker -- proven at DC33, handles 500+ device connections easily, 4.7MB image
- **meshtk (Go 1.24)**: gRPC/MQTT proxy -- packet inspection, rate limiting, S3 logging, PROXY protocol parsing; multi-stage Docker build to alpine runtime
- **nginx 1.28-alpine + meshobserv**: meshmap web server + Go binary that subscribes to MQTT, decrypts Meshtastic protobuf packets, maintains in-memory NodeDB, writes `nodes.json` for map polling
- **NLB with 4 TLS/TCP listeners**: ports 1883 (plaintext MQTT), 8883 (TLS MQTT), 443 (meshmap HTTPS), 8443 (WebSocket MQTT) -- all served from the same NLB per region
- **Route53 latency-based routing**: `mqtt.defcon.run` resolves to nearest regional NLB

**Critical version pins:** Mosquitto 2.0.22 (not latest), Go 1.24, nginx 1.28-stable, alpine 3.21.

### Expected Features

**Must have (table stakes):**
- Mosquitto broker with password auth + ACL (per-device credentials from flash.defcon.run)
- Meshtk proxy in front of mosquitto (packet inspection, rate limiting, S3 blocklist)
- Meshmap with live node positions, identity, telemetry, neighbor topology
- AES-CTR decryption of Meshtastic channel traffic
- NLB listeners in both regions with TLS termination via ACM
- ECR repos + build/deploy pipeline for 3 container images
- 4-container ECS task definition (mosquitto, meshtk, nginx/meshobserv, ghosts)

**Should have (differentiators):**
- Fleet simulator (ghosts) with GPX-based movement paths
- Ghost mode easter egg on meshmap (Konami code reveals ghost nodes)
- DC34 branding on meshmap (logo, colors, node naming patterns)
- Color-coded markers by node role, marker clustering, dark mode

**Defer (v2+):**
- PKI-encrypted DM replies from fleet bots (HIGH complexity, LOW user value)
- OTP challenge-response via mesh (requires accomplishments API endpoint)
- OpenAI chatbot integration (config-only enable, but needs testing)
- Mosquitto security inspector C plugin (disabled in .33, proxy mode sufficient)
- Cross-region MQTT bridging (unnecessary -- all participants in Las Vegas)

### Architecture Approach

A single ECS Fargate task per region containing 4 containers that share a network namespace (localhost). NLB handles all external traffic on 4 ports, terminating TLS via ACM certs and forwarding plaintext TCP to containers. No CloudFront distribution for mqtt.defcon.run. Route53 latency-based routing sends radios to the nearest region.

**Major components:**
1. **mosquitto** (essential) -- MQTT broker, ports 1883/9001, password auth + ACL
2. **meshtk** (essential) -- sits in front of mosquitto, inspects every packet, rate limits, logs to S3
3. **nginx/meshobserv** (essential) -- serves meshmap static HTML, meshobserv decrypts Meshtastic packets and writes `nodes.json`
4. **ghosts** (non-essential) -- fleet simulator publishing fake node positions via MQTT

### Critical Pitfalls

1. **Proxy Protocol v2 auto-enabled breaks Mosquitto** -- The ecs-service module (main.tf:167) silently enables PP2 on all NLB TCP target groups. Mosquitto interprets PP2 headers as malformed MQTT and disconnects all clients. Fix: add explicit `proxy_protocol_v2` boolean to load_balancer config, default false.

2. **Security groups block NLB traffic to ECS tasks** -- Default `security_group_ids` output only includes ALB ports (443, 80). MQTT ports (1883, 9001) are blocked. Fix: add NLB security group to mqtt ECS task security group list.

3. **Container dependency chain stalls task startup** -- Chaining health check dependencies (mosquitto -> meshtk -> nginx) causes PROVISIONING timeout. Fix: flat dependency topology -- meshtk and ghosts depend on mosquitto HEALTHY, nginx has no dependencies. Set mosquitto start_period to 30s.

4. **Port conflicts in shared network namespace** -- All 4 containers share one IP. Two containers binding the same port kills the task. Fix: document port allocation upfront (mosquitto: 1883/9001, nginx: 80/443/8443, meshtk: 4403, ghosts: none).

5. **Go binary cross-compiled for wrong architecture** -- meshtk built on macOS produces darwin/arm64 binary that crashes in Fargate (linux/amd64). Fix: explicit `CGO_ENABLED=0 GOOS=linux GOARCH=amd64` in Dockerfile.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Infrastructure Foundation
**Rationale:** Every other phase depends on NLB, ECR repos, security groups, and DNS being operational. The two critical pitfalls (Proxy Protocol v2, security groups) must be fixed here or everything downstream fails silently.
**Delivers:** Working NLB with 4 listeners in both regions, ECR repos, ACM cert verification, Route53 DNS, patched ecs-service module, S3 blocklist bucket
**Addresses:** NLB listeners (P1), ACM certs (P1), both-region deployment (P1), ECR repos (P1)
**Avoids:** Pitfalls #1 (Proxy Protocol), #2 (security groups), #4 (ACM timing), #7 (DNS split)

### Phase 2: Container Images + Task Definition
**Rationale:** With infrastructure ready, build and deploy the 4-container ECS task. This is primarily porting Dockerfiles and configs from .33 with architecture-specific adjustments (port allocation, health checks, dependency ordering).
**Delivers:** 3 Docker images built and pushed to ECR, 4-container task definition, working mosquitto broker accepting MQTT connections, meshmap serving static content, meshtk inspecting packets
**Uses:** Mosquitto 2.0.22-alpine, Go 1.24 multi-stage build, nginx 1.28-alpine
**Implements:** Multi-container ECS task with shared localhost networking
**Avoids:** Pitfalls #3 (dependency stalls), #5 (port conflicts), #6 (health check noise), #8 (Go cross-compilation)

### Phase 3: Build/Deploy Pipeline + Validation
**Rationale:** Adapt existing build.sh/deploy.sh/release-all.sh for mqtt's 4-component structure. Validate end-to-end: radio connects via TLS MQTT, packet appears on meshmap.
**Delivers:** build.sh support for mqtt components, deploy.sh with 4 VERSION files, release-all.sh integration, end-to-end connectivity validation
**Addresses:** ECR + build/deploy pipeline (P1), both-region deployment (P1)

### Phase 4: Fleet Simulator + Branding
**Rationale:** Once core infrastructure is validated, add the fleet simulator (ghosts container) and update meshmap branding for DC34. These are low-risk additions that enhance the event experience.
**Delivers:** Ghost nodes walking GPX routes on meshmap, DC34 branding, ghost mode easter egg, color-coded markers
**Addresses:** Fleet simulator (P2), DC34 branding (P2), ghost mode easter egg (P2)

### Phase Ordering Rationale

- Infrastructure (Phase 1) before containers (Phase 2) because NLB listeners, security groups, and ECR repos are hard prerequisites -- containers cannot be deployed without them
- Container images (Phase 2) before pipeline (Phase 3) because you need working Dockerfiles before automating their build
- Core functionality (Phases 1-3) before engagement features (Phase 4) because ghosts and branding are enhancements, not blockers
- All phases avoid the CloudFront anti-pattern -- no CloudFront distribution for mqtt.defcon.run at any phase

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** Route53 NLB alias record creation -- not covered by existing cloudfront module, needs new Terraform resources or module extension. Investigate whether to extend network module or create standalone dns module.
- **Phase 1:** ecs-service module modification for proxy_protocol_v2 override -- needs careful variable surgery to avoid breaking existing services.

Phases with standard patterns (skip research-phase):
- **Phase 2:** Container image builds follow existing patterns (Dockerfiles, VERSION files, ECR push). The .33 source code provides complete reference implementations.
- **Phase 3:** Build/deploy pipeline is mechanical adaptation of existing scripts.
- **Phase 4:** Fleet simulator and branding are application-level changes with no infrastructure dependencies.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies proven at DC33. Container images, versions, and port allocations verified against existing codebase and Docker Hub. |
| Features | HIGH | Direct source code access to .33 implementation. Feature list derived from working code, not speculation. |
| Architecture | HIGH | NLB-only approach verified against AWS documentation. Existing Terraform modules inspected line-by-line. Port allocations and security group rules confirmed. |
| Pitfalls | HIGH | Top pitfalls identified from existing module source code (proxy_protocol_v2 auto-enable, security group outputs). AWS documentation confirms CloudFront/MQTT incompatibility. |

**Overall confidence:** HIGH

### Gaps to Address

- **Route53 DNS for NLB:** The existing cloudfront module only creates DNS records pointing to CloudFront distributions. A new mechanism is needed for NLB alias records. Decision needed: extend network module vs. new dns module vs. manual Route53 resources in service.hcl.
- **meshtk source checkout process:** meshtk is gitignored and manually copied from `~/working/meshtk`. The build pipeline needs a documented, repeatable process for this. Consider a pre-build script or Makefile target.
- **Proxy Protocol v2 module change scope:** Modifying the ecs-service module variable definition affects all services. Ensure the default (`false`) does not break existing ALB-backed services (it should not -- the auto-enable logic only triggers for NLB+TCP, which no existing service uses).
- **Port 1883 public exposure:** The NLB security group currently allows plaintext MQTT (port 1883) from 0.0.0.0/0. This should be restricted to VPC CIDR or removed entirely for production. Decision needed during Phase 1.

## Sources

### Primary (HIGH confidence)
- Existing codebase `infra/terraform/modules/ecs-service/v1.0.0/main.tf` -- proxy_protocol_v2 auto-enable, NLB listener creation
- Existing codebase `infra/terraform/modules/network/v1.0.0/` -- NLB definition, security groups, outputs
- Existing codebase `infra/terraform/modules/certs/v1.0.0/acm.tf` -- per-region ACM cert creation
- defcon.run.33 source code `apps/mqtt/` -- complete working implementation of all containers
- [Eclipse Mosquitto Docker Hub](https://hub.docker.com/_/eclipse-mosquitto) -- v2.0.22-alpine
- [AWS NLB TLS Listeners](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/create-tls-listener.html) -- ACM cert requirements
- [AWS Route53 Alias Records](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-values-alias.html) -- single-target constraint

### Secondary (MEDIUM confidence)
- [CloudFront MQTT protocol support](https://support.skax.co.kr/en/support/solutions/articles/42000098157--cloudfront-mqtt-protocol-support) -- confirms MQTT not supported
- [NLB MQTT support](https://repost.aws/questions/QU1jC47iEFRYiQQLIFkwcZHg/does-nlb-support-mqtt) -- community confirmation
- [Mosquitto Docker Configuration Guide](https://cedalo.com/blog/mosquitto-docker-configuration-ultimate-guide/) -- container config patterns
- [ECS Container Dependency API Reference](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ContainerDependency.html) -- HEALTHY condition behavior

---
*Research completed: 2026-03-06*
*Ready for roadmap: yes*
