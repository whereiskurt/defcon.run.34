# Phase 16: Build/Deploy Pipeline - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Integrate mqtt's 3 container images (mosquitto, meshtk, nginx) into the existing DCR34 build/deploy pipeline. After this phase, mqtt can be built, pushed to ECR, and deployed to both regions using the same `build.sh`, `deploy.sh`, `release-all.sh`, and GitHub Actions workflows as all other services. No new containers or infrastructure — pure script integration.

</domain>

<decisions>
## Implementation Decisions

### Build Script Integration (apps/build.sh)
- Extend existing `apps/build.sh` to support `run.mqtt` as a valid app
- 3 new components: `mosquitto`, `meshtk`, `nginx` — invoked as `./build.sh mosquitto run.mqtt`, etc.
- meshtk source resolution happens inside build.sh (not caller's responsibility)
- Build path is Docker build + ECR push only — no S3 asset sync, no CloudFront, no Next.js extraction
- Build context: `apps/mqtt/` as parent context for nginx (needs meshtk/ dir), component dirs for mosquitto and meshtk
- Local builds: `resolve_meshtk()` copies from symlink target `~/working/meshtk`, restores symlink after via trap
- CI builds (GITHUB_ACTIONS detected): `git clone --depth 1 https://github.com/whereiskurt/meshtk.git apps/mqtt/meshtk/` — public repo, no token needed, always clone main branch HEAD

### VERSION File Strategy
- 3 independent VERSION files: `apps/mqtt/mosquitto/VERSION`, `apps/mqtt/meshtk/VERSION`, `apps/mqtt/nginx/VERSION`
- Each image gets its own semver tag — independent bumps when only one container changes
- deploy.sh copies to terraform as `VERSION.mosquitto`, `VERSION.meshtk`, `VERSION.nginx` in `services/run.mqtt/`
- service.hcl reads each via `file("VERSION.mosquitto")` etc. to set per-container image tags
- Extend `version.sh` to support mqtt components: `./version.sh mosquitto run.mqtt`, etc.

### release-all.sh Integration
- Add new `get_components()` helper function returning component list per app
  - `run.mqtt` returns `mosquitto meshtk nginx`
  - `run.cms` returns `app`
  - `run.gpx` returns `webapp`
  - Default returns `nginx webapp`
- Build loop iterates components per app using `get_components()`
- `run.mqtt` included in default APPS list from the start
- `get_cf_domain()` returns empty for `run.mqtt` — existing skip logic handles no-CloudFront case
- Existing ECR probe (checks dc34-run-human-app) is sufficient — mqtt repos created by same terraform
- `get_tf_service()` maps `run.mqtt` to `run.mqtt`

### GitHub Actions / CI
- `buildpub.yml` default apps input updated to include `run.mqtt`
- Since buildpub.yml calls release-all.sh which calls build.sh, extending those scripts gives CI mqtt support automatically
- meshtk clone uses no auth (public repo) — no new secrets needed
- deploy.yml terragrunt apply works unchanged (ecs-task + ecs-service modules handle mqtt)

### Claude's Discretion
- Exact error messages and validation logic for mqtt component/app combinations in build.sh
- How to structure the mqtt case block alongside existing component cases
- VERSION file initial values (e.g., 0.1.0)
- Whether version.sh uses patch/minor/major bump logic or simple increment for mqtt

</decisions>

<specifics>
## Specific Ideas

- meshtk repo is public at https://github.com/whereiskurt/meshtk — no auth token needed for CI clones
- The local symlink pattern (apps/mqtt/meshtk/ -> ~/working/meshtk) stays for development; build.sh handles the copy-and-restore transparently
- mqtt has no webapp, no S3 assets, no CloudFront — the simplest build path in the project (just Docker + ECR)
- Ghosts container reuses mqtt-meshtk image — no separate build needed (ECS command override)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/build.sh`: Core build script with component/app pattern, ECR login, Docker buildx, region-specific tags
- `apps/deploy.sh`: VERSION file copy + terragrunt apply pattern
- `apps/release-all.sh`: Multi-region orchestrator with version bump, parallel builds, PR creation, CF invalidation
- `apps/version.sh`: Semver bump utility for VERSION files
- `apps/mqtt/build.sh`: Phase 15 local build script with `resolve_meshtk()` function (to be absorbed into apps/build.sh)

### Established Patterns
- `REPO_PREFIX` per app (e.g., `dc34-run-auth`) — mqtt uses `dc34-mqtt`
- `SKIP_ECR_LOGIN=true` for parallel builds (pre-auth all regions)
- Region-specific local tags: `${REPO_NAME}:${IMAGE_TAG}-${REGION_SHORT}`
- `get_*()` helper functions in release-all.sh for per-app configuration
- `GITHUB_ACTIONS` env var detection for CI vs local behavior differences

### Integration Points
- `apps/build.sh` component validation and case blocks — add mqtt components
- `apps/deploy.sh` VERSION file copy section — add mqtt 3-file pattern
- `apps/release-all.sh` helper functions + build loop + default APPS — add mqtt support
- `.github/workflows/buildpub.yml` default apps input — add run.mqtt
- `infra/terraform/live/site/services/run.mqtt/service.hcl` — read VERSION.mosquitto/meshtk/nginx files

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 16-build-deploy-pipeline*
*Context gathered: 2026-03-07*
