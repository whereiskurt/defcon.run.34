# Codebase Structure

**Analysis Date:** 2026-02-28

## Directory Layout

```
defcon.run.34/
├── .cass/                    # CASS memory system (cm/cass CLI)
├── .claude/                  # Claude Code configuration
│   ├── commands/             # Custom slash commands
│   │   └── devflow/          # Developer workflow commands
│   ├── hooks/                # Claude Code hooks
│   ├── architecture.md       # Architecture reference doc
│   ├── beads.md              # Issue tracking docs
│   ├── best-practices.md     # Code style guide
│   ├── cass.md               # Memory system docs
│   ├── commands.md           # Command reference
│   └── openspec.md           # Spec-driven development docs
├── .devcontainer/            # VS Code dev container config
├── .github/                  # GitHub configuration
│   └── workflows/            # CI/CD pipelines (12 workflows)
├── .planning/                # GSD planning documents
│   └── codebase/             # Codebase analysis docs (this file)
├── .prowler/                 # AWS security scanner config
├── .venv/                    # Python virtualenv (prowler, etc.)
├── .vscode/                  # VS Code workspace config
│   └── tasks.json            # Auto-start dev servers on folder open
├── apps/                     # All application code
│   ├── build.sh              # Docker build + ECR push script
│   ├── deploy.sh             # ECS deployment script
│   ├── release-all.sh        # Multi-region release pipeline
│   ├── version.sh            # Version bump utility
│   ├── version-reset.sh      # Version reset utility
│   ├── e2e.sh                # E2E test orchestrator
│   ├── docker-compose.yaml   # Local dev compose (all services)
│   ├── configui/             # Infrastructure config UI (Go)
│   ├── local/                # Local dev infrastructure
│   │   ├── dynamodb/         # Local DynamoDB (docker-compose)
│   │   └── s3/               # Local S3/MinIO (docker-compose)
│   ├── run.auth/             # Auth service (auth.defcon.run)
│   ├── run.cms/              # CMS service (cms.defcon.run)
│   ├── run.gpx/              # GPX editor (gpx.defcon.run)
│   ├── run.human/            # Main app (run.defcon.run)
│   ├── scripts/              # Utility scripts
│   └── waffaw/               # WAF testing platform
├── docs/                     # Design documents
│   └── plans/                # Feature design docs
├── infra/                    # Infrastructure code
│   ├── aws-nuke-guelph.yaml.tpl  # AWS account cleanup template
│   └── terraform/            # Terraform/Terragrunt
│       ├── live/             # Terragrunt live configuration
│       │   └── site/         # The single site (dc34)
│       ├── modules/          # 21 reusable Terraform modules
│       └── providers/        # AWS provider configurations
├── AGENTS.md                 # AI assistant instructions
├── CLAUDE.md                 # Points to AGENTS.md
├── env.sh                    # Environment variable loader
├── env.local.sh              # Local overrides (profile prefix)
├── env.sops.sh               # SOPS-encrypted environment vars
└── README.md                 # Project documentation
```

## Directory Purposes

**`apps/run.auth/` (auth.defcon.run):**
- Purpose: Central identity provider (Auth.js v5 + oidc-provider v9)
- Contains:
  - `webapp/` - Next.js 16 application
  - `nginx/` - Reverse proxy (TLS termination, health checks)
  - `e2e/` - Playwright end-to-end tests
  - `redirects/` - Static region redirect HTML
  - `index.html` - Domain root region router
- Key files:
  - `webapp/src/config/auth.ts` - Auth.js config (providers, JWT callbacks, email OTP)
  - `webapp/src/config/oidc.ts` - OIDC provider config (clients, claims, routes)
  - `webapp/src/entities/auth-profile.ts` - AuthProfile ElectroDB entity
  - `webapp/src/entities/oidc-adapter.ts` - OIDC DynamoDB adapter
  - `webapp/src/entities/user-quota.ts` - UserQuota ElectroDB entity
  - `webapp/src/entities/client.ts` - DynamoDB client factory (3 clients)
  - `webapp/src/services/quota.ts` - Quota service logic
  - `webapp/src/lib/quota-definitions.ts` - Quota tier definitions
  - `webapp/src/pages/api/oidc/[...path].ts` - OIDC catch-all route (Pages Router)

**`apps/run.human/` (run.defcon.run):**
- Purpose: Main user-facing application (profiles, uploads, Meshtastic, QR)
- Contains:
  - `webapp/` - Next.js 16 application
  - `nginx/` - Reverse proxy
  - `index.html` - Region router with `preferred-region` cookie
- Key files:
  - `webapp/src/config/auth.ts` - OIDC client config (SSO via run.auth)
  - `webapp/src/config/index.ts` - Centralized config (URLs, session, cookies)
  - `webapp/src/entities/run-user.ts` - RunUser entity (RSA keys, QR codes, MQTT creds, Meshtastic)
  - `webapp/src/entities/user-upload.ts` - UserUpload entity (S3 file tracking)
  - `webapp/src/entities/client.ts` - DynamoDB client factory (2 clients)
  - `webapp/src/lib/quota-client.ts` - HTTP client for run.auth quota API
  - `webapp/src/lib/quota-middleware.ts` - Quota enforcement helpers
  - `webapp/src/lib/s3-client.ts` - S3 upload client + type configs
  - `webapp/src/app/api/upload/presign/route.ts` - Presigned URL generation

**`apps/run.gpx/` (gpx.defcon.run):**
- Purpose: GPX route editor wrapping vendored gpx-studio SvelteKit app
- Contains:
  - `webapp/` - Next.js 16 shell + API routes
  - `webapp/public/studio/` - Built gpx-studio static assets (vendored)
  - `gpx-studio/` - Vendored gpx-studio source (SvelteKit, submodule-like)
  - `patches/` - Patches applied to gpx-studio
  - `e2e/` - Playwright end-to-end tests
  - `build-frontend.sh` - Build gpx-studio from source
- Key files:
  - `webapp/src/entities/gpx-file.ts` - GpxFile entity (50-version history)
  - `webapp/src/entities/gpx-folder.ts` - GpxFolder entity
  - `webapp/src/entities/gpx-share.ts` - GpxShare entity (21-char nanoid tokens)
  - `webapp/src/lib/gpx-validator.ts` - Binary + XML validation
  - `webapp/src/lib/quota-client.ts` - Quota HTTP client
  - `webapp/src/lib/s3-client.ts` - S3 client for GPX file storage

**`apps/run.cms/` (cms.defcon.run):**
- Purpose: Content management system (Strapi 5.6 + SQLite + Litestream)
- Contains:
  - `app/` - Strapi application
  - `nginx/` - Reverse proxy (TLS + regional prefix stripping)
- Key files:
  - `app/src/middlewares/cookie-auth.ts` - Cookie-based auth middleware
  - `app/src/middlewares/services-validation.ts` - CMS service claim validation
  - `app/src/extensions/strapi-plugin-sso/strapi-server.ts` - OIDC SSO extension
  - `app/litestream.master.yml` - Litestream replication config (master)
  - `app/litestream.worker.yml` - Litestream restore config (worker)
  - `app/litestream-sync.sh` - Periodic restore script for workers
  - `app/supervisord.master.conf` - Process management (Strapi + replicate)
  - `app/supervisord.worker.conf` - Process management (Strapi + sync)
  - `app/providers/strapi-provider-email-aws-ses-v3/` - Custom SES email provider

**`apps/configui/`:**
- Purpose: Local-only Go web UI for infrastructure management
- Contains: Go source files, embedded templates/static/JS, HCL backups
- Key files:
  - `main.go` - Server initialization, route registration, embed directives
  - `config.go` - Site config struct + defaults
  - `generator.go` - HCL generation from web form
  - `handlers.go` - HTTP handlers for all routes
  - `import.go` - HCL parser for site.hcl
  - `sops.go` - SOPS secret editing
  - `terminal.go` - Terragrunt SSE streaming terminal
  - `discovery.go` - AWS service discovery visualization
  - `outputs.go` - Terraform output explorer
  - `waftest.go` - Waffaw integration
  - `fork.go` - Fork site configuration for parallel environments
  - `versions.go` - Service version management

**`apps/waffaw/`:**
- Purpose: WAF testing platform (~70% implemented)
- Contains: Artillery scenarios, bash agent, consensus protocol, Dockerfile
- Key files:
  - `DESIGN.md` - Comprehensive design document (55KB)
  - `agent.sh` - EC2 Spot instance agent script
  - `consensus.sh` - Roll-call consensus protocol
  - `scenarios/` - Artillery test scenarios
  - `templates/` - Test templates
  - `test-auth-probe.ts` - Auth endpoint probe test

**`apps/local/`:**
- Purpose: Local development infrastructure (Docker Compose services)
- Contains:
  - `dynamodb/docker-compose.yaml` - Local DynamoDB
  - `dynamodb/init-local-db.sh` - Table creation script
  - `s3/docker-compose.yaml` - MinIO (S3 compatible)
  - `s3/init-s3-buckets.sh` - Bucket creation script

## Infrastructure Directory Layout

```
infra/terraform/
├── live/
│   └── site/
│       ├── terragrunt.hcl          # Root Terragrunt config (retry logic)
│       ├── site.hcl                # Site-wide variables (dns, urls, ecs_tasks, etc.)
│       ├── .secrets.sops.json      # SOPS-encrypted secrets
│       ├── global/                 # Global (us-east-1) resources
│       │   ├── cloudfront/         # CloudFront distributions
│       │   ├── cloudtrail/         # Audit logging
│       │   ├── github-oidc/        # GitHub Actions OIDC federation
│       │   └── waf/                # WAF WebACL rules
│       ├── region/
│       │   ├── skip.hcl            # Region skip logic
│       │   ├── us-east-1/          # Primary region
│       │   ├── ca-central-1/       # Secondary region
│       │   └── ap-southeast-1/     # Tertiary region
│       │       ├── region.hcl      # Auto-derived region label
│       │       ├── certs/          # ACM certificates
│       │       ├── cloudfront/     # Regional CloudFront config
│       │       ├── dynamodb/       # DynamoDB Global Tables
│       │       ├── ec2spot/        # EC2 Spot for waffaw
│       │       ├── ecr/            # Container registries
│       │       ├── ecs-cluster/    # ECS Fargate cluster
│       │       ├── ecs-task/       # Task definitions
│       │       ├── ecs-service/    # Service definitions
│       │       ├── email/          # SES configuration
│       │       ├── email-s3-replication/  # Cross-region email replication
│       │       ├── network/        # VPC, subnets, ALB, NAT
│       │       ├── s3-uploads/     # Upload buckets
│       │       ├── s3-uploads-processor/  # Lambda processors
│       │       ├── s3-uploads-replication/ # Cross-region upload replication
│       │       ├── secrets/        # SSM Parameter Store
│       │       └── waffaw/         # WAF testing infra
│       └── services/               # Service definitions
│           ├── run.auth/
│           │   └── service.hcl     # Auth service config
│           ├── run.cms/
│           │   └── service.hcl     # CMS service config
│           ├── run.gpx/
│           │   └── service.hcl     # GPX service config
│           └── run.human/
│               ├── service.hcl     # Human service config
│               └── lambdas/        # Upload processor Lambdas
│                   ├── on-upload/index.py
│                   └── on-process/index.py
├── modules/                        # 21 reusable Terraform modules
│   ├── certs/
│   │   ├── config.hcl              # Terragrunt glue config
│   │   └── v1.0.0/                 # Versioned module code
│   ├── cloudfront/
│   │   ├── config.hcl
│   │   └── v1.0.0/main.tf
│   ├── cloudfront-assets/
│   │   ├── config.hcl
│   │   └── v1.0.0/main.tf
│   ├── cloudtrail/
│   │   ├── config.hcl
│   │   ├── scripts/                # CloudTrail utility scripts
│   │   └── v1.0.0/main.tf
│   ├── dynamodb/
│   │   ├── config.hcl
│   │   └── v1.0.0/main.tf
│   ├── ec2spot/
│   │   ├── config.hcl
│   │   └── v1.0.0/main.tf
│   ├── ecr/
│   │   ├── config.hcl
│   │   └── v1.0.0/main.tf
│   ├── ecs-cluster/
│   │   ├── config.hcl
│   │   └── v1.0.0/main.tf
│   ├── ecs-service/
│   │   ├── config.hcl
│   │   └── v1.0.0/main.tf
│   ├── ecs-task/
│   │   ├── config.hcl              # Placeholder substitution logic
│   │   └── v1.0.0/main.tf
│   ├── email/
│   │   ├── config.hcl
│   │   └── v1.0.0/main.tf
│   ├── email-s3-replication/
│   │   ├── config.hcl
│   │   └── v1.0.0/main.tf
│   ├── github-oidc/
│   │   ├── config.hcl
│   │   └── v1.0.0/main.tf
│   ├── network/
│   │   ├── config.hcl
│   │   └── v1.0.0/                 # VPC: 10.0.0.0/16, 2 AZs, public/private subnets, NAT, ALB
│   ├── s3-uploads/
│   │   ├── config.hcl
│   │   └── v1.0.0/main.tf
│   ├── s3-uploads-processor/
│   │   ├── config.hcl
│   │   └── v1.0.0/main.tf
│   ├── s3-uploads-replication/
│   │   ├── config.hcl
│   │   └── v1.0.0/main.tf
│   ├── secrets/
│   │   ├── config.hcl
│   │   └── v1.0.0/
│   ├── site/
│   │   ├── config.hcl
│   │   └── v1.0.0/                 # Route53, WAF WebACL
│   │       ├── route35.tf
│   │       ├── waf.tf
│   │       ├── waf/                # WAF submodule
│   │       │   ├── main.tf
│   │       │   ├── dashboard.tf
│   │       │   ├── variables.tf
│   │       │   ├── outputs.tf
│   │       │   └── versions.tf
│   │       ├── variables.tf
│   │       └── outputs.tf
│   └── waffaw/
│       ├── config.hcl
│       └── v1.0.0/
└── providers/
    ├── global.hcl                  # Provider config for global resources
    └── regional.hcl                # Provider config for regional resources
```

## Key File Locations

**Entry Points:**
- `apps/run.auth/webapp/src/app/api/auth/[...nextauth]/route.ts`: Auth.js handler (run.auth)
- `apps/run.human/webapp/src/app/api/auth/[...nextauth]/route.ts`: Auth.js OIDC client (run.human)
- `apps/run.gpx/webapp/src/app/api/auth/[...nextauth]/route.ts`: Auth.js OIDC client (run.gpx)
- `apps/run.auth/webapp/src/pages/api/oidc/[...path].ts`: OIDC provider catch-all
- `apps/configui/main.go`: ConfigUI server entry point

**Configuration:**
- `infra/terraform/live/site/site.hcl`: Master site configuration (DNS, URLs, skip_regions, secrets, ECS tasks/services)
- `infra/terraform/live/site/services/{app}/service.hcl`: Per-service infrastructure definition
- `infra/terraform/live/site/region/{region}/region.hcl`: Auto-derived region labels
- `infra/terraform/live/site/region/skip.hcl`: Region skip logic
- `infra/terraform/providers/regional.hcl`: AWS provider + remote state config (regional)
- `infra/terraform/providers/global.hcl`: AWS provider + remote state config (global)
- `apps/run.auth/webapp/src/config/index.ts`: Auth app runtime config
- `apps/run.human/webapp/src/config/index.ts`: Human app runtime config
- `.sops.yaml`: SOPS encryption config (KMS key mapping)
- `env.sh`: Environment variable loader
- `env.local.sh`: Local profile prefix overrides

**Core Logic:**
- `apps/run.auth/webapp/src/config/auth.ts`: Auth.js providers, JWT callbacks, email templates
- `apps/run.auth/webapp/src/config/oidc.ts`: OIDC provider config, client registration, claims
- `apps/run.auth/webapp/src/entities/auth-profile.ts`: AuthProfile entity + upsert/get functions
- `apps/run.auth/webapp/src/services/quota.ts`: Quota service implementation
- `apps/run.human/webapp/src/entities/run-user.ts`: RunUser entity + RSA/QR/MQTT generation
- `apps/run.human/webapp/src/entities/user-upload.ts`: Upload tracking entity
- `apps/run.gpx/webapp/src/entities/gpx-file.ts`: GPX file entity
- `apps/run.cms/app/src/middlewares/services-validation.ts`: CMS access control

**Testing:**
- `apps/run.auth/e2e/tests/session-valid.spec.ts`: Session validation e2e tests
- `apps/run.auth/e2e/tests/service-access.spec.ts`: Service access e2e tests
- `apps/run.auth/e2e/setup/acquire-credentials.spec.ts`: Test credential acquisition
- `apps/run.gpx/e2e/cloud-storage.spec.ts`: GPX cloud storage e2e tests
- `apps/e2e.sh`: E2E test orchestrator script

**CI/CD Workflows:**
- `.github/workflows/terragrunt-plan.yml`: Infra preview on PR
- `.github/workflows/terragrunt-apply.yml`: Infra deploy on merge
- `.github/workflows/deploy.yml`: Manual ECS deployment
- `.github/workflows/rollback.yml`: ECS rollback
- `.github/workflows/e2e-tests.yml`: E2E test runner
- `.github/workflows/buildpub.yml`: Public asset builder
- `.github/workflows/gitleaks-scan.yml`: Secret detection
- `.github/workflows/checkov-scan.yml`: IaC security scanning
- `.github/workflows/prowler-scan.yml`: AWS security posture
- `.github/workflows/npm-audit.yml`: Dependency vulnerability scanning
- `.github/workflows/ec2-runner.yml`: Self-hosted runner management

**Design Documents:**
- `docs/plans/2026-02-28-meshtastic-flasher-design.md`: Meshtastic flasher design (`flash.defcon.run`)
- `docs/plans/2026-02-27-ui-redesign-design.md`: UI redesign design
- `apps/waffaw/DESIGN.md`: WAF testing platform design (55KB)

## Naming Conventions

**Files:**
- Next.js routes: `route.ts` in directory-based routing (`src/app/api/{path}/route.ts`)
- Pages Router (OIDC only): `src/pages/api/oidc/[...path].ts`
- Components: PascalCase (`MeshtasticRadios.tsx`, `ConfirmDialog.tsx`)
- Utilities/libs: kebab-case (`quota-client.ts`, `s3-client.ts`, `gpx-validator.ts`)
- Entities: kebab-case (`run-user.ts`, `auth-profile.ts`, `gpx-file.ts`)
- Config files: kebab-case (`next.config.ts`, `tailwind.config.js`)
- Go files: lowercase (`main.go`, `handlers.go`, `waftest.go`)
- Terraform: lowercase with dots (`main.tf`, `variables.tf`, `outputs.tf`)
- Terragrunt: `terragrunt.hcl` or descriptive name (`site.hcl`, `region.hcl`, `service.hcl`)
- Shell scripts: kebab-case (`release-all.sh`, `build-frontend.sh`, `litestream-sync.sh`)
- Dockerfiles: `Dockerfile.{component}` (`Dockerfile.webapp`, `Dockerfile.nginx`, `Dockerfile.app`)
- Version files: `VERSION` (plain text, one line)

**Directories:**
- Apps: `run.{name}` for deployed services (`run.auth`, `run.human`, `run.gpx`, `run.cms`)
- Terraform modules: kebab-case (`ecs-service`, `s3-uploads-processor`)
- Module versions: semantic `v{major}.{minor}.{patch}` (`v1.0.0`)
- Service infra: matches app name (`services/run.auth/`, `services/run.human/`)
- Regions: full AWS region name (`us-east-1`, `ca-central-1`, `ap-southeast-1`)

**DynamoDB Tables:**
- Pattern: `{app-slug}-{purpose}` (`run-auth-electro`, `run-human-authjs`, `run-quota-electro`)
- Two types per app: `-authjs` (Auth.js sessions/users) and `-electro` (application entities)

**ECR Repositories:**
- Pattern: `{app-slug}-{component}` (`run-auth-nginx`, `run-auth-app`, `run-human-nginx`)

**SSM Parameters:**
- Pattern: `/{site_label}/secrets/{region_label}/{provider}/{key}` (e.g., `/dc34/secrets/use1/jwt/secret`)

## Where to Add New Code

**New Next.js Feature (e.g., in run.human):**
- Page: `apps/run.human/webapp/src/app/(protected)/{feature}/page.tsx` (authenticated) or `src/app/(public)/{feature}/page.tsx` (public)
- API route: `apps/run.human/webapp/src/app/api/{feature}/route.ts`
- Component: `apps/run.human/webapp/src/components/{feature}/{ComponentName}.tsx`
- Entity: `apps/run.human/webapp/src/entities/{entity-name}.ts`
- Utility: `apps/run.human/webapp/src/lib/{util-name}.ts`
- Hook: `apps/run.human/webapp/src/hooks/use{HookName}.ts`
- Tests: `apps/run.human/e2e/tests/{feature}.spec.ts` (create e2e dir if needed)

**New Deployed Service (e.g., run.flash):**
1. Create app: `apps/run.flash/webapp/` (Next.js) or `apps/run.flash/app/` (other)
2. Add nginx: `apps/run.flash/nginx/` (if two-container pattern)
3. Add service def: `infra/terraform/live/site/services/run.flash/service.hcl`
4. Add VERSION files: `apps/run.flash/webapp/VERSION`, `apps/run.flash/nginx/VERSION`
5. Add subdomain to `site.hcl` dns.subdomains: `"flash" = "flash"`
6. Add OIDC client in `apps/run.auth/webapp/src/config/oidc.ts` (if auth needed)
7. Update `apps/build.sh` to support the new app
8. Update `apps/release-all.sh` default APPS list

**New Terraform Module:**
1. Create: `infra/terraform/modules/{module-name}/v1.0.0/main.tf`
2. Add config: `infra/terraform/modules/{module-name}/config.hcl`
3. Add live config per region: `infra/terraform/live/site/region/{region}/{module-name}/terragrunt.hcl`
4. Follow existing pattern: include `skip.hcl`, declare dependencies, include module config + providers

**New DynamoDB Table:**
1. Add table definition in relevant service's `service.hcl` under `dynamodb.tables`
2. Create ElectroDB entity in `apps/{app}/webapp/src/entities/{entity-name}.ts`
3. Add DynamoDB client credentials to `apps/{app}/webapp/src/entities/client.ts`
4. Add SSM parameter references in service.hcl container secrets

**New API Endpoint (run.auth internal):**
- Internal (server-to-server): `apps/run.auth/webapp/src/app/api/internal/{resource}/route.ts` - requires `X-Internal-Secret`
- Admin: `apps/run.auth/webapp/src/app/api/admin/{resource}/route.ts`
- Public (user-facing): `apps/run.auth/webapp/src/app/api/{resource}/route.ts`
- Quota: `apps/run.auth/webapp/src/app/api/quota/{quotaId}/{action}/route.ts`

**New GitHub Workflow:**
- Location: `.github/workflows/{name}.yml`
- Follow existing patterns: use `ec2-runner.yml` for self-hosted runners, OIDC for AWS auth

**Design Document:**
- Location: `docs/plans/{YYYY-MM-DD}-{feature-name}-design.md`

## Special Directories

**`.terragrunt-cache/`:**
- Purpose: Terragrunt working directory (module downloads, plan files)
- Generated: Yes (by `terragrunt plan/apply`)
- Committed: No (in `.gitignore`)

**`apps/run.gpx/gpx-studio/`:**
- Purpose: Vendored gpx-studio SvelteKit source (built via `build-frontend.sh`)
- Generated: No (manually vendored, patches applied)
- Committed: Yes

**`apps/run.gpx/webapp/public/studio/`:**
- Purpose: Built gpx-studio static assets served by Next.js
- Generated: Yes (by `build-frontend.sh`)
- Committed: Yes (checked in for Docker builds)

**`apps/configui/backups/`:**
- Purpose: Timestamped config backups created by configui
- Generated: Yes (by configui backup feature)
- Committed: Yes

**`apps/run.cms/app/data/`:**
- Purpose: SQLite database files for Strapi
- Generated: Yes (by Strapi + Litestream)
- Committed: Partially (`data.db` committed as seed, `.gitkeep` for the dir)

**`infra/terraform/live/site/services/{app}/lambdas/`:**
- Purpose: Lambda function source code co-located with service definitions
- Generated: No
- Committed: Yes
- Currently only `run.human` has lambdas (`on-upload/index.py`, `on-process/index.py`)

---

*Structure analysis: 2026-02-28*
