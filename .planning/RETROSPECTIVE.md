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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 4 | 9 | First milestone — established deployment checklist patterns |

### Top Lessons (Verified Across Milestones)

1. Deployment infra (mock outputs, secrets, CI entries) is the most error-prone phase — needs explicit checklist
2. basePath/region prefix handling in Next.js requires systematic review of all absolute paths
