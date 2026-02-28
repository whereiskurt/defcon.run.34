# Architecture

**Analysis Date:** 2026-02-28

## Pattern Overview

**Overall:** Multi-region microservices with centralized identity provider, deployed as containerized applications on AWS ECS Fargate behind CloudFront CDN with path-based regional routing.

**Key Characteristics:**
- Central identity provider (run.auth) with dual Auth.js v5 + oidc-provider v9
- Path-based multi-region routing via CloudFront (`/{region_label}/*` -> regional ALBs)
- DynamoDB Global Tables for cross-region data replication
- ElectroDB entity pattern for all DynamoDB access
- Terragrunt/Terraform infrastructure-as-code with 21 versioned modules
- SOPS-encrypted secrets injected via SSM Parameter Store
- Two-container ECS tasks (nginx + app) except run.gpx (single container)

## Layers

**CDN / Edge Layer:**
- Purpose: TLS termination, WAF filtering, path-based origin routing, static asset serving
- Location: `infra/terraform/modules/cloudfront/v1.0.0/`, `infra/terraform/modules/site/v1.0.0/waf/`
- Contains: CloudFront distributions (one per domain), WAF WebACLs, S3 origin for `_next/static/*`
- Depends on: ACM certificates, WAF rules, regional ALBs as origins
- Used by: All internet-facing requests

**Load Balancer Layer:**
- Purpose: Regional traffic distribution to ECS tasks, host-based routing
- Location: `infra/terraform/modules/network/v1.0.0/` (ALBs are created as part of network module)
- Contains: ALB per region with HTTPS listeners and host header rules
- Depends on: VPC, ACM certificates, CloudFront prefix list (ALBs accept only CloudFront traffic)
- Used by: ECS services via target groups

**Application Layer:**
- Purpose: Business logic in Next.js, Strapi, and vendored SvelteKit apps
- Location: `apps/run.auth/webapp/`, `apps/run.human/webapp/`, `apps/run.gpx/webapp/`, `apps/run.cms/app/`
- Contains: Next.js 16 API routes, React 19 components, ElectroDB entities, Auth.js + OIDC config
- Depends on: DynamoDB, S3, SES, auth service (for downstream apps)
- Used by: End users via browser, other services via internal APIs

**Data Layer:**
- Purpose: Persistent storage and replication
- Location: `infra/terraform/modules/dynamodb/v1.0.0/`, `infra/terraform/modules/s3-uploads/v1.0.0/`
- Contains: DynamoDB Global Tables (v2), S3 upload buckets with cross-region replication, SQLite + Litestream (CMS only)
- Depends on: IAM policies for per-table credentials
- Used by: Application layer entities via ElectroDB

**Infrastructure Configuration Layer:**
- Purpose: Terragrunt live config, service definitions, module composition
- Location: `infra/terraform/live/site/`, `infra/terraform/modules/`
- Contains: Terragrunt HCL files, service.hcl definitions, region configs, provider configs
- Depends on: AWS APIs, SOPS for secrets
- Used by: CI/CD pipelines, configui

## Data Flow

**Authentication Flow (Email OTP):**

1. User visits `auth.defcon.run` -> CloudFront routes `/{region}/*` to regional ALB
2. ALB forwards to ECS task (nginx :443 -> Next.js :3000)
3. User submits email on `/login` page with ALTCHA proof-of-work captcha
4. `apps/run.auth/webapp/src/app/api/login/route.ts` triggers Auth.js signIn
5. Auth.js Email provider sends 6-digit OTP via SES (`apps/run.auth/webapp/src/config/auth.ts` -> `sendVerificationRequest()`)
6. User enters OTP or clicks email link -> Auth.js callback verifies token
7. JWT callback in `apps/run.auth/webapp/src/config/auth.ts` calls `upsertAuthProfile()` -> stores profile in `run-auth-electro` DynamoDB table
8. Session JWT stored in `sess_auth` httpOnly cookie on `.defcon.run` domain

**OIDC SSO Flow (run.human authenticating via run.auth):**

1. User visits `run.defcon.run/{region}/` -> `apps/run.human/webapp/src/config/auth.ts` checks session
2. If no `sess_run` cookie, Auth.js redirects to run.auth OIDC authorization endpoint
3. OIDC provider (`apps/run.auth/webapp/src/config/oidc.ts`) checks for existing `sess_auth` session
4. If authenticated, OIDC provider issues authorization code -> redirects back to run.human
5. run.human exchanges code for tokens at `auth.defcon.run/{region}/api/oidc/token`
6. OIDC `findAccount()` in `apps/run.auth/webapp/src/config/oidc.ts` fetches `AuthProfile` from DynamoDB -> populates claims (services, linked_providers, mapboxPublicToken)
7. run.human JWT callback stores claims in token, calls `upsertRunUser()` to create/update `RunUser` in `run-human-electro` table
8. Session stored in `sess_run` httpOnly cookie

**Session Refresh / Claims Sync (run.human -> run.auth):**

1. Every 5 minutes (configurable via `config.session.refreshInterval`), run.human's JWT callback fires
2. `fetchFreshClaims()` in `apps/run.human/webapp/src/config/auth.ts` calls `apps/run.auth/webapp/src/app/api/session/validate/user/[userId]/route.ts`
3. Uses internal service discovery URL (`run-auth.app-{region}-{slug}.local:3000/{region}`) with `X-Internal-Secret` header
4. Returns updated services, linkedProviders, sessionVersion, lockedOut status
5. If `lockedOut=true` or `sessionVersion` increased -> token marked as `invalidated` -> session destroyed

**Quota Consumption Flow (file upload example):**

1. Browser requests presigned URL: `GET /api/upload/presign?type=gpx`
2. `apps/run.human/webapp/src/app/api/upload/presign/route.ts` checks auth, determines user tier from services
3. Calls `apps/run.human/webapp/src/lib/quota-client.ts` -> `consumeQuota(userId, "file_upload")` -> HTTP POST to `apps/run.auth/webapp/src/app/api/internal/quota/[userId]/[quotaId]/consume/route.ts`
4. run.auth atomically decrements `remaining` in `run-quota-electro` DynamoDB table via `apps/run.auth/webapp/src/services/quota.ts`
5. If insufficient quota -> 429 response -> run.human returns quota exceeded error
6. If success -> generate S3 presigned PUT URL via `@aws-sdk/s3-request-presigner` -> create `UserUpload` record in DynamoDB with status "pending"
7. Browser uploads directly to S3 using presigned URL
8. S3 event triggers Lambda (`infra/terraform/live/site/services/run.human/lambdas/on-upload/index.py`) -> updates record to "uploaded"
9. Processing Lambda (`lambdas/on-process/index.py`) processes file -> marks "completed"

**CMS Master/Worker Replication Flow:**

1. CMS master (us-east-1 only) runs Strapi + `litestream replicate` continuously via supervisord
2. Litestream streams SQLite WAL changes to S3 bucket
3. Worker instances (all regions) run `apps/run.cms/app/litestream-sync.sh` every 5 minutes via supervisord
4. Script uses `litestream restore` from S3 to refresh local SQLite copy
5. Workers serve read-only API requests; write requests must go to master

**State Management:**
- Server-side: JWT sessions in httpOnly cookies (`sess_auth`, `sess_run`, `sess_gpx`, `strapi_admin_token`)
- Client-side: React state via HeroUI providers, no global client store (no Redux/Zustand)
- Cross-service: OIDC tokens and `X-Internal-Secret` headers for server-to-server calls
- Infrastructure state: Terraform state in S3 per-region per-module

## Key Abstractions

**ElectroDB Entities:**
- Purpose: Type-safe DynamoDB access with single-table design pattern
- Examples:
  - `apps/run.auth/webapp/src/entities/auth-profile.ts` (AuthProfile - user identity)
  - `apps/run.auth/webapp/src/entities/oidc-adapter.ts` (OIDCModel - OIDC provider state)
  - `apps/run.auth/webapp/src/entities/user-quota.ts` (UserQuota - quota tracking)
  - `apps/run.human/webapp/src/entities/run-user.ts` (RunUser - application user data)
  - `apps/run.human/webapp/src/entities/user-upload.ts` (UserUpload - file upload tracking)
  - `apps/run.gpx/webapp/src/entities/gpx-file.ts` (GpxFile - GPX file metadata)
  - `apps/run.gpx/webapp/src/entities/gpx-folder.ts` (GpxFolder - folder organization)
  - `apps/run.gpx/webapp/src/entities/gpx-share.ts` (GpxShare - sharing tokens)
- Pattern: Each entity defines `model`, `attributes`, `indexes` using ElectroDB schema. Uses composite keys (`pk`/`sk`) with GSIs (`gsi1pk`/`gsi1sk`). Separate DynamoDB clients per table (3 in run.auth: `dynamodbClient`, `electroClient`, `quotaClient`).

**DynamoDB Client Factory:**
- Purpose: Per-table IAM credential isolation
- Examples: `apps/run.auth/webapp/src/entities/client.ts`, `apps/run.human/webapp/src/entities/client.ts`
- Pattern: Each app exports multiple `DynamoDBDocument` clients with distinct credentials from env vars. Table names from SSM. This allows fine-grained IAM: run.human can only access run-human-* tables.

**Centralized Config Objects:**
- Purpose: Single source of truth for all environment-derived configuration
- Examples: `apps/run.human/webapp/src/config/index.ts`, `apps/run.auth/webapp/src/config/index.ts`
- Pattern: Readonly `config` object with computed URLs for dev/prod. Handles region prefix injection, service discovery URLs, cookie configuration. All env vars consumed through config, never direct `process.env` in business logic.

**Service Definitions (service.hcl):**
- Purpose: Declarative service configuration consumed by Terraform modules
- Examples:
  - `infra/terraform/live/site/services/run.auth/service.hcl`
  - `infra/terraform/live/site/services/run.human/service.hcl`
  - `infra/terraform/live/site/services/run.cms/service.hcl`
  - `infra/terraform/live/site/services/run.gpx/service.hcl`
- Pattern: Each `service.hcl` defines `ecr_repositories`, `task` (containers, env vars, secrets, health checks), `dynamodb` tables, `service` (ALB config, autoscaling), `user_uploads`, `upload_processors`. Uses template variables `{{REGION}}`, `{{REGION_LABEL}}`, `{{SITE_LABEL}}`, `{{SITE_DOMAIN}}` replaced at plan time by `infra/terraform/modules/ecs-task/config.hcl`.

**Terragrunt Module Config Pattern:**
- Purpose: Glue between live config and versioned modules
- Examples: `infra/terraform/modules/ecs-task/config.hcl`, `infra/terraform/modules/ecs-service/config.hcl`
- Pattern: Each module has a `config.hcl` that reads site.hcl + region.hcl, performs placeholder substitution, and exposes `merged_inputs`. Live `terragrunt.hcl` files include the config, set dependencies, and pass outputs.

## Entry Points

**run.auth API (auth.defcon.run):**
- Location: `apps/run.auth/webapp/src/app/api/`
- Key routes:
  - `api/auth/[...nextauth]/route.ts` - Auth.js handler (login, callback, session)
  - `api/login/route.ts` - Custom email OTP initiation with ALTCHA captcha
  - `api/logout/route.ts` - Custom logout clearing `sess_auth` cookie
  - `api/captcha/challenge/route.ts` - ALTCHA proof-of-work challenge generation
  - `api/session/validate/route.ts` - Session validation for downstream services
  - `api/session/validate/user/[userId]/route.ts` - Per-user session/claims validation (internal)
  - `api/profile/route.ts` - User profile management
  - `api/quota/[quotaId]/*/route.ts` - Public quota API (check, consume, restore)
  - `api/internal/quota/[userId]/[quotaId]/*/route.ts` - Internal quota API (server-to-server)
  - `api/admin/quota/*/route.ts` - Admin quota management
  - `api/admin/user/[userId]/*/route.ts` - Admin user management (lock, invalidate)
- OIDC routes (Pages API): `pages/api/oidc/[...path].ts`, `pages/api/oidc/interaction/[uid].ts`, `pages/api/oidc/.well-known/openid-configuration.ts`

**run.human API (run.defcon.run):**
- Location: `apps/run.human/webapp/src/app/api/`
- Key routes:
  - `api/auth/[...nextauth]/route.ts` - Auth.js OIDC client handler
  - `api/auth/auto-signin/route.ts` - Silent SSO initiation
  - `api/user/route.ts` - RunUser profile CRUD
  - `api/upload/presign/route.ts` - S3 presigned URL generation with quota check
  - `api/meshtastic-radios/route.ts` - Radio registration management
  - `api/meshtastic-radios/resend/route.ts` - Verification code resend
  - `api/admin/quota/route.ts` - Admin quota proxy

**run.gpx API (gpx.defcon.run):**
- Location: `apps/run.gpx/webapp/src/app/api/`
- Key routes:
  - `api/auth/[...nextauth]/route.ts` - Auth.js OIDC client
  - `api/gpx/files/route.ts` - GPX file CRUD
  - `api/gpx/files/[id]/route.ts` - Single file operations
  - `api/gpx/files/[id]/versions/route.ts` - Version history
  - `api/gpx/files/[id]/confirm/route.ts` - Upload confirmation
  - `api/gpx/folders/route.ts` - Folder management
  - `api/gpx/shares/route.ts` - Sharing operations
  - `api/gpx/shares/[token]/route.ts` - Access shared file
  - `api/gpx/download/presign/route.ts` - Download presigned URL
  - `api/user/mapbox-token/route.ts` - Per-user Mapbox token management

**run.cms (cms.defcon.run):**
- Location: `apps/run.cms/app/src/`
- Custom code:
  - `middlewares/cookie-auth.ts` - Reads JWT from httpOnly cookie, injects as Authorization header
  - `middlewares/services-validation.ts` - Validates CMS service claim against run.auth every 5 minutes
  - `extensions/strapi-plugin-sso/strapi-server.ts` - OIDC SSO integration
  - `api/health/controllers/health.ts` + `api/health/routes/health.ts` - Health check endpoint

**configui (localhost only):**
- Location: `apps/configui/main.go`
- Triggers: `go run .` from `apps/configui/`
- Responsibilities: HCL generation from web form, terragrunt execution with SSE streaming, SOPS editing, service discovery visualization, output exploration, backup/restore

**Release Pipeline:**
- Location: `apps/release-all.sh`
- Triggers: Manual execution or `--pr` flag for automated PR flow
- Responsibilities: Version bump, Docker build/push to ECR (all regions), branch/PR management, optional terragrunt apply

**Region Router:**
- Location: `apps/run.human/index.html`, `apps/run.auth/redirects/region.html`
- Triggers: Request to domain root (no region prefix)
- Responsibilities: Read `preferred-region` cookie, redirect to `/{region}/`

## Error Handling

**Strategy:** Fail-safe with graceful degradation for cross-service calls.

**Patterns:**
- **Auth validation failures:** If run.auth is unreachable during claims refresh in run.human, existing cached claims are preserved (no lockout during auth server maintenance). See `fetchFreshClaims()` in `apps/run.human/webapp/src/config/auth.ts`.
- **CMS services validation:** `apps/run.cms/app/src/middlewares/services-validation.ts` uses in-memory cache. If auth server is unreachable and no cache exists, allows through to prevent lockout.
- **Quota errors:** Custom `QuotaExceededError` class in `apps/run.human/webapp/src/lib/quota-client.ts` with rollback pattern (if type-specific quota fails, general quota is restored).
- **OIDC errors:** `apps/run.auth/webapp/src/config/oidc.ts` renders generic error page with server-side-only request ID for debugging.
- **API routes:** Try/catch with structured JSON error responses including `error` and `details` fields.

## Cross-Cutting Concerns

**Logging:**
- `console.log`/`console.error` throughout (no structured logging framework)
- Prefixed with service tags: `[run.human]`, `[OIDC Error {id}]`, `[OIDC Event]`, `[CookieAuth]`, `[ServicesValidation]`
- CloudWatch Logs via ECS log configuration with per-container stream prefixes (`nginx`, `app`)

**Validation:**
- GPX validation: Binary magic byte detection + control char rejection + XML structure check in `apps/run.gpx/webapp/src/lib/gpx-validator.ts`
- Upload type/size validation in `apps/run.human/webapp/src/lib/s3-client.ts` (GPX: 5MB, photos: 20MB)
- ALTCHA proof-of-work captcha on login in run.auth

**Authentication:**
- Per-service cookies: `sess_auth` (run.auth), `sess_run` (run.human), `sess_gpx` (run.gpx), `strapi_admin_token` (run.cms)
- All cookies scoped to `.defcon.run` domain, httpOnly, secure, sameSite=lax
- Server-to-server: `X-Internal-Secret` header validated in run.auth internal endpoints
- OIDC: PKCE required for all clients, `client_secret_post` token auth

**Service Discovery:**
- AWS Cloud Map namespace per region: `app-{region_label}-dc34.local`
- Service names registered: `run-auth`, `run-human`, `run-gpx`, `run-cms-master`, `run-cms-worker`
- Internal URLs resolve to container port 3000 (HTTP) bypassing nginx TLS

**Multi-Region:**
- Next.js `basePath` set to `/{region_label}` at Docker build time via `REGION_SHORT` env var
- CloudFront routes `/{region_label}/*` to corresponding regional ALB
- Region label derived from folder name: `infra/terraform/live/site/region/{region}/region.hcl`
- Skip regions configured in `site.hcl`: `skip_regions = ["ap-southeast-1", "ca-central-1"]`

---

*Architecture analysis: 2026-02-28*
