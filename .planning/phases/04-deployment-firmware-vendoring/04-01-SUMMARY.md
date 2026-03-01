---
phase: 04-deployment-firmware-vendoring
plan: 01
subsystem: infra
tags: [docker, firmware, nginx, meshtastic, esp32, cloudfront, s3]

# Dependency graph
requires:
  - phase: 01-app-scaffold-device-picker
    provides: "Next.js app scaffold with firmware.ts config"
  - phase: 02-flash-engine
    provides: "Flash engine using firmware binaries from public/firmware/"
provides:
  - "Dockerfile.webapp with 3-stage build (firmware download, Next.js build, production runner)"
  - "nginx TLS termination sidecar matching run.human two-container pattern"
  - "Cookie-based region router (index.html) and region redirect templates"
  - "firmware.ts production S3 path via NEXT_PUBLIC_ASSET_PREFIX"
affects: [04-02-PLAN, build.sh, deploy.sh, release-all.sh]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "3-stage Docker build: firmware vendoring -> Next.js build -> production runner"
    - "FIRMWARE_VERSION extracted from firmware.ts as single source of truth in Dockerfile"
    - "NEXT_PUBLIC_ASSET_PREFIX-based firmware path for S3/CloudFront serving"

key-files:
  created:
    - apps/run.flash/webapp/Dockerfile.webapp
    - apps/run.flash/webapp/VERSION
    - apps/run.flash/nginx/Dockerfile.nginx
    - apps/run.flash/nginx/nginx.conf
    - apps/run.flash/nginx/index.html
    - apps/run.flash/nginx/certs/nginx-selfsigned.crt
    - apps/run.flash/nginx/certs/nginx-selfsigned.key
    - apps/run.flash/nginx/certs/mkcerts.sh
    - apps/run.flash/nginx/VERSION
    - apps/run.flash/index.html
    - apps/run.flash/redirects/region.html
  modified:
    - apps/run.flash/webapp/src/config/firmware.ts

key-decisions:
  - "FIRMWARE_BASE_PATH uses NEXT_PUBLIC_ASSET_PREFIX for production S3 paths, /firmware for dev"
  - "Exact copy of nginx sidecar from run.human -- identical two-container TLS termination pattern"
  - "Region router title updated to DCR34 Flash Tool, region.html URLs point to flash.defcon.run"

patterns-established:
  - "3-stage firmware vendoring Dockerfile: download stage extracts all ESP32 variants from GitHub releases"
  - "Build-arg FIRMWARE_VERSION override for testing new firmware without changing firmware.ts"

requirements-completed: [DPLY-01, DPLY-05]

# Metrics
duration: 2min
completed: 2026-03-01
---

# Phase 4 Plan 1: Containerize Flash App Summary

**3-stage Dockerfile.webapp with firmware vendoring from GitHub releases, nginx TLS sidecar, and cookie-based region routing for flash.defcon.run**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-01T03:35:22Z
- **Completed:** 2026-03-01T03:37:26Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Created Dockerfile.webapp with firmware, builder, and runner stages that download all ESP32 firmware at build time
- Updated firmware.ts to use NEXT_PUBLIC_ASSET_PREFIX for production S3/CloudFront firmware serving
- Copied nginx TLS termination sidecar from run.human (identical two-container ECS pattern)
- Created region router (index.html) and region redirect template (region.html) for flash.defcon.run

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Dockerfile.webapp with firmware vendoring and update firmware.ts** - `7646aaa` (feat)
2. **Task 2: Create nginx sidecar and region router files** - `05b0963` (feat)

## Files Created/Modified
- `apps/run.flash/webapp/Dockerfile.webapp` - 3-stage Docker build: firmware download, Next.js build, production runner
- `apps/run.flash/webapp/src/config/firmware.ts` - Updated FIRMWARE_BASE_PATH to use NEXT_PUBLIC_ASSET_PREFIX for production S3 paths
- `apps/run.flash/webapp/VERSION` - Webapp version tracking (v0.0.1)
- `apps/run.flash/nginx/Dockerfile.nginx` - nginx TLS termination sidecar (copied from run.human)
- `apps/run.flash/nginx/nginx.conf` - nginx proxy config: port 443 SSL to localhost:3000 (copied from run.human)
- `apps/run.flash/nginx/index.html` - Minimal health check page (copied from run.human)
- `apps/run.flash/nginx/certs/` - Self-signed TLS certs and mkcerts.sh (copied from run.human)
- `apps/run.flash/nginx/VERSION` - Nginx version tracking (v0.0.1)
- `apps/run.flash/index.html` - Cookie-based region router (preferred-region cookie, defaults to /use1/)
- `apps/run.flash/redirects/region.html` - Region redirect template with flash.defcon.run URLs

## Decisions Made
- FIRMWARE_BASE_PATH uses `NEXT_PUBLIC_ASSET_PREFIX` (not a separate env var) because it is a build-time constant inlined by Next.js, matching the S3 asset path per region
- nginx sidecar files are exact copies from run.human -- the TLS termination pattern is identical across all DCR34 apps
- Region router title updated to "DCR34 Flash Tool" for user clarity; redirect logic unchanged from run.human

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Docker containerization files are complete and ready for build.sh integration (Plan 04-02)
- Infrastructure wiring (site.hcl additions, service.hcl, build/deploy script updates) is the next plan
- Pre-existing site.hcl and service.hcl changes were observed on the branch (likely from plan preparation) -- Plan 04-02 will finalize those

## Self-Check: PASSED

All 12 created/modified files verified present on disk. Both task commits (7646aaa, 05b0963) verified in git log.

---
*Phase: 04-deployment-firmware-vendoring*
*Completed: 2026-03-01*
