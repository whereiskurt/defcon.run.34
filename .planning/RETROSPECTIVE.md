# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Meshtastic Flasher MVP

**Shipped:** 2026-03-02
**Phases:** 4 | **Plans:** 9

### What Was Built
- Browser-based ESP32 firmware flasher with full wizard flow (pick → connect → flash → configure → done)
- esptool.js integration for Web Serial flashing with real-time progress
- @meshtastic/core integration for post-flash device configuration (MQTT, channels, identity, radio)
- Authenticated config API serving per-user MQTT credentials via run.human internal API
- Production deployment: 3-stage Docker builds, multi-region ECS Fargate, CloudFront CDN
- Full CI/CD integration: buildpub, deploy, rollback, npm-audit workflows

### What Worked
- Phase 1-3 execution was smooth — plan-then-execute with GSD worked well for greenfield code
- Reusing monorepo patterns (nginx sidecar, region router, OIDC flow) saved significant time in Phase 4
- Parallel plan execution (Wave 1 with 2 plans) worked cleanly when files don't overlap

### What Was Inefficient
- Phase 4 deployment had many post-plan fixes: missing mock outputs, SOPS secrets, favicon, SITE_DOMAIN_SLUG substitution, basePath for images/API paths, user ID mismatch (OIDC sub vs adapter UUID)
- Version bumping for each fix was tedious — immutable ECR tags require a new version for every code change
- The OIDC subject ≠ DynamoDB adapter userId gap wasn't caught during planning; required a runtime debug cycle to discover

### Patterns Established
- Internal service API pattern: flash calls run.human's `/api/internal/user/:oidcSub` rather than direct DB access. Clean service boundary that handles ID mapping.
- `{{SITE_LABEL}}` (not `{{SITE_DOMAIN_SLUG}}`) for Cloud Map service discovery namespaces
- All new apps need: mock outputs in ecs-service terragrunt, SOPS secrets, CI workflow entries, favicon

### Key Lessons
1. **Deployment plans should include mock outputs, SOPS entries, and CI workflows** — these are easily missed and block terragrunt plan/apply
2. **basePath affects everything in production** — images, API fetches, signin redirects all need the region prefix. Plan for this upfront.
3. **DynamoDB adapter generates its own user IDs** — any cross-service lookup needs the OIDC sub → adapter ID mapping, not raw token.sub
4. **Test the full OIDC flow end-to-end before calling deployment "complete"** — signin, session, service claims, internal API calls

### Cost Observations
- Model mix: primarily opus for planning and execution
- Sessions: 2 (planning + execution/deployment in one long session)
- Notable: Most time spent on deployment fixes, not on app code. The 4 code phases went fast; infra wiring was the bottleneck.

---

## Milestone: v1.3 — Meshtk Integration

**Shipped:** 2026-07-01
**Phases:** 4 (14–17) | **Plans:** 9 | **Tasks:** 18

### What Was Built
- NLB-based mqtt.defcon.run in both regions with 4 listeners (1883/8883/443/8443) and TLS termination; latency-based Route53 routing via a new `nlb-dns` module
- Per-load-balancer Proxy Protocol v2 toggle in the `ecs-service` module (PP2 on meshtk ports only) plus conditional NLB security-group output
- 4-container ECS task: Alpine mosquitto broker (entrypoint-generated config/ACL), meshtk MQTT proxy, nginx/meshobserv meshmap server, and ghosts — with dependency-ordered startup
- meshtk vendored as a gitignored copy (CI clones from GitHub, local copies from symlink); meshobserv is the same Go binary run as `server inspect`
- build.sh/deploy.sh/release-all.sh/buildpub.yml extended for a 3-image multi-container service via a `get_components()` abstraction and per-component VERSION files
- Full DC33 meshmap ported to DC34 with branding, path fixes, and ghost-mode cleanup

### What Worked
- Porting proven DC33 infrastructure (meshmap, container topology) rather than rebuilding kept the milestone tight
- The `get_components()` refactor generalized the build/deploy scripts cleanly for multi-container services
- Isolating the PP2 behavior behind a per-LB toggle avoided regressions for existing NLB TCP targets

### What Was Inefficient
- Non-standard `apps/mqtt/` directory (vs `run.mqtt`) required an `APP_DIR` override and later a naming-consistency fix (`629d143f`) — the run-mqtt vs mqtt naming drifted across ECR repos, containers, and build prefixes
- Several small mqtt fixes (PSK validation on PUBLISH, mosquitto log spam, packet inspection enablement) needed follow-up release bumps after initial deploy

### Patterns Established
- New `nlb-dns` terraform module for latency-based Route53 alias records to regional NLBs (reusable for any raw-TCP service)
- Per-LB `proxy_protocol_v2` toggle pattern in `ecs-service`
- Vendored-but-gitignored upstream source pattern (Dockerfile tracked, Go source gitignored; CI resolves from GitHub)

### Key Lessons
1. **Raw-TCP services can't sit behind CloudFront** — NLB-only + Route53 latency routing is the pattern for MQTT-style endpoints
2. **Keep service/directory naming consistent from the start** — the mqtt vs run-mqtt drift caused avoidable ECR/container/build-prefix churn
3. **Deferring non-essential scope (Phase 18 easter egg) at close is cheaper than half-building it** — captured to backlog for a future milestone

### Cost Observations
- Model mix: primarily opus for planning and execution
- Sessions: multiple (infra-heavy, many small release iterations)
- Notable: as with v1.0, infra wiring (naming, NLB, PP2) dominated over application logic

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 4 | 9 | First milestone — established deployment checklist patterns |
| v1.3 | 4 | 9 | Multi-container ECS + NLB raw-TCP service; `get_components()` build abstraction |

### Top Lessons (Verified Across Milestones)

1. Deployment infra (mock outputs, secrets, CI entries) is the most error-prone phase — needs explicit checklist
2. basePath/region prefix handling in Next.js requires systematic review of all absolute paths
3. Service/directory naming must be locked early — drift propagates into ECR repos, container names, and build prefixes
