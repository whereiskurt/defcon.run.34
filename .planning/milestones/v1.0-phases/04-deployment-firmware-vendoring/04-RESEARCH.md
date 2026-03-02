# Phase 4: Deployment + Firmware Vendoring - Research

**Researched:** 2026-02-28
**Domain:** Docker containerization, multi-region AWS deployment (ECS Fargate, CloudFront, S3), firmware binary vendoring
**Confidence:** HIGH

## Summary

Phase 4 containerizes the flash app and deploys it to production following the established DCR34 monorepo patterns. The codebase has well-defined conventions for every aspect of this deployment: Dockerfiles, build scripts, service definitions, CloudFront routing, and S3 static asset serving. This is fundamentally a pattern-following exercise with one novel element: firmware binary vendoring into S3 at Docker build time.

The flash app (apps/run.flash/webapp/) is already production-ready in terms of code. It uses Next.js 16 with standalone output, Auth.js v5 OIDC authentication (already registered in run.auth), ElectroDB for DynamoDB access, and the correct basePath/assetPrefix configuration pattern. The OIDC client is already registered in run.auth's oidc.ts. The firmware download script (scripts/download-firmware.sh) is battle-tested and can be adapted for Dockerfile RUN stages.

**Primary recommendation:** Follow the run.human two-container pattern (nginx + webapp) exactly, using run.gpx's service.hcl as the closer architectural template since both are lightweight Next.js apps. Add "flash" to all infrastructure aggregation points (site.hcl domains, dns subdomains, cloudfront domains, build.sh, deploy.sh, release-all.sh, version.sh). Firmware binaries upload to S3 during the build.sh asset sync step alongside `_next/static/*`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Download firmware at Docker build time -- NOT checked into git
- Download ALL ESP32 firmware variants (~60 bins from firmware-esp32*.zip archives), not just hardware-list devices -- covers any device someone brings to the booth
- Firmware version: firmware.ts `FIRMWARE_VERSION` is the single source of truth, with `--build-arg FIRMWARE_VERSION=X.Y.Z` override for testing new versions before committing
- Existing `scripts/download-firmware.sh` pattern should be adapted for the Dockerfile RUN stage (curl + unzip from GitHub releases)
- **Firmware binaries served from S3 static asset bucket** -- same pattern as `_next/static/*` in other apps. CloudFront serves them as public static assets. NOT from inside the app container.
- Deploy to all 3 regions: us-east-1, ca-central-1, ap-southeast-1 (matching other DCR34 services)
- Follow standard multi-region patterns: CloudFront path-based routing, regional ALBs, ECS Fargate
- Own OIDC client registration for flash.defcon.run (separate client_id/client_secret, own callback URL) -- follows the per-app pattern from run.human and run.gpx
- Any authenticated DCR34 user can access flash -- NO service claim check required (confirmed in Phase 1, decision 01-01)
- flash.defcon.run follows the same /{region}/ path-based routing pattern (use1, cac1, apse1) with region router at root
- Standard CloudFront distribution matching existing apps

### Claude's Discretion
- Firmware binary upload to S3 bucket -- how binaries get from Docker build stage into the S3 static asset bucket (build script upload, or separate sync step)
- ECS task sizing (CPU/memory) -- pick appropriate for a lightweight Next.js app serving static firmware + a few API routes
- Autoscaling vs. fixed task count -- booth tool with limited concurrent users
- DynamoDB access pattern -- reuse run-human-electro table (flash only reads RunUser) or own table
- SSM Parameter Store secret paths -- follow existing per-service isolation pattern
- Session cookie name -- follow sess_{app} convention (already `sess_flash` in auth.ts)
- CloudFront caching for firmware binaries -- firmware filenames include version so immutable caching is safe
- WAF protection -- follow existing pattern
- S3 bucket layout -- whether firmware goes alongside `_next/static/*` or in a separate `/firmware/` prefix

### Deferred Ideas (OUT OF SCOPE)
- **Firmware version picker wizard step** -- Add a step where the user chooses which firmware image to flash before the Flash step. Start simple: "2.6.11-plain" (stock Meshtastic prebuilt) vs "2.6.11-dcr" (eventually a custom DCR34 image). This is a new wizard step + firmware selection UI -- its own phase after deployment.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DPLY-01 | App follows monorepo pattern: apps/run.flash/webapp/ with Dockerfile.webapp + Dockerfile.nginx | Standard Stack (Dockerfile templates), Architecture Patterns (two-container pattern), Code Examples (Dockerfile.webapp, Dockerfile.nginx) |
| DPLY-02 | Terragrunt service definition at infra/terraform/live/site/services/flash/ | Architecture Patterns (service.hcl template from run.human), Code Examples (service.hcl skeleton) |
| DPLY-03 | CloudFront distribution at flash.defcon.run | Architecture Patterns (site.hcl additions), Infrastructure registration points |
| DPLY-04 | Multi-region deployment following standard DCR34 pattern with flash.defcon.run defaulting to /use1/ | Architecture Patterns (region routing, index.html, redirect templates), Code Examples |
| DPLY-05 | Build-time firmware vendoring: download, extract, and bundle firmware binaries into Docker image | Architecture Patterns (firmware vendoring in Dockerfile), Code Examples (adapted download-firmware.sh) |
</phase_requirements>

## Standard Stack

### Core (Existing -- No New Libraries)

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| Next.js | 16.1.6 | App framework (standalone output) | Already in use, monorepo standard |
| Docker (multi-stage) | latest | Build + production images | Monorepo convention |
| nginx | latest (alpine) | TLS termination sidecar | Two-container ECS pattern |
| Terragrunt | 0.97 | Infrastructure orchestration | Monorepo standard |
| Terraform | 1.14 | Infrastructure modules | Monorepo standard |
| AWS ECS Fargate | — | Container runtime | Monorepo standard |
| AWS CloudFront | — | CDN + path-based routing | Monorepo standard |
| AWS S3 | — | Static asset + firmware serving | Monorepo standard (cloudfront-assets module) |

### Supporting (Build-time Only)

| Tool | Purpose | When Used |
|------|---------|-----------|
| curl | Download firmware zips from GitHub | Dockerfile RUN stage |
| unzip | Extract firmware binaries | Dockerfile RUN stage |
| aws s3 sync | Upload firmware to S3 | build.sh asset sync step |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| nginx sidecar | Single container (like run.gpx) | run.gpx uses single container with ALB TLS, but run.human/run.auth use nginx sidecar -- flash should follow the two-container pattern for consistency with apps that have the same auth structure |
| S3 firmware serving | Firmware inside container | User decision: firmware served from S3 static asset bucket, NOT container filesystem |
| Separate firmware S3 bucket | Same cloudfront-assets bucket | No need for separate bucket -- firmware goes under `/{region}/assets/firmware/` prefix in the same S3 bucket, synced alongside `_next/static/*` |

**No npm install needed** -- all dependencies already exist in package.json from prior phases.

## Architecture Patterns

### Recommended Directory Structure (New Files)

```
apps/run.flash/
├── nginx/                              # NEW: nginx sidecar
│   ├── Dockerfile.nginx                # Copy from run.human, identical
│   ├── nginx.conf                      # Copy from run.human, identical
│   ├── index.html                      # Minimal health check page
│   ├── certs/                          # Self-signed certs for ALB→nginx
│   │   ├── nginx-selfsigned.crt        # Copy from run.human
│   │   ├── nginx-selfsigned.key        # Copy from run.human
│   │   └── mkcerts.sh                  # Copy from run.human
│   └── VERSION                         # NEW: e.g., v0.0.1
├── webapp/
│   ├── Dockerfile.webapp               # NEW: multi-stage build with firmware vendoring
│   ├── VERSION                         # NEW: e.g., v0.0.1
│   └── ... (existing source)
├── index.html                          # NEW: region router (cookie-based redirect)
└── redirects/
    └── region.html                     # NEW: region redirect template

infra/terraform/live/site/
├── services/run.flash/                 # NEW: service definition
│   ├── service.hcl                     # Task, service, ECR repos
│   ├── VERSION.app                     # Copied by deploy.sh
│   └── VERSION.nginx                   # Copied by deploy.sh
```

### Pattern 1: Two-Container ECS Task (nginx + webapp)

**What:** nginx sidecar handles TLS termination on port 443, proxies to Next.js on port 3000. ALB routes HTTPS to nginx.
**When to use:** All DCR34 Next.js apps except run.gpx (which uses single container).
**Source:** `apps/run.human/webapp/Dockerfile.webapp`, `apps/run.human/nginx/Dockerfile.nginx`

The flash app follows run.human's pattern because it has the same authentication structure (Auth.js + OIDC) and uses the nginx→app proxy chain.

### Pattern 2: Firmware Vendoring at Build Time

**What:** Dockerfile downloads firmware from GitHub releases during `docker build`, extracts binaries, includes them in the image. Build.sh then extracts and uploads to S3.
**When to use:** Phase 4 locked decision -- firmware baked into Docker image, served from S3.

**Dockerfile approach:**
```dockerfile
# Build stage - download firmware
FROM node:current-alpine AS firmware
RUN apk add --no-cache curl unzip
WORKDIR /firmware

# FIRMWARE_VERSION from firmware.ts is single source of truth
# Can be overridden with --build-arg for testing new versions
ARG FIRMWARE_VERSION
# Extract version from firmware.ts if not provided via build arg
COPY src/config/firmware.ts /tmp/firmware.ts
RUN if [ -z "$FIRMWARE_VERSION" ]; then \
      FIRMWARE_VERSION=$(grep 'FIRMWARE_VERSION' /tmp/firmware.ts | head -1 | sed 's/.*"\(.*\)".*/\1/'); \
    fi && \
    echo "$FIRMWARE_VERSION" > /tmp/fw-version.txt

# Download all ESP32 architecture zips
RUN FW_VER=$(cat /tmp/fw-version.txt) && \
    RELEASE_TAG="v${FW_VER}" && \
    BASE_URL="https://github.com/meshtastic/firmware/releases/download/${RELEASE_TAG}" && \
    for ARCH in esp32 esp32s3 esp32c3 esp32c6; do \
      ZIP="firmware-${ARCH}-${FW_VER}.zip"; \
      curl -fL -o "/tmp/${ZIP}" "${BASE_URL}/${ZIP}" || echo "Warning: ${ZIP} not found"; \
      unzip -q -o "/tmp/${ZIP}" "firmware-*.bin" -d /firmware/ 2>/dev/null || true; \
      rm -f "/tmp/${ZIP}"; \
    done && \
    find /firmware -name "*-update.bin" -delete
```

**Key insight:** The firmware stage runs as a separate Docker build stage. The production runner copies firmware from this stage. Build.sh then extracts these files and syncs to S3, just like it syncs `_next/static/*`.

### Pattern 3: S3 Asset Sync in build.sh

**What:** build.sh already extracts static assets from the Docker image and syncs to S3. Firmware binaries get the same treatment.
**Source:** `apps/build.sh` lines 163-197

The existing build.sh flow for webapp components:
1. Build Docker image with `docker buildx build`
2. Create a container from the image
3. `docker cp` static assets out of the container
4. `aws s3 sync` to the CloudFront assets bucket
5. Push image to ECR

For flash, firmware binaries are extracted alongside `_next/static` and synced to S3 under `/{region}/assets/firmware/` (or a `/firmware/` prefix). CloudFront serves them with immutable caching since filenames contain the version.

### Pattern 4: Infrastructure Registration (site.hcl)

**What:** Adding flash to every aggregation point in site.hcl.
**Source:** `infra/terraform/live/site/site.hcl`

Required additions to site.hcl:
1. `dns.subdomains` — add `"flash"` to the array
2. `urls.subdomains` — add `"flash" = "flash"` entry
3. `urls.local_ports` — add `flash = 3004`
4. `cloudfront.domains` — add `"flash"` to the array
5. `service_conf` — add `flash = read_terragrunt_config("./services/run.flash/service.hcl")`
6. `ecr.repositories` — add `local.service_conf.flash.locals.ecr_repositories`
7. `ecs_tasks.tasks` — add `local.service_conf.flash.locals.task`
8. `ecs_services.services` — add `local.service_conf.flash.locals.service`

**Also** — the global CloudFront module at `infra/terraform/live/site/global/cloudfront/terragrunt.hcl` has mock_outputs keyed by domain. Adding "flash" to `cloudfront.domains` in site.hcl will automatically create the S3 bucket via the `cloudfront-assets` module (which iterates `var.cloudfront.domains`), but the mock_outputs in the global cloudfront terragrunt.hcl need `flash` entries added.

### Pattern 5: OIDC Secrets Registration

**What:** Adding flash OIDC client credentials to SSM Parameter Store.
**Source:** `infra/terraform/live/site/site.hcl` secrets.definitions

The run.auth config already reads `OIDC_FLASH_CLIENT_ID` and `OIDC_FLASH_SECRET` from env vars. These SSM parameters need to be created:
- `/dc34/secrets/{region}/flash/client_id`
- `/dc34/secrets/{region}/flash/client_secret`

This requires adding a `flash` definition to `secrets.definitions` in site.hcl:
```hcl
flash = {
  description = "Flash tool OIDC client credentials"
  keys        = ["client_id", "client_secret"]
}
```

And adding the values to `.secrets.sops.json`.

### Pattern 6: Build/Deploy Script Registration

**What:** Adding run.flash to build.sh, deploy.sh, release-all.sh, and version.sh.
**Source:** Each script has hardcoded app validation lists.

Changes needed:
- `build.sh` — Add `run.flash` to the app validation list, add case for REPO_PREFIX/WEBAPP_ORIGIN/SSM_PATH_SEGMENT
- `deploy.sh` — Add `run.flash` case
- `release-all.sh` — Add `run.flash` to default APPS list, add `get_cf_domain`, `get_tf_service`, `has_nginx`, `get_app_component` cases
- `version.sh` — Add `run.flash` to the app validation list

### Pattern 7: Firmware Path in Client Code

**What:** The `loadFirmware()` function in firmware.ts fetches from `/firmware/{filename}.bin`. In production with basePath `/{region}`, this becomes `/{region}/firmware/{filename}.bin`. Since firmware is served from S3, the S3 bucket needs firmware at `/{region}/assets/firmware/` and CloudFront must route `/{region}/firmware/*` to S3 (or the app can use the asset prefix URL).

**Critical path mapping:**
- Client calls `fetch("/firmware/filename.bin")` — Next.js basePath prepends `/{region}` → `/{region}/firmware/filename.bin`
- CloudFront sees `/{region}/firmware/*` — this routes to the ALB (dynamic origin), NOT S3 (static origin)
- The Next.js app container does NOT have firmware files — they're only on S3

**Resolution options (Claude's discretion):**
1. **Upload firmware to S3 under the public/ prefix** — `/{region}/assets/public/firmware/*` via the existing `aws_cmd s3 sync "${TMP_PUBLIC}" "s3://${WEBAPP_ORIGIN_BUCKET}/${WEBAPP_PREFIX}/public"` line in build.sh. Then update `FIRMWARE_BASE_PATH` in firmware.ts to use the asset prefix URL for production.
2. **Use NEXT_PUBLIC_FIRMWARE_URL env var** — set to the CloudFront S3 URL at build time, firmware.ts uses this instead of relative `/firmware/` path.

**Recommendation:** Option 1 is cleanest. Firmware files land in `public/firmware/*.bin` during the Docker build, then build.sh's existing `s3 sync "${TMP_PUBLIC}" ...public/` uploads them to S3 alongside other public assets. The client-side `FIRMWARE_BASE_PATH` can be updated to use the CDN URL with `NEXT_PUBLIC_ASSET_PREFIX` for production, or we can keep the relative path if firmware files are also synced to `/{region}/firmware/` on S3.

Actually, the simplest approach: firmware goes into `public/firmware/` in the Docker image. Build.sh already syncs `public/` to S3. In production, the asset prefix rewrites static paths to the CDN. But `FIRMWARE_BASE_PATH` currently uses a bare `/firmware` path (relative), not the asset prefix. The fix is to make `FIRMWARE_BASE_PATH` use `process.env.NEXT_PUBLIC_ASSET_PREFIX` in production:

```typescript
export const FIRMWARE_BASE_PATH = process.env.NEXT_PUBLIC_ASSET_PREFIX
  ? `${process.env.NEXT_PUBLIC_ASSET_PREFIX}/public/firmware`
  : "/firmware";
```

This way: dev uses `/firmware` (served from `public/firmware/`), production uses `https://flash.defcon.run/{region}/assets/public/firmware` (served from S3 via CloudFront).

### Anti-Patterns to Avoid

- **Serving firmware from the container:** User locked decision says firmware on S3. Even though the Docker image contains them (for vendoring), the running container should NOT serve them — S3+CloudFront handles it.
- **Checking firmware binaries into git:** 123MB of binaries. Gitignored for good reason. Download at build time only.
- **Hardcoding firmware version in Dockerfile:** Use firmware.ts as single source of truth, with `--build-arg` override.
- **Creating a separate S3 bucket for firmware:** Use the existing cloudfront-assets bucket. Firmware files go through the same S3 sync pipeline as `_next/static/*` and `public/*`.
- **Skipping apse1 region:** User locked all 3 regions even though site.hcl currently has `skip_regions = ["ap-southeast-1", "ca-central-1"]`. The service definition must declare all 3 regions — the skip_regions mechanism handles which ones are actually deployed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Docker build pipeline | Custom build script | Existing `build.sh` pattern | Already handles ECR login, region tags, S3 sync, parallel builds |
| Version management | Custom versioning | Existing `version.sh` | Handles vX.Y.Z format, patch bumping |
| Multi-region release | Custom orchestration | Existing `release-all.sh` | Handles version bump, parallel builds, PR creation, auto-merge |
| CloudFront + S3 | Manual bucket/distribution setup | Existing cloudfront-assets + cloudfront modules | Adding "flash" to domains list auto-creates everything |
| TLS termination | cert-manager, custom TLS | nginx sidecar with self-signed certs | ALB→nginx uses self-signed; CloudFront→ALB uses ACM cert |
| Region routing | Custom Lambda@Edge | Existing CloudFront Functions + index.html | Cookie-based region routing already works |
| OIDC client registration | Manual SSM + code changes | Add to secrets.definitions in site.hcl | Terraform creates SSM params from .secrets.sops.json |

**Key insight:** This phase is almost entirely about wiring flash into existing infrastructure patterns. Zero new infrastructure modules needed.

## Common Pitfalls

### Pitfall 1: Missing Infrastructure Registration Points

**What goes wrong:** Flash deploys but CloudFront doesn't route to it, or ECR repos don't exist, or ECS tasks aren't created.
**Why it happens:** site.hcl has ~8 aggregation points that all need "flash" added. Missing any one causes a silent failure.
**How to avoid:** Use the checklist in Pattern 4 above. After adding, run `terragrunt plan --all` from `infra/terraform/live/site/` to verify all resources are planned.
**Warning signs:** `terragrunt plan` shows zero changes for flash-related resources.

### Pitfall 2: Firmware Path Mismatch Between Client and S3

**What goes wrong:** Client-side `loadFirmware()` returns 404 because firmware files are on S3 but the fetch URL doesn't match the S3 key path.
**Why it happens:** Next.js basePath, asset prefix, and S3 bucket prefix all need to align. The client fetches `/firmware/file.bin` (relative), but in production this becomes `/{region}/firmware/file.bin` which routes to ALB (not S3).
**How to avoid:** Update `FIRMWARE_BASE_PATH` to use the CDN asset prefix URL in production. Ensure firmware files are synced to the correct S3 prefix by build.sh.
**Warning signs:** 404 errors on firmware fetch, firmware loading in dev but not production.

### Pitfall 3: Docker Build Failure from GitHub Rate Limiting

**What goes wrong:** Firmware download fails during Docker build because GitHub throttles unauthenticated API requests.
**Why it happens:** `curl -fL` to GitHub releases without auth token, especially in CI with shared IP addresses.
**How to avoid:** Use `|| echo "Warning"` pattern (already in download-firmware.sh) so builds don't hard-fail. Consider caching firmware zips in a build cache or using GitHub token for CI builds.
**Warning signs:** Intermittent build failures, HTTP 429 responses in build logs.

### Pitfall 4: Forgetting to Add Flash Secrets to .secrets.sops.json

**What goes wrong:** ECS task fails to start because SSM parameters for OIDC_CLIENT_ID and OIDC_CLIENT_SECRET don't exist.
**Why it happens:** secrets.definitions in site.hcl creates the structure, but actual values must be in .secrets.sops.json.
**How to avoid:** Generate client_id/client_secret values and add to .secrets.sops.json before applying terraform.
**Warning signs:** ECS task stays in PENDING state, CloudWatch logs show "Parameter not found" errors.

### Pitfall 5: build.sh Firmware Extraction Path

**What goes wrong:** Firmware files exist in the Docker image but aren't extracted/synced to S3 by build.sh.
**Why it happens:** build.sh extracts `_next/static` and `public/` from the container, but firmware is in `public/firmware/` which IS covered. However, if the firmware stage writes to a different path, build.sh won't find them.
**How to avoid:** Ensure the Dockerfile copies firmware to `public/firmware/` in the production stage so build.sh's existing `docker cp "$CONTAINER_ID:/app/public"` picks them up.
**Warning signs:** S3 bucket has `_next/static/*` but no `firmware/*` prefix.

### Pitfall 6: Session Cookie Conflict

**What goes wrong:** Auth redirects loop or sessions don't persist.
**Why it happens:** Cookie name collision with other apps on `.defcon.run` domain.
**How to avoid:** Already handled — auth.ts uses `sess_flash`, `csrf_flash`, `callback_flash`, `state_flash` cookie names.
**Warning signs:** N/A — already correctly configured in Phase 1.

## Code Examples

### Dockerfile.webapp (flash-specific multi-stage build)

```dockerfile
# Stage 1: Download firmware binaries
FROM node:current-alpine AS firmware
RUN apk add --no-cache curl unzip
WORKDIR /firmware

ARG FIRMWARE_VERSION=""
COPY src/config/firmware.ts /tmp/firmware.ts

# Use build arg if provided, otherwise extract from firmware.ts
RUN FW_VER="${FIRMWARE_VERSION}"; \
    if [ -z "$FW_VER" ]; then \
      FW_VER=$(grep 'FIRMWARE_VERSION' /tmp/firmware.ts | head -1 | sed 's/.*"\(.*\)".*/\1/'); \
    fi; \
    echo "Firmware version: $FW_VER" && \
    RELEASE_TAG="v${FW_VER}" && \
    BASE_URL="https://github.com/meshtastic/firmware/releases/download/${RELEASE_TAG}" && \
    for ARCH in esp32 esp32s3 esp32c3 esp32c6; do \
      ZIP="firmware-${ARCH}-${FW_VER}.zip"; \
      echo "Downloading ${ZIP}..." && \
      curl -fL -o "/tmp/${ZIP}" "${BASE_URL}/${ZIP}" || { echo "Warning: ${ZIP} not found"; continue; }; \
      unzip -q -o "/tmp/${ZIP}" "firmware-*.bin" -d /firmware/ 2>/dev/null || true; \
      rm -f "/tmp/${ZIP}"; \
    done && \
    find /firmware -name "*-update.bin" -delete && \
    echo "Extracted $(find /firmware -name 'firmware-*.bin' | wc -l) firmware binaries"

# Stage 2: Build Next.js app
FROM node:current-alpine AS builder
RUN apk update && apk add --no-cache curl build-base g++ libpng libpng-dev jpeg-dev pango-dev cairo-dev giflib-dev python3
WORKDIR /app

COPY package*.json ./
RUN npm install
COPY . .

# Copy firmware binaries into public/firmware/ for asset extraction
COPY --from=firmware /firmware/ ./public/firmware/

ARG NEXT_PUBLIC_ASSET_PREFIX=""
ARG WEBAPP_PREFIX="use1/assets"
ARG WEBAPP_ORIGIN="flash.defcon.run"
ARG VERSION_NGINX="unknown"
ARG VERSION_WEBAPP="unknown"
ARG REGION_SHORT="use1"
ENV NEXT_PUBLIC_ASSET_PREFIX=$NEXT_PUBLIC_ASSET_PREFIX
ENV WEBAPP_PREFIX=$WEBAPP_PREFIX
ENV WEBAPP_ORIGIN=$WEBAPP_ORIGIN
ENV NEXT_PUBLIC_VERSION_NGINX=$VERSION_NGINX
ENV NEXT_PUBLIC_VERSION_APP=$VERSION_WEBAPP
ENV REGION_SHORT=$REGION_SHORT

RUN npm run build

# Stage 3: Production runtime
FROM node:current-alpine AS runner
WORKDIR /app
RUN apk add --no-cache curl

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]
```

### service.hcl skeleton (based on run.human template, simplified)

```hcl
locals {
  versions = {
    nginx = trimspace(file("${get_terragrunt_dir()}/VERSION.nginx"))
    app   = trimspace(file("${get_terragrunt_dir()}/VERSION.app"))
  }

  ecr_repositories = [
    {
      name                 = "run-flash-nginx"
      regions              = ["us-east-1", "ca-central-1", "ap-southeast-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = { max_image_count = 10, expire_days = 30 }
    },
    {
      name                 = "run-flash-app"
      regions              = ["us-east-1", "ca-central-1", "ap-southeast-1"]
      image_tag_mutability = "IMMUTABLE"
      lifecycle_policy = { max_image_count = 10, expire_days = 30 }
    }
  ]

  task = {
    name         = "run-flash"
    regions      = ["us-east-1", "ca-central-1", "ap-southeast-1"]
    cluster_name = "app"
    task_cpu     = 512      # Lightweight Next.js app
    task_memory  = 1024

    containers = [
      {
        name               = "run-flash-nginx"
        image              = "run-flash-nginx:${local.versions.nginx}"
        cpu                = 256
        memory             = 512
        memory_reservation = 256
        essential          = true
        command            = ["nginx", "-g", "daemon off;"]
        readonly_root_filesystem = false
        environment = [{ name = "APP_URL", value = "https://flash.{{SITE_DOMAIN}}" }]
        port_mappings = [{ container_port = 443, host_port = 443 }]
        health_check = {
          command      = ["CMD-SHELL", "curl -A 'HealthChecker' -k -f https://localhost/hello || exit 1"]
          interval     = 60
          timeout      = 5
          retries      = 3
          start_period = 120
        }
        log_stream_prefix = "nginx"
      },
      {
        name               = "run-flash-app"
        image              = "run-flash-app:${local.versions.app}"
        cpu                = 256
        memory             = 512
        memory_reservation = 256
        essential          = true
        command            = ["node", "server.js"]
        readonly_root_filesystem = false
        environment = [
          { name = "NODE_ENV",           value = "production" },
          { name = "HOSTNAME",           value = "0.0.0.0" },
          { name = "REGION_SHORT",       value = "{{REGION_LABEL}}" },
          { name = "AUTH_URL",           value = "https://flash.{{SITE_DOMAIN}}/{{REGION_LABEL}}" },
          { name = "NEXTAUTH_URL",       value = "https://flash.{{SITE_DOMAIN}}/{{REGION_LABEL}}" },
          { name = "AWS_REGION",         value = "{{REGION}}" },
          { name = "AUTH_COOKIE_DOMAIN", value = ".{{SITE_DOMAIN}}" },
          { name = "SITE_DOMAIN",        value = "{{SITE_DOMAIN}}" },
          { name = "AUTH_PUBLIC_URL",    value = "https://auth.{{SITE_DOMAIN}}/{{REGION_LABEL}}" },
          { name = "AUTH_INTERNAL_URL",  value = "http://run-auth.app-{{REGION_LABEL}}-{{SITE_DOMAIN_SLUG}}.local:3000/{{REGION_LABEL}}" },
          { name = "FLASH_PUBLIC_URL",   value = "https://flash.{{SITE_DOMAIN}}/{{REGION_LABEL}}" },
          { name = "RUN_DYNAMODB_REGION", value = "{{REGION}}" }
        ]
        secrets = [
          { name = "AUTH_JWT_SECRET",      valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/secret" },
          { name = "OIDC_CLIENT_ID",       valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/flash/client_id" },
          { name = "OIDC_CLIENT_SECRET",   valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/flash/client_secret" },
          { name = "AUTH_INTERNAL_SECRET",  valueFrom = "/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/jwt/internal_secret" },
          { name = "RUN_ELECTRO_ID",       valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-human-electro/access_key_id" },
          { name = "RUN_ELECTRO_SECRET",   valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-human-electro/secret_access_key" },
          { name = "RUN_ELECTRO_DBNAME",   valueFrom = "/{{SITE_LABEL}}/dynamodb/{{REGION_LABEL}}/run-human-electro/table_name" }
        ]
        port_mappings = [{ container_port = 3000, host_port = 3000 }]
        health_check = {
          command      = ["CMD-SHELL", "curl -A 'HealthChecker' -f http://localhost:3000/{{REGION_LABEL}}/ || exit 1"]
          interval     = 30
          timeout      = 5
          retries      = 3
          start_period = 120
        }
        log_stream_prefix = "app"
      }
    ]
  }

  service = {
    name          = "run-flash"
    regions       = ["us-east-1", "ca-central-1", "ap-southeast-1"]
    cluster_name  = "app"
    task_family   = "run-flash"
    desired_count = 1       # Booth tool, limited concurrent users

    service_discovery = {
      name           = "run-flash"
      container_name = "run-flash-app"
    }

    load_balancers = [{
      type                  = "alb"
      container_name        = "run-flash-nginx"
      container_port        = 443
      target_group_protocol = "HTTPS"
      health_check_path     = "/hello"
      health_check_protocol = "HTTPS"
      health_check = {
        healthy_threshold   = 2
        unhealthy_threshold = 2
        timeout             = 5
        interval            = 30
        matcher             = "200-499"
      }
      listener = {
        port         = 443
        protocol     = "HTTPS"
        host_headers = ["flash.{{SITE_DOMAIN}}"]
      }
    }]

    autoscaling = {
      enabled      = false    # Booth tool, limited concurrent users
      min_capacity = 1
      max_capacity = 2
      cpu_target = {
        scale_out_threshold = 75
        scale_in_threshold  = 25
        evaluation_periods  = 2
        period              = 60
        cooldown            = 120
      }
    }
  }
}
```

### build.sh additions for firmware S3 sync

```bash
# In the webapp build section, after existing docker cp and s3 sync:
# Sync firmware binaries to S3 (served by CloudFront as static assets)
if [[ -d "${TMP_PUBLIC}/firmware" ]]; then
  echo "Syncing firmware binaries to S3..."
  aws_cmd s3 sync "${TMP_PUBLIC}/firmware" \
    "s3://${WEBAPP_ORIGIN_BUCKET}/${WEBAPP_PREFIX}/public/firmware" \
    --cache-control 'public,max-age=31536000,immutable' \
    --delete
fi
```

Note: This is already handled by the existing line:
```bash
aws_cmd s3 sync "${TMP_PUBLIC}" "s3://${WEBAPP_ORIGIN_BUCKET}/${WEBAPP_PREFIX}/public" --cache-control 'public,max-age=31536000,immutable' --delete
```
Since firmware is in `public/firmware/`, it gets synced automatically. The cache-control is `immutable` which is correct because firmware filenames include the version (e.g., `firmware-heltec-v3-2.6.11.60ec05e.bin`).

### firmware.ts FIRMWARE_BASE_PATH update for production

```typescript
/** Base path for firmware binaries served by the app */
// In production, firmware is served from S3 via CloudFront (asset prefix)
// In development, served locally from public/firmware/
export const FIRMWARE_BASE_PATH = typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_ASSET_PREFIX
    ? `${process.env.NEXT_PUBLIC_ASSET_PREFIX}/public/firmware`
    : "/firmware";
```

## Discretion Recommendations

| Decision | Recommendation | Rationale |
|----------|----------------|-----------|
| Firmware S3 upload mechanism | Use existing build.sh `s3 sync "${TMP_PUBLIC}"` | Firmware lands in `public/firmware/` in Docker image; build.sh already syncs all of `public/` to S3 |
| ECS task sizing | 512 CPU / 1024 MiB (same as run.human) | Flash app is lightweight but shares the same Next.js + Auth.js + DynamoDB pattern |
| Autoscaling | Disabled, desired_count=1 | Booth tool with limited concurrent users; can bump to 2 manually if needed |
| DynamoDB access | Reuse run-human-electro table (read-only) | Flash only reads 4 attributes from RunUser entity; no writes, no separate table needed |
| SSM secret paths | `/dc34/secrets/{region}/flash/client_id` and `client_secret` | Matches per-service isolation pattern |
| Session cookie | `sess_flash` | Already configured in auth.ts from Phase 1 |
| CloudFront caching | `public,max-age=31536000,immutable` for firmware | Version in filename makes immutable safe; build.sh already sets this |
| WAF protection | Follow existing pattern (disabled in site.hcl currently) | waf.enabled = false in current site.hcl; flash inherits whatever is set |
| S3 bucket layout | Firmware under `/{region}/assets/public/firmware/` prefix | Uses existing `public/` sync path; no separate prefix needed |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Firmware in container, served by app | Firmware on S3, served by CloudFront | Phase 4 decision | Smaller container image in production, CDN caching, no app CPU for binary serving |
| Manual regional deployment | release-all.sh with --parallel | Already in repo | Flash just needs to be added to the existing pipeline |

## Open Questions

1. **run.auth OIDC client apse1 redirect URIs**
   - What we know: Current redirect_uris in run.auth/oidc.ts include use1 and cac1 but NOT apse1
   - What's unclear: Is apse1 actually deployed? site.hcl has `skip_regions = ["ap-southeast-1", "ca-central-1"]`
   - Recommendation: Add apse1 redirect URIs to the flash client registration for completeness. They're harmless if unused.

2. **OIDC_CLIENT_ID vs OIDC_FLASH_CLIENT_ID env var naming**
   - What we know: run.auth reads `OIDC_FLASH_CLIENT_ID` / `OIDC_FLASH_SECRET` for the flash client. The flash app itself reads `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` (generic names, like run.gpx).
   - What's unclear: Service.hcl needs to map SSM paths to the correct env var names for each container.
   - Recommendation: Flash service.hcl uses `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` (matching auth.ts). run.auth service.hcl already has `OIDC_FLASH_CLIENT_ID` / `OIDC_FLASH_SECRET`. No conflict.

3. **Docker image size with firmware**
   - What we know: Firmware binaries total ~123MB. Docker image will be significantly larger than run.human.
   - What's unclear: Whether this impacts ECR costs or ECS task startup time.
   - Recommendation: This is acceptable. ECR stores images compressed, and the firmware is only needed during the build/sync step. The running container serves from S3, not local filesystem. If image size becomes a concern, firmware could be excluded from the production stage (only kept in the builder for extraction).

## Sources

### Primary (HIGH confidence)
- `apps/run.human/webapp/Dockerfile.webapp` — Template for Next.js Dockerfile
- `apps/run.human/nginx/Dockerfile.nginx` — Nginx sidecar Dockerfile
- `apps/build.sh` — Build and push pipeline with S3 asset sync
- `apps/deploy.sh` — ECS deployment via Terragrunt
- `apps/release-all.sh` — Multi-region release orchestration
- `apps/version.sh` — Version management
- `infra/terraform/live/site/services/run.human/service.hcl` — Two-container service definition template
- `infra/terraform/live/site/services/run.gpx/service.hcl` — Lightweight Next.js service template
- `infra/terraform/live/site/site.hcl` — Infrastructure aggregation config
- `infra/terraform/modules/cloudfront-assets/v1.0.0/main.tf` — S3 bucket per CloudFront domain
- `apps/run.flash/webapp/scripts/download-firmware.sh` — Firmware download logic
- `apps/run.flash/webapp/src/config/firmware.ts` — Firmware version and loading
- `apps/run.flash/webapp/src/config/auth.ts` — Auth configuration (cookies, OIDC)
- `apps/run.auth/webapp/src/config/oidc.ts` — OIDC client registration (flash already present)

### Secondary (MEDIUM confidence)
- `apps/run.human/nginx/nginx.conf` — Nginx proxy configuration
- `apps/run.human/nginx/certs/` — Self-signed cert pattern
- `apps/run.human/index.html` — Region router template
- `apps/run.human/redirects/region.html` — Region redirect template

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all components are existing monorepo patterns, zero new libraries
- Architecture: HIGH — every pattern has a working reference implementation in the same codebase
- Pitfalls: HIGH — firmware path routing is the only non-trivial concern; all others are pattern-following

**Research date:** 2026-02-28
**Valid until:** 2026-03-28 (stable — infrastructure patterns don't change frequently)
