# Phase 4: Deployment + Firmware Vendoring - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Containerize the flash app (apps/run.flash/webapp/) and deploy to production at flash.defcon.run with firmware binaries baked into the Docker image. Follows existing DCR34 monorepo patterns: Dockerfile.webapp + Dockerfile.nginx, Terragrunt service.hcl, CloudFront CDN with path-based regional routing, OIDC SSO via run.auth. Zero runtime external dependencies for firmware serving.

</domain>

<decisions>
## Implementation Decisions

### Firmware vendoring strategy
- Download firmware at Docker build time — NOT checked into git
- Download ALL ESP32 firmware variants (~60 bins from firmware-esp32*.zip archives), not just hardware-list devices — covers any device someone brings to the booth
- Firmware version: firmware.ts `FIRMWARE_VERSION` is the single source of truth, with `--build-arg FIRMWARE_VERSION=X.Y.Z` override for testing new versions before committing
- Existing `scripts/download-firmware.sh` pattern should be adapted for the Dockerfile RUN stage (curl + unzip from GitHub releases)
- **Firmware binaries served from S3 static asset bucket** — same pattern as `_next/static/*` in other apps. CloudFront serves them as public static assets. NOT from inside the app container.

### Region deployment scope
- Deploy to all 3 regions: us-east-1, ca-central-1, ap-southeast-1 (matching other DCR34 services)
- Follow standard multi-region patterns: CloudFront path-based routing, regional ALBs, ECS Fargate

### Auth + config wiring
- Own OIDC client registration for flash.defcon.run (separate client_id/client_secret, own callback URL) — follows the per-app pattern from run.human and run.gpx
- Any authenticated DCR34 user can access flash — NO service claim check required (confirmed in Phase 1, decision 01-01)

### Domain + CDN setup
- flash.defcon.run follows the same /{region}/ path-based routing pattern (use1, cac1, apse1) with region router at root
- Standard CloudFront distribution matching existing apps

### Claude's Discretion
- Firmware binary upload to S3 bucket — how binaries get from Docker build stage into the S3 static asset bucket (build script upload, or separate sync step)
- ECS task sizing (CPU/memory) — pick appropriate for a lightweight Next.js app serving static firmware + a few API routes
- Autoscaling vs. fixed task count — booth tool with limited concurrent users
- DynamoDB access pattern — reuse run-human-electro table (flash only reads RunUser) or own table
- SSM Parameter Store secret paths — follow existing per-service isolation pattern
- Session cookie name — follow sess_{app} convention
- CloudFront caching for firmware binaries — firmware filenames include version so immutable caching is safe
- WAF protection — follow existing pattern
- S3 bucket layout — whether firmware goes alongside `_next/static/*` or in a separate `/firmware/` prefix

</decisions>

<specifics>
## Specific Ideas

- The existing `scripts/download-firmware.sh` already handles downloading from GitHub releases, extracting bins, and filtering out -update.bin variants — reuse this logic in the Dockerfile
- `firmware.ts` already comments "baked into the Docker image in Phase 4" — the code is ready for this
- `loadFirmware()` fetches from `/firmware/{file}.bin` — S3 bucket + CloudFront must serve firmware at this path
- `build.sh` and `release-all.sh` already exist and handle multi-region ECR push — flash just needs to be added as a valid app target
- `service.hcl` for run.human is the closest template to copy from — similar Next.js app, same auth pattern, same container structure

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/build.sh`: Docker build + ECR push script — needs flash added as valid app
- `apps/deploy.sh`: Terragrunt deploy script — needs flash service path
- `apps/release-all.sh`: Multi-region parallel release — needs flash in the release list
- `scripts/download-firmware.sh`: Firmware download logic to adapt for Dockerfile
- `apps/run.human/webapp/Dockerfile.webapp`: Template for flash Dockerfile (multi-stage build, standalone output)
- `infra/terraform/live/site/services/run.human/service.hcl`: Template for flash service definition

### Established Patterns
- Two-container ECS tasks: nginx (TLS termination, :443) + app (Next.js, :3000)
- `REGION_SHORT` build arg sets Next.js `basePath` to `/{region_label}`
- `NEXT_PUBLIC_ASSET_PREFIX` for CDN static asset paths
- Service definitions in `infra/terraform/live/site/services/{service}/service.hcl`
- VERSION.app + VERSION.nginx files for immutable image tags
- SSM Parameter Store for secrets, SOPS-encrypted
- Per-table DynamoDB IAM credentials via env vars

### Integration Points
- CloudFront: New distribution for flash.defcon.run with regional origins
- ALB: Host header rule for flash.defcon.run on existing regional ALBs
- ECR: New repositories run-flash-nginx + run-flash-app in all 3 regions
- Cloud Map: Register run-flash service for internal discovery
- run.auth OIDC: New client registration for flash.defcon.run callbacks
- DynamoDB: Read access to run-human-electro table (or own table, Claude's discretion)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-deployment-firmware-vendoring*
*Context gathered: 2026-03-01*
