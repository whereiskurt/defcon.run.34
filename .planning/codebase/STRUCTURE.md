# Codebase Structure

**Analysis Date:** 2026-02-28

## Directory Layout

```
/Users/khundeck/working/defcon.run.34/
├── apps/                      # Web applications and tools
│   ├── run.auth/              # Central identity provider (auth.defcon.run)
│   ├── run.human/             # Main event app (run.defcon.run)
│   ├── run.gpx/               # GPX editor (gpx.defcon.run)
│   ├── run.cms/               # CMS/content server (cms.defcon.run)
│   ├── configui/              # Infrastructure config UI (localhost only)
│   ├── waffaw/                # WAF testing platform (AWS infrastructure)
│   ├── scripts/               # Shared build/deploy scripts
│   └── local/                 # Local development tools
├── infra/                     # Infrastructure as Code
│   ├── terraform/
│   │   ├── modules/           # 21 reusable Terraform modules
│   │   └── live/site/         # Terragrunt live configuration
│   │       ├── global/        # Global resources (CloudFront, WAF, certificates)
│   │       ├── region/        # Regional configs (us-east-1, ca-central-1, ap-southeast-1)
│   │       └── services/      # Service-specific definitions (run.auth, run.human, run.cms, run.gpx)
│   └── README.md
├── .claude/                   # Internal documentation
│   ├── architecture.md        # Existing architecture reference
│   ├── commands.md            # CLI commands reference
│   ├── openspec.md            # OpenSpec workflow guide
│   └── ...
├── .planning/                 # GSD planning output
│   └── codebase/              # Generated codebase analysis (this directory)
├── .vscode/                   # VS Code tasks and settings
├── docs/                      # User documentation
├── AGENTS.md                  # AI agent instructions
├── README.md                  # Project overview
└── env.sh, env.sops.sh        # Environment variable scripts
```

## Directory Purposes

**apps/run.auth/:**
- Purpose: Central identity provider, OIDC server, quota management, session validation
- Contains: Next.js webapp, nginx reverse proxy, E2E tests
- Key files: `webapp/src/config/auth.ts` (Auth.js config), `webapp/src/config/oidc.ts` (OIDC provider config)
- Structure:
  ```
  run.auth/
  ├── webapp/                  # Next.js application
  │   ├── src/
  │   │   ├── app/            # Next.js app router (routes, layouts, pages)
  │   │   │   ├── (authlogin)/ # Login UI group
  │   │   │   └── api/        # API routes (auth, quota, session validation, profile, captcha)
  │   │   ├── config/         # Config files (auth.ts, oidc.ts, fonts.ts)
  │   │   ├── entities/       # Data models (auth-profile, client config)
  │   │   ├── lib/            # Utilities (quota-client, OIDC helpers)
  │   │   └── pages/api/      # Legacy Pages Router API (mixed with app router)
  │   ├── Dockerfile.webapp   # Node.js container
  │   └── next.config.ts
  ├── nginx/                  # TLS termination
  │   ├── Dockerfile.nginx
  │   └── conf.d/
  ├── e2e/                    # Playwright end-to-end tests
  └── VERSION
  ```

**apps/run.human/:**
- Purpose: Main event application, user profiles, Meshtastic radio management, file uploads, GPS check-ins
- Contains: Next.js webapp, nginx reverse proxy
- Key files: `webapp/src/app/(protected)/` (protected routes), `webapp/src/services/quota.ts` (local quota ops)
- Structure:
  ```
  run.human/
  ├── webapp/
  │   ├── src/
  │   │   ├── app/            # Next.js app router
  │   │   │   ├── (public)/   # Public pages (landing, etc.)
  │   │   │   ├── (protected)/ # Auth-required routes (profile, uploads, etc.)
  │   │   │   └── api/        # API routes (auth, user, uploads, meshtastic, admin)
  │   │   ├── components/     # React UI components (header, profile, text effects)
  │   │   ├── entities/       # Data models (RunUser, UserUpload, DynamoDB clients)
  │   │   ├── hooks/          # Custom React hooks
  │   │   ├── lib/            # Utilities (quota-client, AWS SDK helpers)
  │   │   ├── services/       # Business logic (quota management, stale upload cleanup)
  │   │   ├── config/         # Config (auth setup, URLs, providers)
  │   │   └── middleware.ts   # Next.js middleware (URL passing)
  │   ├── Dockerfile.webapp
  │   └── next.config.ts      # basePath: "/{REGION_LABEL}" at build time
  ├── nginx/
  │   ├── Dockerfile.nginx
  │   ├── nginx.conf
  │   └── conf.d/
  └── VERSION
  ```

**apps/run.gpx/:**
- Purpose: GPX route editor with cloud save/versioning, public/private sharing
- Contains: Next.js wrapper + vendored gpx-studio (SvelteKit, built from source)
- Key characteristic: Three-stage Docker build (gpx-builder → webapp-builder → runner)
- Structure:
  ```
  run.gpx/
  ├── webapp/
  │   ├── src/app/           # Next.js app router
  │   │   ├── layout.tsx     # Auth check, session loading
  │   │   ├── page.tsx       # Route to studio
  │   │   └── studio/        # GPX editor pages
  │   ├── public/            # Static assets (gpx-studio frontend)
  │   └── Dockerfile.webapp  # Multi-stage: builds gpx-studio from src
  ├── build-frontend.sh      # Build gpx-studio SvelteKit app
  ├── nginx/
  ├── VERSION
  └── ...
  ```

**apps/run.cms/:**
- Purpose: Strapi 5 CMS with SQLite + Litestream replication (master/worker architecture)
- Contains: Strapi app, nginx reverse proxy, supervisord process manager, Litestream config
- Master region: us-east-1 only (handles writes, replicates to S3)
- Worker regions: Read-only replicas, periodic S3 restore
- Structure:
  ```
  run.cms/
  ├── app/                   # Strapi application
  │   ├── src/
  │   │   ├── admin/         # Strapi admin plugins
  │   │   ├── api/           # Custom API endpoints
  │   │   ├── extensions/    # Strapi extensions
  │   │   └── middlewares/   # Custom middleware (cookie-auth, services-validation)
  │   ├── config/            # Strapi config (database, plugins)
  │   ├── public/            # Strapi uploads and assets
  │   ├── Dockerfile.app     # Node.js + supervisord
  │   ├── supervisord.conf   # Manages Strapi + Litestream
  │   └── litestream-sync.sh # Periodic restore from S3
  ├── nginx/
  │   ├── Dockerfile.nginx
  │   └── conf.d/
  └── VERSION
  ```

**apps/configui/:**
- Purpose: Go binary for local infrastructure configuration UI
- Contains: Embedded HTML/CSS/JS, CLI flag parsing, Terragrunt execution, SOPS secret editing
- Binds to: `127.0.0.1:8080` (localhost only)
- Structure:
  ```
  configui/
  ├── main.go                # Entry point, HTTP handlers
  ├── docs/
  │   ├── index.html         # Web UI (HCL form generator, terragrunt executor, SOPS editor)
  │   ├── templates/         # HTML templates
  │   └── js/                # Frontend JS
  └── ...
  ```

**apps/waffaw/:**
- Purpose: WAF testing platform (70% implemented) — Artillery + Playwright with EC2 Spot fleet
- Contains: Node.js app, Dockerfile, Lambda functions, design doc
- See: `apps/waffaw/DESIGN.md` for implementation details
- Structure:
  ```
  waffaw/
  ├── DESIGN.md              # Full design (S3 control plane, roll call consensus, Athena analytics)
  ├── Dockerfile             # Node.js container
  ├── src/                   # Application code (WIP)
  └── package.json
  ```

**infra/terraform/modules/:**
- Purpose: 21 reusable Terraform modules for AWS resources
- Organized by: Infrastructure component type
- Structure:
  ```
  modules/
  ├── certs/                 # ACM certificates
  ├── cloudfront/            # CloudFront distributions
  ├── cloudfront-assets/     # S3 + CloudFront for static assets
  ├── cloudtrail/            # CloudTrail audit logging
  ├── dynamodb/              # DynamoDB tables + Global Tables v2
  ├── ec2spot/               # EC2 Spot instances (waffaw fleet)
  ├── ecr/                   # Elastic Container Registry
  ├── ecs-cluster/           # ECS Fargate clusters
  ├── ecs-service/           # ECS service definitions
  ├── ecs-task/              # ECS task definitions
  ├── email/                 # SES email configuration
  ├── email-s3-replication/  # Cross-region email replication
  ├── github-oidc/           # GitHub Actions OIDC federation
  ├── network/               # VPC (10.0.0.0/16, 2 AZs, public/private subnets, NAT)
  ├── s3-uploads/            # S3 upload buckets
  ├── s3-uploads-processor/  # Lambda upload processors
  ├── s3-uploads-replication/ # Cross-region upload replication
  ├── secrets/               # SSM Parameter Store secrets
  ├── site/                  # Top-level site orchestration
  └── waffaw/                # WAF testing infrastructure
  ```

  Each module structure:
  ```
  {module-name}/
  ├── config.hcl             # Terragrunt config reference
  ├── v1.0.0/                # Module implementation version
  │   ├── main.tf
  │   ├── variables.tf
  │   └── outputs.tf
  └── EXAMPLES.md
  ```

**infra/terraform/live/site/:**
- Purpose: Terragrunt live configuration — orchestrates modules with site-specific inputs
- Structure:
  ```
  live/site/
  ├── terragrunt.hcl         # Root config (error handling, provider includes)
  ├── site.hcl               # Site-wide variables (site label, DNS, URLs, service configs)
  ├── global/                # Global resources (shared across regions)
  │   ├── cloudfront/        # CloudFront distributions
  │   ├── cloudtrail/        # CloudTrail logging
  │   ├── github-oidc/       # GitHub OIDC roles
  │   └── waf/               # WAF rules and WebACLs
  ├── region/
  │   ├── us-east-1/         # Primary region config
  │   │   ├── region.hcl     # Region-specific vars
  │   │   ├── network/       # VPC, subnets, NAT
  │   │   ├── ecs-cluster/   # ECS cluster for services
  │   │   ├── ecs-task/      # ECS task definitions
  │   │   ├── ecs-service/   # ECS service definitions
  │   │   ├── dynamodb/      # DynamoDB tables
  │   │   ├── ecr/           # ECR repositories
  │   │   ├── secrets/       # SSM Parameter Store config
  │   │   ├── email/         # SES email (primary region only)
  │   │   ├── s3-uploads/    # S3 upload buckets
  │   │   ├── s3-uploads-processor/ # Lambda upload processors
  │   │   ├── certs/         # ACM certificates
  │   │   └── waffaw/        # WAF test infrastructure
  │   ├── ca-central-1/      # Secondary region (similar structure)
  │   └── ap-southeast-1/    # Tertiary region
  └── services/              # Service-specific definitions
      ├── run.auth/          # run.auth service config + Lambda functions
      │   ├── service.hcl    # ECS task, DynamoDB tables, S3 uploads, etc.
      │   ├── VERSION.app
      │   ├── VERSION.nginx
      │   └── lambdas/       # On-upload/on-process Lambda code
      ├── run.human/         # Similar structure
      ├── run.cms/           # Similar structure
      └── run.gpx/           # Similar structure
  ```

## Key File Locations

**Entry Points:**

- `apps/run.human/webapp/src/app/layout.tsx` — Root layout, session loading, navigation
- `apps/run.human/webapp/src/app/(public)/page.tsx` — Landing page (public route)
- `apps/run.auth/webapp/src/app/(authlogin)/signin/page.tsx` — Sign-in page
- `apps/run.gpx/webapp/src/app/layout.tsx` — GPX editor root
- `apps/run.cms/app/src/index.ts` — Strapi entry point
- `infra/terraform/live/site/terragrunt.hcl` — Infrastructure root (see locals for site config source)

**Configuration:**

- `apps/run.human/webapp/src/config/` — Auth.js setup, provider config, fonts
- `apps/run.auth/webapp/src/config/auth.ts` — Auth.js + DynamoDB adapter setup
- `apps/run.auth/webapp/src/config/oidc.ts` — OIDC provider configuration
- `infra/terraform/live/site/site.hcl` — Global site variables (DNS, URLs, service configs)
- `infra/terraform/live/site/region/{region}/region.hcl` — Regional variables (VPC CIDR, AZs, etc.)
- `infra/terraform/live/site/services/run.human/service.hcl` — run.human service definition (ECS task, DynamoDB, S3, etc.)
- `infra/terraform/live/site/.secrets.sops.json` — SOPS-encrypted secrets (source of truth for credentials)

**Core Logic:**

- `apps/run.human/webapp/src/entities/run-user.ts` — ElectroDB model for user profiles
- `apps/run.human/webapp/src/entities/user-upload.ts` — ElectroDB model for file uploads
- `apps/run.human/webapp/src/services/quota.ts` — Local quota service (stale upload cleanup)
- `apps/run.human/webapp/src/lib/quota-client.ts` — HTTP client for central quota service in run.auth
- `apps/run.auth/webapp/src/entities/auth-profile.ts` — ElectroDB model for user auth profiles (linked providers)
- `apps/run.auth/webapp/src/app/api/internal/quota/` — Central quota API endpoints
- `apps/run.cms/app/src/middlewares/` — Strapi middleware (OIDC SSO, service validation)

**Testing:**

- `apps/run.auth/e2e/` — Playwright end-to-end tests for auth flows

**Infrastructure Code:**

- `infra/terraform/modules/ecs-service/v1.0.0/main.tf` — ECS service module (creates ALB listeners, service discovery, autoscaling)
- `infra/terraform/modules/ecs-task/v1.0.0/main.tf` — ECS task module (defines container specs, secrets injection)
- `infra/terraform/modules/dynamodb/v1.0.0/main.tf` — DynamoDB module (Global Tables v2, TTL, streams)
- `infra/terraform/modules/site/v1.0.0/main.tf` — Orchestrates all regional and service modules
- `infra/terraform/live/site/services/run.human/lambdas/on-upload/index.ts` — Lambda triggered when file uploaded to S3
- `infra/terraform/live/site/services/run.human/lambdas/on-process/index.ts` — Lambda triggered after upload processing

## Naming Conventions

**Files:**

- `.ts` / `.tsx` — TypeScript source files (preferred extension for Next.js)
- `Dockerfile.{component}` — Component-specific Dockerfiles (e.g., `Dockerfile.webapp`, `Dockerfile.nginx`)
- `*.hcl` — Terraform/Terragrunt configuration files
- `*.conf` — nginx configuration files
- `.sops.json` — SOPS-encrypted JSON (source of truth for secrets)
- `VERSION` — Plain text file with semantic version (read at Docker build time)
- `route.ts` — Next.js app router API route handler
- `layout.tsx` — Next.js app router layout component
- `page.tsx` — Next.js app router page component
- `middleware.ts` — Next.js middleware (runs before route handlers)

**Directories:**

- `src/app/` — Next.js app router (directory-based routing)
- `src/app/(group)/` — Route group (logical grouping, doesn't affect URL)
- `src/components/` — React UI components
- `src/entities/` — ElectroDB/ORM models
- `src/services/` — Business logic functions
- `src/lib/` — Utilities and helpers
- `src/config/` — Configuration files
- `src/types/` — TypeScript type definitions
- `src/hooks/` — Custom React hooks
- `nginx/` — nginx reverse proxy configuration and Dockerfile
- `e2e/` — End-to-end tests (Playwright)
- `lambdas/` — AWS Lambda function code (organized by trigger/purpose)
- `modules/{name}/v1.0.0/` — Terraform module implementations (versioned)
- `live/site/` — Terragrunt live config (deployed state)
- `global/` — Shared/global infrastructure
- `region/` — Regional infrastructure (one per AWS region)
- `services/` — Service-specific definitions (one per app)

**Env Vars / Secrets:**

- `NEXT_PUBLIC_*` — Public environment variables (available in browser)
- `AUTH_*` — Auth.js configuration (session, JWT, cookie, provider URLs)
- `OIDC_*` — OIDC client credentials (scoped per service)
- `RUN_*` — run.human specific (DynamoDB, SES, S3, etc.)
- `AWS_REGION` — Current AWS region
- `REGION_SHORT` — Short region label (e.g., `use1`, `cac1`)
- `SITE_DOMAIN` — Root domain (e.g., `defcon.run`)
- Pattern in SSM: `/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/{category}/{key}`
- Example: `/dc34/secrets/use1/jwt/secret` — JWT secret for us-east-1

## Where to Add New Code

**New Feature (API endpoint + UI):**

1. **Decide location:** Which app? (run.human, run.auth, run.gpx, run.cms)
2. **API route:** Create `apps/{app}/webapp/src/app/api/{feature}/route.ts` (or nested for hierarchy)
   - Follow existing pattern: `export async function GET/POST/PUT/DELETE(req: Request)`
   - Use NextResponse for returns
   - Validate input, call services/entities, handle errors
3. **Service/Business Logic:** If logic is reusable, move to `apps/{app}/webapp/src/services/{feature}.ts`
   - Import entities, AWS clients, external services
   - Keep it testable (pure functions when possible)
4. **Entity/Data Model:** If accessing DynamoDB, define ElectroDB model in `apps/{app}/webapp/src/entities/{entity}.ts`
   - Use existing patterns (pk/sk, GSI, CRUD methods)
5. **UI Component:** Create in `apps/{app}/webapp/src/components/{feature}/`
   - Use HeroUI or existing design system
   - Import hooks, services, and API client functions
6. **Tests:** Add tests alongside in `apps/{app}/__tests__/` (mirror src structure)
7. **Infrastructure:** If new AWS resource needed:
   - Add to `infra/terraform/live/site/services/{app}/service.hcl` (or create new module)
   - Update regional configs as needed
   - Secrets go in `.secrets.sops.json` and referenced in service.hcl

**New Component/Module (reusable code):**

- UI Component: `apps/{app}/webapp/src/components/{category}/{name}.tsx`
- Utility Function: `apps/{app}/webapp/src/lib/{category}.ts`
- Hook: `apps/{app}/webapp/src/hooks/use{Name}.ts`
- Entity Model: `apps/{app}/webapp/src/entities/{entity}.ts`

**Utilities (shared across services):**

- If truly shared: Consider shared npm package (monorepo) — currently not used, so add to each app for now
- Otherwise: Keep in each app's `src/lib/` with clear domain (e.g., `quota-client`, `dynamodb-helpers`)

**Infrastructure:**

- New ECS service: Create new service definition file in `infra/terraform/live/site/services/{app}/`
- New AWS resource type: Create new module in `infra/terraform/modules/{resource}/`
- Regional customization: Add to `infra/terraform/live/site/region/{region}/{component}/terragrunt.hcl`

## Special Directories

**apps/.git:**
- Purpose: Not git directory — app structure uses monorepo at root
- Generated: No
- Committed: No

**.terragrunt-cache/:**
- Purpose: Cached Terraform modules and generated configurations
- Generated: Yes (by Terragrunt)
- Committed: No (in .gitignore)

**apps/{app}/webapp/public/:**
- Purpose: Static assets served by Next.js (bundled at build time)
- Generated: No (user-created assets)
- Committed: Yes

**apps/{app}/webapp/.next/:**
- Purpose: Next.js build output (compiled code, optimized bundles)
- Generated: Yes (by `npm run build`)
- Committed: No (Docker build regenerates)

**infra/terraform/live/site/.secrets.sops.json:**
- Purpose: SOPS-encrypted source-of-truth for all secrets (credentials, keys, etc.)
- Generated: No (manually created/edited with `sops` CLI)
- Committed: Yes (encrypted)

**infra/terraform/live/site/.secrets.json:**
- Purpose: Plaintext fallback (used if .secrets.sops.json not present)
- Generated: No
- Committed: No (in .gitignore — security risk)

**node_modules/, .next/, build/:**
- Purpose: Build artifacts and dependencies
- Generated: Yes
- Committed: No (in .gitignore)

---

*Structure analysis: 2026-02-28*
