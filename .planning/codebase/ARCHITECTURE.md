# Architecture

**Analysis Date:** 2026-02-28

## Pattern Overview

**Overall:** Multi-region polyglot microservices architecture with AWS infrastructure (Terraform/Terragrunt), Next.js web applications, and Strapi CMS. CloudFront + regional ALBs route traffic to ECS Fargate containers across 3 regions (us-east-1 primary, ca-central-1, ap-southeast-1).

**Key Characteristics:**
- Multi-region deployment with region-prefixed URL routing (`/use1/*`, `/cac1/*`, `/apse1/*`)
- Centralized identity provider (run.auth) using Auth.js v5 + OIDC
- Service discovery via AWS Cloud Map namespaces per region
- DynamoDB (multi-region Global Tables v2) with ElectroDB ORM for domain entities
- S3 + Lambda event-driven uploads with quota tracking
- Terragrunt-managed infrastructure code with service definitions and regional overrides

## Layers

**Presentation (Next.js Apps):**
- Purpose: Server-side and client-side rendering, API routes, static assets, forms, navigation
- Location: `apps/run.human/webapp/src/`, `apps/run.auth/webapp/src/`, `apps/run.gpx/webapp/src/`
- Contains: React components, Next.js app router layouts, API route handlers, middleware
- Depends on: Config (environment variables), services (quota, upload clients), entities (DynamoDB models), Auth.js session
- Used by: End users via CloudFront + ALB

**Services (Business Logic):**
- Purpose: Domain-specific operations (quota management, upload handling, profile management)
- Location: `apps/{service}/webapp/src/services/`, `apps/{service}/webapp/src/lib/`
- Contains: Functions for quota consumption/restoration, file validation, profile sync, etc.
- Depends on: Entities, external clients (AWS SDK, OIDC)
- Used by: API routes, cron jobs, Lambda functions

**Entities (Data Models):**
- Purpose: ORM definitions, database client configuration, type definitions
- Location: `apps/{service}/webapp/src/entities/`
- Contains: ElectroDB models (RunUser, UserUpload), Auth.js DynamoDB adapters, client initialization
- Depends on: AWS SDK clients, environment variables
- Used by: Services, API routes

**Configuration (Environment & Secrets):**
- Purpose: Application settings, credentials, region-specific URLs
- Location: `apps/{service}/webapp/src/config/`, environment variables, SSM Parameter Store
- Contains: Auth.js config, provider credentials, DynamoDB endpoints, service discovery URLs
- Depends on: Environment variables, AWS SSM ParameterStore
- Used by: All application layers

**Infrastructure Code:**
- Purpose: AWS resource definitions, networking, ECS tasks, databases, secrets
- Location: `infra/terraform/modules/`, `infra/terraform/live/site/`
- Contains: Terraform/HCL modules (ECS, DynamoDB, CloudFront, etc.), service definitions, regional configs
- Depends on: Terragrunt, AWS provider
- Used by: CI/CD pipeline (GitHub Actions), manual deployments

## Data Flow

**User Authentication & Session:**

1. User visits domain (e.g., `run.defcon.run`) → CloudFront routes to region → Next.js middleware passes URL via headers
2. Next.js checks Auth.js session cookie (httpOnly, secure)
3. If no session and `?autoLogin=true`: redirect to `/auth/signin` on run.auth
4. run.auth: Email OTP, Discord, GitHub, or Strava OAuth → Auth.js JWT creation → DynamoDB session table (`run-auth-authjs`)
5. JWT stored in httpOnly cookie, domain=`.defcon.run` (shared across services)
6. Client redirected back to run.human/gpx/etc. with valid session

**Session Validation (Every 5 minutes):**
- Client initiates: `GET /api/session/validate` (run.auth)
- run.auth validates JWT against DynamoDB, re-validates enabled providers
- Returns updated session or 401 Unauthorized
- Services re-validate before critical operations

**User Data Sync:**

1. User logs in → Auth.js JWT callback upserts AuthProfile entity to DynamoDB (`run-human-electro` or `run-auth-electro`)
2. Services and profile pages query AuthProfile for linked providers, display name, Strava status
3. Global Table v2 replicates across regions asynchronously

**Upload (Quota-Driven) Flow:**

1. Client requests presigned S3 URL: `POST /api/upload/presign` (run.human)
2. run.human calls `restoreQuota(..., "file_upload", 1)` → run.auth via internal service discovery
3. run.auth checks user quota in DynamoDB (`dc34/quotas`), deducts 1, returns remaining
4. If allowed, presigned URL generated; client uploads file to S3
5. S3 triggers `on-upload` Lambda → records UserUpload entity (status=`pending`)
6. Object processor Lambda (triggered on tag): validates file, updates entity (status=`processed`)
7. If file invalid/expired: Lambda calls `restoreQuota(..., "file_upload", 1)` to refund quota

**Config/Infrastructure:**

1. Developer commits code → GitHub Actions triggers terragrunt-plan.yml
2. Terragrunt reads `site.hcl` (global site config), `services/run.human/service.hcl` (service config)
3. Substitutes template vars: `{{REGION}}`, `{{REGION_LABEL}}`, `{{SITE_DOMAIN}}`
4. Builds module graphs: ECS task → ECS service → ALB → DynamoDB → ECR → Secrets
5. Manual approval → terragrunt-apply.yml deploys to AWS
6. New app versions: `release-all.sh` bumps VERSION files, pushes Docker images to ECR, updates service definitions

**State Management:**
- Session state: DynamoDB (httpOnly JWT cookie in browser)
- User data: DynamoDB multi-region tables (RunUser, UserUpload, AuthProfile)
- Quota state: DynamoDB (centralized in run.auth)
- Secrets: AWS SSM Parameter Store (KMS-encrypted), sourced from `.secrets.sops.json` (SOPS)
- Infrastructure state: S3 + DynamoDB lock table (Terraform)

## Key Abstractions

**Next.js App (run.human, run.auth, run.gpx):**
- Purpose: Web application container with dual concerns: Next.js (Node.js server) + nginx (TLS termination/proxy)
- Examples: `apps/run.human/webapp/` (Next.js dir structure)
- Pattern: Two-container ECS task (nginx listening :443 → `http://localhost:3000` app container)
  - Nginx handles TLS termination, proxy headers, regional prefix stripping
  - Next.js serves SSR pages, API routes, static assets
  - basePath set to `/{REGION_LABEL}` at build time for regional isolation

**ElectroDB Entity:**
- Purpose: Type-safe DynamoDB ORM abstraction for domain models
- Examples: `apps/run.human/webapp/src/entities/run-user.ts`, `apps/run.auth/webapp/src/entities/auth-profile.ts`
- Pattern: Define pk/sk patterns, GSIs, and queryable attributes; ElectroDB generates DynamoDB queries automatically
  - Reduces boilerplate, provides compile-time type checking
  - Queries use fluent API: `Entity.query.attr().eq(value).go()`

**Service Discovery (Cloud Map):**
- Purpose: Container-to-container DNS resolution within a region
- Examples: `run-auth.app-{{REGION_LABEL}}-dc34.local:3000` (internal URL in env vars)
- Pattern: Each ECS service registers its app container; other services resolve via local DNS
  - `AUTH_INTERNAL_URL` = service discovery URL for run.auth
  - Bypasses CloudFront/ALB for inter-service calls

**Quota System (Centralized):**
- Purpose: Track and enforce per-user limits on uploads, file sizes, requests
- Examples: `apps/run.auth/webapp/src/lib/quota-client.ts`, API routes for consume/restore/check
- Pattern: Centralized in run.auth; other services call via internal HTTP or Lambda
  - Quota IDs: "file_upload", "gpx_upload", "photo_upload", etc.
  - DynamoDB table: `{pk: userId, sk: quotaId, remaining: number, ...}`
  - Optimistic consume: decrement; if error, client retries

**Multiregion DynamoDB:**
- Purpose: Replicate user data across 3 AWS regions for availability
- Examples: `run-human-electro`, `run-auth-electro` (Global Table v2)
- Pattern: First region (us-east-1) is primary; replicas stream changes asynchronously
  - Consistent within a region (eventual consistency across regions)
  - All regions can read; only primary writes for global tables

**Auth.js + OIDC Dual Role:**
- Purpose: run.auth acts as both OAuth2 session manager (Auth.js) and OIDC provider (oidc-provider)
- Examples: `apps/run.auth/webapp/src/config/auth.ts` (Auth.js), `apps/run.auth/webapp/src/config/oidc.ts` (oidc-provider)
- Pattern: Auth.js handles login/logout for end users; oidc-provider exposes OIDC endpoints for service-to-service trust
  - Clients: run.human, run.gpx, run.cms (Strapi) register as OIDC clients
  - ID token includes: openid, profile, email, services (custom scope)

## Entry Points

**run.human (run.defcon.run):**
- Location: `apps/run.human/webapp/src/app/layout.tsx`, `app/page.tsx`, `app/api/[...route].ts`
- Triggers: HTTP requests to CloudFront (any region label) → ALB → ECS task
- Responsibilities: Render public/protected routes (user profile, Meshtastic radios, file uploads), call quota/upload APIs, manage auth state

**run.auth (auth.defcon.run):**
- Location: `apps/run.auth/webapp/src/app/(authlogin)/signin/page.tsx`, `app/api/auth/[...nextauth]/route.ts`
- Triggers: OAuth redirects (from Discord/GitHub/Strava), email sign-in, service-to-service OIDC requests
- Responsibilities: Email OTP verification, OAuth callback handling, JWT issuance, quota management, OIDC token delivery, session validation

**run.gpx (gpx.defcon.run):**
- Location: `apps/run.gpx/webapp/src/app/layout.tsx`, `app/studio/app` (SvelteKit bundled)
- Triggers: HTTP requests for GPX editor UI and API
- Responsibilities: Serve Next.js + embedded gpx-studio (SvelteKit); cloud save to S3 + DynamoDB; handle OIDC auth via run.auth

**run.cms (cms.defcon.run):**
- Location: `apps/run.cms/app/src/index.ts` (Strapi entry), supervisord manages Strapi + Litestream
- Triggers: Admin requests to /admin, API requests to /api/...
- Responsibilities: Serve Strapi CMS, OIDC SSO login, read-only replicas sync from master, serve API content to frontend apps

**Terraform/Terragrunt:**
- Location: `infra/terraform/live/site/terragrunt.hcl` (root), `infra/terraform/live/site/region/*/terragrunt.hcl` (regional), `infra/terraform/modules/*/v1.0.0/` (module implementations)
- Triggers: `terragrunt plan --all`, `terragrunt apply` (manual or CI/CD)
- Responsibilities: Provision/update VPC, ECS clusters, ALBs, DynamoDB tables, ECR repos, CloudFront, IAM roles, secrets

## Error Handling

**Strategy:** Layer-based error handling with graceful degradation.

**Patterns:**

- **API Route Errors:** Return structured JSON `{ error: string, code?: string, details?: unknown }` with appropriate HTTP status codes
  - 401: Unauthorized (session invalid, no JWT)
  - 403: Forbidden (insufficient permissions, quota exhausted)
  - 400: Bad request (invalid input, malformed file)
  - 500: Server error (log to CloudWatch, return generic message to client)

- **DynamoDB Errors:** Retry logic in SDK with exponential backoff (already configured in AWS SDK)
  - ElectroDB queries catch and re-throw; caller decides on retry vs. fail

- **Quota Exhaustion:** API returns `{ remaining: 0 }` in response; client UI displays "quota exhausted" message

- **Session Validation Failure:** Middleware redirects to `/api/auth/signin` with `?autoLogin=true` for SSO re-auth

- **File Upload Errors:** Lambda catches exceptions, marks upload as `failed`, restores quota

- **Terraform Errors:** Terragrunt retries transient network errors (configured in `terragrunt.hcl` error blocks); operator reviews and retries on plan failure

## Cross-Cutting Concerns

**Logging:**
- Approach: `console.log()` / `console.error()` in Node.js apps; logs collected by ECS (CloudWatch Logs)
- Pattern: Log at entry/exit of critical functions, errors, and quota operations
- Example: `console.error("[cleanupStaleUploads] Scan error:", error);` in `apps/run.human/webapp/src/services/quota.ts`

**Validation:**
- Approach: Type-safe validation via TypeScript, optional runtime checks via schema libraries
- Pattern: API routes validate input `req.body` before processing; ElectroDB models validate pk/sk/attribute types at compile time
- File validation: `apps/run.human/webapp/src/app/api/upload/presign/route.ts` validates GPX files (magic byte, control chars, XML structure)

**Authentication:**
- Approach: Auth.js v5 JWT + httpOnly cookies at session layer; `X-Internal-Secret` header for server-to-server calls
- Pattern: Middleware intercepts requests, verifies JWT, adds session to context
  - `apps/run.human/webapp/src/middleware.ts` passes URL to server components
  - Auth.js sessions automatically refreshed every `session.updateAge` (24 hours default)
  - Server-to-server: run.human → run.auth quota API uses `AUTH_INTERNAL_SECRET` env var

**Authorization:**
- Approach: Role-based at application level (no IAM roles in frontend code)
- Pattern: run.auth manages user profiles and roles; other services check session claims
  - Example: Admin quota endpoints in run.auth check `X-Internal-Secret` header before allowing manipulation

**Regional Isolation:**
- Approach: basePath set per region; CloudFront routes by path prefix
- Pattern: Each region's ALB listens on same port (443), processes requests for its region only
  - `basePath: "/{REGION_LABEL}"` in Next.js config means relative links stay within region
  - `/use1/api/...` processed by us-east-1, `/cac1/api/...` by ca-central-1

**Secrets Management:**
- Approach: AWS SSM Parameter Store (KMS-encrypted), sourced from `.secrets.sops.json` (SOPS-encrypted commit)
- Pattern: ECS task definition injects secrets as environment variables at launch time
  - Path pattern: `/dc34/secrets/{region_label}/{category}/{key}`
  - Example: `/dc34/secrets/use1/jwt/secret` contains `AUTH_JWT_SECRET` for us-east-1

---

*Architecture analysis: 2026-02-28*
