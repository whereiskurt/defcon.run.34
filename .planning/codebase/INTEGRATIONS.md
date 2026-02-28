# External Integrations

**Analysis Date:** 2026-02-28

## APIs & External Services

**OAuth / Identity Providers:**
- GitHub OAuth - Social login for auth.defcon.run
  - SDK: `next-auth/providers/github`
  - Secrets: `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` (SSM: `/dc34/secrets/{region}/github/*`)
  - Config: `apps/run.auth/webapp/src/config/auth.ts` lines 104-121

- Discord OAuth - Social login for auth.defcon.run
  - SDK: `next-auth/providers/discord`
  - Secrets: `AUTH_DISCORD_CLIENT_ID`, `AUTH_DISCORD_CLIENT_SECRET` (SSM: `/dc34/secrets/{region}/discord/*`)
  - Config: `apps/run.auth/webapp/src/config/auth.ts` lines 141-159

- Strava OAuth - Activity linking (not a login provider, used for account linking)
  - SDK: `next-auth/providers/strava`
  - Secrets: `AUTH_STRAVA_CLIENT_ID`, `AUTH_STRAVA_CLIENT_SECRET` (SSM: `/dc34/secrets/{region}/strava/*`)
  - Config: `apps/run.auth/webapp/src/config/auth.ts` lines 122-140
  - Scope: `activity:read`

**Mapping:**
- Mapbox - Map tiles for GPX Studio
  - SDK: Direct token usage (no SDK), passed to gpx-studio frontend at build time
  - Auth: `MAPBOX_DEFAULT_TOKEN` (SSM: `/dc34/secrets/{region}/mapbox/public_token`)
  - Users can set personal tokens via `mapboxPublicToken` field in AuthProfile entity
  - Token API: `apps/run.auth/webapp/src/app/api/profile/mapbox-token/route.ts`

**CAPTCHA / Anti-Abuse:**
- Altcha - Proof-of-work CAPTCHA (no third-party service, self-hosted)
  - SDK: `altcha` ^2.3.0 (client widget), `altcha-lib` ^1.4.1 (server verification)
  - Auth: `ALTCHA_HMAC_KEY` (SSM: `/dc34/secrets/{region}/altcha/secret`)
  - Challenge API: `apps/run.auth/webapp/src/app/api/captcha/challenge/route.ts`
  - Difficulty: maxNumber 2,000,000 (~40-60s on average device), 2-minute TTL

## Data Storage

**DynamoDB (Primary Database):**
- Provider: AWS DynamoDB with Global Tables (multi-region replication)
- Client: ElectroDB ^3.5.x over `@aws-sdk/client-dynamodb`
- Global table pattern: pk/sk composite keys with GSIs (gsi1pk-gsi1sk-index, gsi2pk-gsi2sk-index, etc.)
- Billing: PAY_PER_REQUEST (on-demand)
- Streams: Enabled (NEW_AND_OLD_IMAGES) on all tables

- **Tables:**
  - `run-auth-electro` - Auth profiles, OIDC adapter data (3-region global table)
    - Entities: `AuthProfile`, `OIDCAdapter`
    - Client: `apps/run.auth/webapp/src/entities/client.ts` (electroClient)
  - `run-auth-authjs` - Auth.js sessions, users, accounts (3-region global table, TTL enabled)
    - Used by: `@auth/dynamodb-adapter`
    - Client: `apps/run.auth/webapp/src/entities/client.ts` (dynamodbClient)
  - `run-quota-electro` - Centralized quota service (3-region global table)
    - Entity: `UserQuota` (`apps/run.auth/webapp/src/entities/user-quota.ts`)
    - Client: `apps/run.auth/webapp/src/entities/client.ts` (quotaClient)
  - `run-human-electro` - Run app user data, uploads (3-region global table)
    - Entities: `RunUser`, `UserUpload`
    - Client: `apps/run.human/webapp/src/entities/client.ts`
  - `run-human-authjs` - Run app Auth.js sessions (3-region global table, TTL enabled)
    - Used by: `@auth/dynamodb-adapter` in run.human
  - `run-gpx-electro` - GPX file metadata, folders, shares (3-region global table)
    - Entities: `GpxFile`, `GpxFolder`, `GpxShare`
    - Client: `apps/run.gpx/webapp/src/entities/gpx-file.ts`

- **Credentials:** Per-table IAM users with access keys stored in SSM Parameter Store
  - Pattern: `/dc34/dynamodb/{region}/{table_name}/{access_key_id|secret_access_key|table_name}`

**SQLite (CMS Only):**
- Provider: better-sqlite3 on local filesystem
- Location: `/data/strapi.db` in container
- Config: `apps/run.cms/app/config/database.ts`
- Replication: Litestream 0.5.5 continuous replication to S3
  - Master writes to S3 bucket (`cms-litestream`, us-east-1 only)
  - Workers restore from S3 on startup, then tail replications
  - Config files: `apps/run.cms/app/litestream.master.yml`, `apps/run.cms/app/litestream.worker.yml`

**S3 (File Storage):**
- `run-human-*` buckets - User GPX/photo uploads (3 regions, versioned)
  - Presigned URL generation: `apps/run.human/webapp/src/lib/s3-client.ts`
  - Credentials: `S3_UPLOADS_ACCESS_KEY`, `S3_UPLOADS_SECRET_KEY`, `S3_UPLOADS_BUCKET`
  - Upload types: GPX (5MB limit), Photo (20MB limit)
  - Lifecycle: uploads expire in 7 days, processed files kept indefinitely
- `run-gpx-*` buckets - GPX file storage (3 regions, versioned, cross-region replication)
  - Presigned URL generation: `apps/run.gpx/webapp/src/lib/s3-client.ts`
  - User-isolated prefix access (not full bucket)
- `cms-litestream` bucket - SQLite WAL replication (us-east-1 only, full bucket access)
  - SSM params replicated to other regions so workers can access master bucket
- `cms-media-*` buckets - CMS media uploads (3 regions, cross-region replication)
  - CloudFront OAC access enabled for CDN serving
  - Upload path: `{region}/cms/` (e.g., `use1/cms/image.png`)
- CloudFront assets buckets - Static Next.js assets per region per app
  - Populated during build: `apps/build.sh` syncs `.next/static` and `/public`
  - SSM lookup: `/dc34/cloudfront-assets/{region}/{app}/bucket_name`

**Caching:**
- None (no Redis/Memcached). JWT tokens serve as session cache. DynamoDB serves as primary datastore.

## Authentication & Identity

**Central Auth Service (auth.defcon.run):**
- Implementation: Auth.js v5 (next-auth) + custom OIDC Provider (node oidc-provider)
- Config: `apps/run.auth/webapp/src/config/auth.ts` + `apps/run.auth/webapp/src/config/oidc.ts`
- Session strategy: JWT (not database sessions)
- Session max age: 15 days (auth), 1 day (run.human, run.gpx)

**OIDC Provider:**
- Issuer: `https://auth.defcon.run/{region}/api/oidc`
- Registered clients:
  - `run.human` (run.defcon.run) - Main app
  - `cms-strapi` (cms.defcon.run) - CMS admin via strapi-plugin-sso
  - `gpx-studio` (gpx.defcon.run) - GPX editor
- Scopes: `openid profile email services`
- Custom claims: `services` (authorized service list), `linked_providers`, `mapboxPublicToken`
- PKCE: Required for all clients
- Token auth: `client_secret_post`
- Cookie domain: `.defcon.run` (shared across subdomains)

**Downstream App Auth Pattern:**
- Each app (run.human, run.gpx) authenticates via OIDC to auth.defcon.run
- Provider ID: `run.defcon.run` (custom OIDC provider)
- Token refresh: Periodic claims refresh from auth server (5-minute intervals)
- Session validation: Server-to-server via `X-Internal-Secret` header
  - Endpoint: `/api/session/validate/user/{userId}`
  - Internal URL: Service discovery (`http://run-auth.app-{region}-{domain-slug}.local:3000/{region}`)
- Session invalidation: `sessionVersion` field in AuthProfile; increment to revoke all sessions
- User lockout: `lockedOut` boolean in AuthProfile, checked on every claims refresh

**Email Magic Link:**
- Provider: Auth.js Nodemailer provider + AWS SES
- Verification: 6-digit numeric code (3+3 format)
- Transport: `nodemailer` with SES backend
- Config: `apps/run.auth/webapp/src/config/auth.ts` (sendVerificationRequest)

**Per-App Cookie Names:**
- auth: `sess_auth`, `csrf_auth`, `callback_auth`
- run.human: `sess_run`, `csrf_run`, `callback_run`, `state_run`
- gpx: `sess_gpx`, `csrf_gpx`, `callback_gpx`, `state_gpx`

## Email (AWS SES)

**Provider:** AWS Simple Email Service (SES)
- SDK: `@aws-sdk/client-sesv2`, `nodemailer` with SES transport
- Domains: `email.defcon.run`, `run.defcon.run`, `auth.defcon.run`
- Primary region: `us-east-1`
- Regional domains: Created per region

**Email Types:**
- Magic link sign-in (auth.defcon.run) - Verification codes for passwordless login
- Meshtastic radio verification (run.defcon.run) - Radio registration codes
- CMS notifications (cms.defcon.run) - Strapi system emails

**Email Forwarding:**
- S3-based email receipt and forwarding
- Rules defined in `infra/terraform/live/site/site.hcl` (email.fwd_rules)
- Cross-region S3 bucket replication for email storage (use1, cac1, apse1)

**SMTP IAM Users:**
- Per-service: `run.defcon.run`, `auth.defcon.run`, `cms.defcon.run`
- SSM: `/dc34/ses/from_address`

## Quota Service

**Centralized Quota System:**
- Service: Hosted in run.auth, consumed by run.human and run.gpx
- Table: `run-quota-electro` (DynamoDB Global Table)
- Entity: `UserQuota` (`apps/run.auth/webapp/src/entities/user-quota.ts`)
- Service code: `apps/run.auth/webapp/src/services/quota.ts`
- Client library: `apps/run.human/webapp/src/lib/quota-client.ts`

**Quota Types:**
- `file_upload`, `gpx_upload`, `gpx_save`, `gpx_share`, `photo_upload`
- `strava_sync`, `checkin`, `meshtastic_radio`, `qr_scan`, `displayname_change`, `qr_sheet`

**Quota Tiers:**
- `zero` - Blocked users (no access)
- `upload` - Standard users (normal limits)
- `admin` - Administrators (elevated limits)

**Internal API Pattern:**
- Auth: `X-Internal-Secret` header (shared secret via SSM)
- Endpoints: `/api/internal/quota/{userId}/{quotaId}/consume`, `/restore`
- Atomic operations: DynamoDB conditional expressions for safe concurrent consumption

## Upload Processing Pipeline

**Architecture:** S3 triggers -> SNS -> Lambda (on-upload) -> DynamoDB Stream -> Lambda (on-process)

**on-upload Lambda:**
- Location: `infra/terraform/live/site/services/run.human/lambdas/on-upload/index.py`
- Runtime: Python 3 (boto3)
- Trigger: SNS notification from S3 ObjectCreated events
- Function: Updates DynamoDB status from `pending` to `uploaded`
- Multi-region: Checks S3 ReplicationStatus, uses conditional DynamoDB update

**on-process Lambda:**
- Location: `infra/terraform/live/site/services/run.human/lambdas/on-process/index.py`
- Runtime: Python 3 (boto3)
- Trigger: DynamoDB Streams (MODIFY events where status = `uploaded`)
- Function: Claims work via conditional update, processes GPX/photo, stores results
- GPX processing: XML parsing, Haversine distance calculation, elevation gain, bounds
- Photo processing: Placeholder (future: Pillow resize, EXIF, Rekognition AI tagging)

**Terraform Module:** `infra/terraform/modules/s3-uploads-processor/v1.0.0/`

## Monitoring & Observability

**Error Tracking:**
- Console logging (no external error tracking service like Sentry)
- Structured log messages with prefixes: `[run.human]`, `[run.gpx]`, `[OIDC Error {requestId}]`

**Logs:**
- CloudWatch Logs via ECS task log configuration
- Log stream prefixes: `nginx` and `app` per container
- OIDC errors include request IDs for correlation

**Container Health Checks:**
- nginx: `curl -k -f https://localhost/hello`
- Next.js apps: `curl -f http://localhost:3000/{region}/`
- Strapi CMS: `curl -f http://localhost:1337/_health`

## CI/CD & Deployment

**Hosting:**
- AWS ECS Fargate (all services)
- AWS CloudFront CDN (all public-facing services)
- Docker images stored in AWS ECR (IMMUTABLE tags)

**CI Pipeline (GitHub Actions):**
- `.github/workflows/deploy.yml` - Full release: merge PR, terragrunt apply (ecs-task + ecs-service), CloudFront invalidation
- `.github/workflows/terragrunt-plan.yml` - Infrastructure plan (auto-triggered on VERSION file changes)
- `.github/workflows/terragrunt-apply.yml` - Reusable terragrunt apply workflow
- `.github/workflows/e2e-tests.yml` - Playwright E2E tests against production
- `.github/workflows/gitleaks-scan.yml` - Secret scanning
- `.github/workflows/checkov-scan.yml` - IaC security
- `.github/workflows/prowler-scan.yml` - AWS security posture
- `.github/workflows/npm-audit.yml` - Dependency vulnerabilities
- `.github/workflows/buildpub.yml` - Public build
- `.github/workflows/ec2-runner.yml` - Self-hosted EC2 runner management
- `.github/workflows/rollback.yml` - Rollback workflow

**AWS Authentication (CI):**
- GitHub OIDC -> IAM role (`dc34-github-deploy`)
- Terraform module: `infra/terraform/modules/github-oidc/`
- No long-lived AWS credentials in GitHub

**Release Pipeline (Local):**
- Script: `apps/release-all.sh`
- Flow: Bump versions -> Build Docker images (parallel per region) -> Push to ECR -> Optional terragrunt apply
- Apps: `run.auth`, `run.human`, `run.cms`, `run.gpx`
- Regions: `use1`, `cac1`, `apse1`
- Options: `--parallel`, `--pr`, `--skip-bump`, `--skip-nginx`, `--with-terragrunt`

**Build Pipeline (Local):**
- Script: `apps/build.sh`
- Components: `nginx` (sidecar), `webapp` (Next.js app), `app` (Strapi CMS)
- Static asset extraction: Docker build -> extract `.next/static` -> sync to S3 CloudFront bucket
- ECR naming: `dc34-{service}-{component}` (e.g., `dc34-run-auth-nginx`)

**Deploy Pipeline:**
- Script: `apps/deploy.sh`
- Flow: Copy VERSION files to terraform -> `terragrunt apply` (ecs-task, ecs-service)
- Blue/green deployment via ECS task definition updates

## AWS Services Used

**Compute:**
- ECS Fargate - Container hosting (cluster: `app`, 3 regions)
- Lambda - Upload processing (Python, triggered by SNS/DynamoDB Streams)
- EC2 Spot (optional) - Self-hosted GitHub Actions runners, WAF testing fleet

**Storage:**
- DynamoDB - Primary database (6+ Global Tables)
- S3 - File storage (uploads, media, Litestream, CloudFront assets, email)
- ECR - Container image registry (IMMUTABLE tags, 10 max images, 30-day expiry)

**Networking:**
- CloudFront - CDN with regional ALB origins and S3 origins
- ALB - Application Load Balancer per region (HTTPS, host-based routing)
- WAF - Web Application Firewall on CloudFront (configurable rulesets)
- Route 53 - DNS (defcon.run zone)
- Cloud Map - Service discovery (`app-{region}-dc34.local` namespace)
- VPC - Per-region networking

**Security:**
- IAM - Per-service, per-table credentials
- SSM Parameter Store - Runtime secrets injection into ECS tasks
- SOPS - Encrypt secrets at rest in git (`.secrets.sops.json`)
- KMS - Key management for SOPS and SSM encryption
- ACM - TLS certificates for ALBs and CloudFront
- CloudTrail - API audit logging (`infra/terraform/modules/cloudtrail/`)

**Messaging:**
- SES - Transactional email (magic links, verification codes)
- SNS - S3 event notifications to Lambda

## Environment Configuration

**Required env vars (per service):**

*run.auth:*
- `AUTH_JWT_SECRET` - JWT signing secret
- `AUTH_DYNAMODB_*` - DynamoDB credentials (ID, SECRET, DBNAME, REGION)
- `AUTH_ELECTRO_*` - ElectroDB table credentials
- `AUTH_QUOTA_*` - Quota table credentials
- `AUTH_SES_*` - SES configuration (REGION, SMTP_FROM)
- `AUTH_GITHUB_*`, `AUTH_STRAVA_*`, `AUTH_DISCORD_*` - OAuth provider credentials
- `OIDC_*` - OIDC provider configuration (COOKIE_KEYS, client credentials per app)
- `ALTCHA_HMAC_KEY` - CAPTCHA secret
- `AUTH_INTERNAL_SECRET` - Server-to-server auth secret

*run.human:*
- `AUTH_JWT_SECRET`, `AUTH_INTERNAL_SECRET` - Auth secrets
- `OIDC_RUNHUMAN_*` - OIDC client credentials
- `RUN_DYNAMODB_*`, `RUN_ELECTRO_*` - DynamoDB credentials
- `S3_UPLOADS_*` - S3 upload bucket credentials
- `RUN_SES_*` - Email configuration

*run.gpx:*
- `AUTH_JWT_SECRET`, `AUTH_INTERNAL_SECRET` - Auth secrets
- `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` - OIDC credentials
- `DYNAMODB_*` - DynamoDB credentials
- `S3_UPLOADS_*` - S3 storage credentials
- `MAPBOX_DEFAULT_TOKEN` - Mapbox map tiles

*run.cms:*
- `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`, `APP_KEYS`, `JWT_SECRET` - Strapi secrets
- `S3_LITESTREAM_*` - Litestream replication bucket
- `S3_MEDIA_*` - Media upload bucket
- `STRAPI_OIDC_*` - OIDC SSO credentials
- `AUTH_INTERNAL_SECRET` - Server-to-server validation

**Secrets storage:**
- SSM Parameter Store (per-region) - Runtime injection into ECS tasks
- SOPS-encrypted JSON (`.secrets.sops.json`) - Source of truth in git
- Pattern: `/dc34/secrets/{region}/{provider}/{key}`

## Webhooks & Callbacks

**Incoming:**
- OIDC callbacks: `/api/auth/callback/run.defcon.run` (all apps)
- Strapi SSO callback: `/{region}/strapi-plugin-sso/oidc/callback` (CMS)
- S3 upload notifications: SNS -> Lambda (on-upload)
- DynamoDB Streams: Stream events -> Lambda (on-process)

**Outgoing:**
- GitHub OAuth: `https://github.com/login/oauth/authorize`
- Discord OAuth: `https://discord.com/api/oauth2/authorize`
- Strava OAuth: `https://www.strava.com/oauth/authorize`
- Session validation: Internal HTTP calls between services via Cloud Map service discovery

## Planned Integrations (Not Yet Implemented)

**Meshtastic Flasher (flash.defcon.run):**
- Design doc: `docs/plans/2026-02-28-meshtastic-flasher-design.md`
- Status: Design approved, not implemented
- Key integrations: `esptool.js` (Web Serial flashing), `@meshtastic/core` (device configuration)
- Auth: OIDC client -> auth.defcon.run (same pattern as run.human)
- No new AWS services required

**MQTT (mqtt.defcon.run):**
- Referenced in `RunUser` entity (`mqttUsername`, `mqttPassword`, `mqttUsertype` fields)
- Credentials generated on user creation (`apps/run.human/webapp/src/entities/run-user.ts`)
- MQTT broker not yet deployed; credentials are pre-generated

**WAF Testing (waffaw):**
- Design doc: `apps/waffaw/DESIGN.md`
- Status: Design complete, Terraform module exists (`infra/terraform/modules/waffaw/`)
- Architecture: S3 control plane, EC2 Spot fleet + ECS Fargate, Artillery + Playwright
- Currently disabled in site.hcl (`waffaw.enabled = false`)

---

*Integration audit: 2026-02-28*
