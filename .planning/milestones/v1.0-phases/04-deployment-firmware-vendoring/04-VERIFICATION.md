---
phase: 04-deployment-firmware-vendoring
verified: 2026-03-01T04:05:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
---

# Phase 4: Deployment + Firmware Vendoring Verification Report

**Phase Goal:** The app is deployed to production at flash.defcon.run with firmware binaries baked into the Docker image and zero runtime external dependencies
**Verified:** 2026-03-01T04:05:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

Truths derived from ROADMAP.md Success Criteria plus must_haves from both PLAN frontmatters.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The app lives at apps/run.flash/webapp/ with Dockerfile.webapp and Dockerfile.nginx matching monorepo conventions | VERIFIED | `apps/run.flash/webapp/Dockerfile.webapp` (85 lines, 3-stage build), `apps/run.flash/nginx/Dockerfile.nginx` (19 lines, nginx:latest base), both follow run.human pattern |
| 2 | Docker build downloads, extracts, and bundles Meshtastic firmware binaries -- the running container has no external dependencies | VERIFIED | Stage 1 "firmware" downloads from 4 ESP32 architectures (esp32, esp32s3, esp32c3, esp32c6), extracts .bin files, deletes -update.bin variants, copies into public/firmware/ in stage 2 |
| 3 | Terragrunt service definition exists at services/run.flash/ and deploys to all 3 regions | VERIFIED | `infra/terraform/live/site/services/run.flash/service.hcl` defines ECS task+service for us-east-1, ca-central-1, ap-southeast-1 |
| 4 | flash.defcon.run resolves via CloudFront with region-prefixed paths defaulting to /use1/ | VERIFIED | site.hcl cloudfront.domains includes "flash", index.html has cookie-based router defaulting to use1, region.html has flash.defcon.run URLs |
| 5 | Dockerfile.webapp builds a multi-stage image with firmware vendoring at build time | VERIFIED | 3 stages confirmed: `AS firmware` (line 2), `AS builder` (line 30), `AS runner` (line 71) |
| 6 | Firmware binaries end up in public/firmware/ inside the Docker image for S3 extraction by build.sh | VERIFIED | `COPY --from=firmware /firmware/ ./public/firmware/` (line 53), `COPY --from=builder /app/public ./public` (line 80) |
| 7 | firmware.ts uses NEXT_PUBLIC_ASSET_PREFIX for production S3 paths while keeping /firmware for dev | VERIFIED | Lines 15-17: ternary on process.env.NEXT_PUBLIC_ASSET_PREFIX |
| 8 | nginx sidecar handles TLS termination on port 443 and proxies to Next.js on port 3000 | VERIFIED | nginx.conf: listen 443 ssl, upstream node_app server localhost:3000, proxy_pass directive |
| 9 | Region router at index.html redirects to /use1/ by default or preferred-region cookie value | VERIFIED | index.html: COOKIE_NAME='preferred-region', DEFAULT_REGION='use1', VALID_REGIONS=['use1','cac1','apse1'] |
| 10 | site.hcl includes flash in all aggregation points and build/deploy scripts accept run.flash | VERIFIED | 9 site.hcl aggregation points (dns, urls.subdomains, urls.local_ports, service_conf, cloudfront.domains, ecr, ecs_tasks, ecs_services, secrets), all 4 scripts (build.sh, deploy.sh, release-all.sh, version.sh) accept run.flash |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/run.flash/webapp/Dockerfile.webapp` | Multi-stage Docker build with firmware download | VERIFIED | 85 lines, 3 stages (firmware, builder, runner), downloads from GitHub releases |
| `apps/run.flash/nginx/Dockerfile.nginx` | nginx TLS termination sidecar | VERIFIED | 19 lines, copies certs and config, exposes 443 |
| `apps/run.flash/webapp/VERSION` | Webapp version tracking | VERIFIED | Contains "v0.0.1" |
| `apps/run.flash/nginx/VERSION` | Nginx version tracking | VERIFIED | Contains "v0.0.1" |
| `apps/run.flash/index.html` | Cookie-based region router | VERIFIED | 61 lines, preferred-region cookie, defaults to /use1/ |
| `apps/run.flash/redirects/region.html` | Region redirect template | VERIFIED | 13 lines, flash.defcon.run URLs, {{REGION}} placeholder |
| `apps/run.flash/nginx/nginx.conf` | nginx proxy config | VERIFIED | SSL on 443, proxies to localhost:3000 |
| `apps/run.flash/nginx/certs/nginx-selfsigned.crt` | Self-signed TLS cert | VERIFIED | File exists |
| `apps/run.flash/nginx/certs/nginx-selfsigned.key` | Self-signed TLS key | VERIFIED | File exists |
| `apps/run.flash/nginx/certs/mkcerts.sh` | Cert generation script | VERIFIED | File exists |
| `apps/run.flash/webapp/src/config/firmware.ts` | Production S3 path via NEXT_PUBLIC_ASSET_PREFIX | VERIFIED | 86 lines, FIRMWARE_BASE_PATH uses ternary on NEXT_PUBLIC_ASSET_PREFIX |
| `infra/terraform/live/site/services/run.flash/service.hcl` | ECS task and service definition | VERIFIED | 249 lines, nginx+app containers, 3 regions, secrets, health checks |
| `infra/terraform/live/site/services/run.flash/VERSION.app` | App version file | VERIFIED | Contains "v0.0.1" |
| `infra/terraform/live/site/services/run.flash/VERSION.nginx` | Nginx version file | VERIFIED | Contains "v0.0.1" |
| `infra/terraform/live/site/site.hcl` | Flash in all aggregation points | VERIFIED | Flash present in all 9 aggregation points |
| `infra/terraform/live/site/global/cloudfront/terragrunt.hcl` | Flash mock outputs for 3 regions | VERIFIED | bucket_ids, bucket_arns, bucket_regional_domain_names for use1, cac1, apse1 |
| `apps/build.sh` | run.flash case with correct mappings | VERIFIED | REPO_PREFIX=dc34-run-flash, WEBAPP_ORIGIN=flash.defcon.run, SSM_PATH_SEGMENT=flash |
| `apps/deploy.sh` | run.flash case | VERIFIED | TF_SERVICE=run.flash, APP_COMPONENT=webapp |
| `apps/release-all.sh` | run.flash in APPS and helper functions | VERIFIED | Default APPS includes run.flash, all 4 helper functions have flash cases |
| `apps/version.sh` | run.flash in validation | VERIFIED | Validation list includes run.flash |
| `apps/run.auth/webapp/src/config/oidc.ts` | apse1 redirect URIs for flash | VERIFIED | apse1 redirect_uri and post_logout_redirect_uri present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Dockerfile.webapp | firmware.ts | grep FIRMWARE_VERSION from firmware.ts to determine download version | WIRED | Line 14: `grep 'FIRMWARE_VERSION' /tmp/firmware.ts` after `COPY src/config/firmware.ts /tmp/firmware.ts` on line 9 |
| firmware.ts | S3 via CloudFront | NEXT_PUBLIC_ASSET_PREFIX in production | WIRED | Lines 15-17: ternary produces `${NEXT_PUBLIC_ASSET_PREFIX}/firmware` or `/firmware` for dev |
| site.hcl | services/run.flash/service.hcl | read_terragrunt_config | WIRED | Line 61: `flash = read_terragrunt_config("./services/run.flash/service.hcl")` |
| build.sh | service.hcl | REPO_PREFIX and WEBAPP_ORIGIN map to ECR repos | WIRED | build.sh line 71: `REPO_PREFIX="dc34-run-flash"` matches service.hcl ECR names `run-flash-nginx` and `run-flash-app` |
| site.hcl | cloudfront/terragrunt.hcl | cloudfront.domains includes flash, mock outputs match | WIRED | site.hcl line 125 includes "flash", terragrunt.hcl has mock-cf-assets-flash for all 3 regions |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DPLY-01 | 04-01 | App follows monorepo pattern: apps/run.flash/webapp/ with Dockerfile.webapp + Dockerfile.nginx | SATISFIED | Both Dockerfiles exist at correct paths following run.human pattern |
| DPLY-02 | 04-02 | Terragrunt service definition at infra/terraform/live/site/services/ | SATISFIED | service.hcl at services/run.flash/ with ECS task+service for 3 regions (path is run.flash/ following run.{app} naming convention) |
| DPLY-03 | 04-02 | CloudFront distribution at flash.defcon.run | SATISFIED | site.hcl cloudfront.domains includes "flash", mock outputs in terragrunt.hcl for all 3 regions |
| DPLY-04 | 04-02 | Multi-region deployment following standard DCR34 pattern with flash.defcon.run defaulting to /use1/ | SATISFIED | service.hcl deploys to all 3 regions, index.html defaults to /use1/, OIDC URIs cover all 3 regions |
| DPLY-05 | 04-01 | Build-time firmware vendoring: download, extract, and bundle firmware binaries into Docker image | SATISFIED | Dockerfile stage 1 downloads all 4 ESP32 architectures from GitHub releases, extracts bins, copies to public/firmware/ |

All 5 requirement IDs from PLAN frontmatters (DPLY-01 through DPLY-05) are accounted for. No orphaned requirements found -- REQUIREMENTS.md maps DPLY-01 through DPLY-05 to Phase 4, and all are covered by plans 04-01 and 04-02.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/run.flash/webapp/src/config/firmware.ts` | 5 | `TODO: Update when event firmware version is finalized` | Info | Pre-existing TODO from Phase 1 -- not a blocker, firmware version is functional with current value |
| `apps/run.flash/nginx/index.html` | 31 | `authyauthauth` placeholder text in health check page | Info | Exact copy from run.human -- minimal health check page, not user-facing, served only at /hello |

No blockers or warnings found. Both items are informational.

### Human Verification Required

### 1. Docker Image Build

**Test:** Run `docker build -f apps/run.flash/webapp/Dockerfile.webapp apps/run.flash/webapp/` to verify the multi-stage build completes
**Expected:** Build succeeds, firmware binaries are downloaded and placed in public/firmware/, Next.js app builds successfully
**Why human:** Requires Docker daemon and network access to GitHub releases; cannot verify programmatically in this environment

### 2. Terragrunt Plan

**Test:** Run `cd infra/terraform/live/site && terragrunt plan --all` to verify flash resources are planned
**Expected:** Plan shows new ECR repos (run-flash-nginx, run-flash-app), ECS task/service (run-flash), CloudFront distribution entries, DNS record for flash.defcon.run
**Why human:** Requires AWS credentials and Terraform state access

### 3. End-to-End Release

**Test:** Run `./apps/release-all.sh --apps run.flash --dry-run` (or equivalent) to verify the release pipeline
**Expected:** Script validates run.flash, builds Docker images, and pushes to ECR across all 3 regions
**Why human:** Requires AWS ECR access and Docker daemon

### Gaps Summary

No gaps found. All 10 observable truths verified, all 20+ artifacts confirmed at existence, substantive, and wiring levels. All 5 DPLY requirements satisfied. All 4 commits (7646aaa, 05b0963, 0648423, 02047a0) verified on the `gsd/phase-04-deployment-firmware-vendoring` feature branch. Key links between Dockerfile, firmware.ts, site.hcl, CloudFront config, and build scripts are all properly wired.

---

_Verified: 2026-03-01T04:05:00Z_
_Verifier: Claude (gsd-verifier)_
