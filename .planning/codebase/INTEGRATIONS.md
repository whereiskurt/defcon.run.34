# External Integrations

**Analysis Date:** 2026-02-28

## APIs & External Services

**Authentication Providers:**
- GitHub OAuth - `next-auth/providers/github`
  - Provider endpoint: https://github.com/login/oauth/authorize
  - Token endpoint: https://github.com/login/oauth/access_token
  - Used by: run.auth, run.human (optional account linking)
  - Config: `config.providers.github.clientId/Secret` in `apps/run.auth/webapp/src/config/auth.ts`

- Discord OAuth - `next-auth/providers/discord`
  - Provider endpoint: https://discord.com/api/oauth2/authorize
  - Token endpoint: https://discord.com/api/oauth2/token
  - Used by: run.auth, run.human (optional account linking)
  - Config: `config.providers.discord.clientId/Secret`

- Strava OAuth - `next-auth/providers/strava`
  - Provider endpoint: https://www.strava.com/oauth/authorize
  - Token endpoint: https://www.strava.com/oauth/token
  - Used by: run.auth for activity tracking integration
  - Config: `config.providers.strava.clientId/Secret`
  - Scope: `activity:read` (read activity data only)

- Email/Nodemailer - Custom email-based auth
  - Used by: run.auth as fallback authentication
  - OTP-based: 6-digit numeric codes sent via SES
  - Verification token generation in `apps/run.auth/webapp/src/config/auth.ts:100-102`

**Internal Service Discovery:**
- OIDC Provider (run.auth)
  - Issuer: `https://auth.defcon.run/api/oidc` (prod) or `http://localhost:3002/api/oidc` (dev)
  - Endpoints:
    - Auth: `/api/oidc/auth`
    - Token: `/api/oidc/token`
    - UserInfo: `/api/oidc/me`
  - Used by: run.human, run.cms for federated authentication
  - Implementation: `oidc-provider` 9.6.0 in `apps/run.auth/webapp/src/entities/oidc-adapter.ts`

## Data Storage

**Databases:**
- AWS DynamoDB (primary, multi-region)
  - Connection: Via `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`
  - Tables:
    - `run-auth-authjs` - NextAuth sessions/users/accounts/verificationTokens
    - `run-auth-electro` - Custom ElectroDB entities (auth-profile, user-quota, etc.)
    - `run-human-authjs` - run.human NextAuth sessions
    - `run-human-electro` - run.human entities (run-user, user-upload)
    - `run-gpx-electro` - run.gpx entities (gpx-file, gpx-folder, gpx-share)
    - `run-quota-electro` - Centralized quota tracking
  - Global Tables enabled for multi-region replication
  - Client: ElectroDB 3.5.0+ for query builder interface
  - Env vars: `*_DYNAMODB_ID`, `*_DYNAMODB_SECRET`, `*_DYNAMODB_ENDPOINT` (local), `*_ELECTRO_ID`, `*_ELECTRO_SECRET`
  - Config files:
    - `apps/run.auth/webapp/src/entities/client.ts` - DynamoDB client setup
    - `apps/run.gpx/webapp/src/entities/gpx-file.ts` - ElectroDB schemas
    - `apps/run.human/webapp/src/entities/run-user.ts` - ElectroDB schemas

- SQLite (Strapi CMS, local primary)
  - File: `.tmp/data.db` (default)
  - Config: `apps/run.cms/app/config/database.ts`
  - Replication: Via Litestream to S3 for durability
  - Client: `better-sqlite3` 11.6.0

**File Storage:**
- AWS S3
  - Buckets:
    - `{prefix}-uploads` - User uploads (GPX files, photos)
      - Access: Presigned URLs for temporary, secure access
      - Config: `S3_UPLOADS_BUCKET`, `S3_UPLOADS_ACCESS_KEY`, `S3_UPLOADS_SECRET_KEY`
      - Used by: run.human upload API, run.gpx
      - Presigner: `@aws-sdk/s3-request-presigner` 3.x
    - `{prefix}-cms-media` - CMS media uploads
      - Provider: `@strapi/provider-upload-aws-s3` 4.15.0
      - Access: Via CloudFront CDN at `https://cms.defcon.run/{region}/cms/`
      - Config: `S3_MEDIA_BUCKET`, `S3_MEDIA_ACCESS_KEY`, `S3_MEDIA_SECRET_KEY`, `S3_MEDIA_REGION`
  - Cross-Region Replication (CRR) enabled for multi-region deployment
  - Env vars: `S3_*_BUCKET`, `S3_*_ACCESS_KEY`, `S3_*_SECRET_KEY`, `S3_*_REGION`
  - Policies: Bucket policies enforce CloudFront-only access

**Caching:**
- No external cache service (Redis, Memcached)
- Browser-level caching via CloudFront
- Session state: JWT tokens in cookies (not server sessions)

## Authentication & Identity

**Auth Provider:**
- Custom OIDC Provider (run.auth service)
  - Implementation: `oidc-provider` 9.6.0
  - Adapter: `@auth/dynamodb-adapter` 2.11.x for session/user persistence
  - Multi-provider support: Email + GitHub + Discord + Strava
  - Session strategy: JWT tokens
  - Cookie configuration: Secure, HttpOnly, SameSite=Lax
  - JWT secrets: Comma-separated list via `AUTH_JWT_SECRET`
  - Config: `apps/run.auth/webapp/src/config/auth.ts` (NextAuth setup)
  - Entity: `apps/run.auth/webapp/src/entities/oidc-adapter.ts` (OIDC-specific adapter)

**Session Management:**
- NextAuth 5.0.0-beta.30 (JWT strategy)
- Session maxAge: 1 day (86400 seconds)
- Session update interval: 1 minute (triggers JWT refresh)
- Token refresh interval: 5 minutes (calls auth server for claims)
- Invalidation: Via sessionVersion check (multi-device logout support)
- Cookie names: `sess_run` (run.human), `sess_auth` (run.auth), configurable per app

**Claims/Permissions:**
- User ID (sub)
- Email (email)
- Display name (name)
- Services (array) - custom claims for role/service association
- Linked providers (Discord, GitHub, Strava)
- Strava ID (if linked)
- Session version (for invalidation)
- Call to validate endpoint: `GET /api/session/validate/user/{userId}` with `X-Internal-Secret` header

## Monitoring & Observability

**Error Tracking:**
- None detected (CloudTrail for AWS API calls)

**Logs:**
- Console logging (stdout) in all services
- CloudWatch Logs via AWS CloudTrail module
- Application logs via ECS task logs in CloudWatch
- Strapi logs: Console output
- Auth logs: Security events logged to console (blocked emails, lockouts)

**Metrics:**
- CloudWatch metrics for ECS tasks
- Load testing: Artillery reports (not integrated with external APM)

## CI/CD & Deployment

**Hosting:**
- AWS ECS Fargate (containerized)
- Regions: us-east-1 (primary), ca-central-1, ap-southeast-1
- Services:
  - run.human (ECS service with 2 containers: nginx + Node.js)
  - run.auth (ECS service with 2 containers: nginx + Node.js)
  - run.cms (Master in us-east-1, replicas in other regions)
  - run.gpx (ECS service with 1 container: Node.js)
- Container registry: AWS ECR per region (Elastic Container Registry)
- Image names: `run-human-app`, `run-human-nginx`, `run-auth-app`, `run-auth-nginx`, `run-cms-app`, `run-cms-nginx`, `run-gpx-app`

**CI Pipeline:**
- GitHub Actions (inferred from CI environment variable)
- Build pipeline: `apps/build.sh`
  - Builds Docker images for service
  - Pushes to AWS ECR with version tags
  - Supports multi-region ECR repos
- Deploy pipeline: `apps/deploy.sh`
  - Deploys via Terragrunt to AWS
- Release pipeline: `apps/release-all.sh`
  - Parallel builds and deploys for all services, all regions
  - Multi-region coordination

**Infrastructure as Code:**
- Terraform 1.14+
- Terragrunt 0.97+ (wrapper)
- Modules: Located in `infra/terraform/modules/`
  - ecs-service, ecs-task, ecs-cluster
  - dynamodb (global tables)
  - s3-uploads, s3-uploads-replication, s3-uploads-processor
  - cloudfront, cloudfront-assets
  - email (SES configuration)
  - email-s3-replication
  - secrets (AWS Secrets Manager)
  - network, certs, cloudtrail, ec2spot, github-oidc
- State: S3 backend with DynamoDB lock table per region
- Providers: Multi-region AWS providers configured in `infra/terraform/providers/`

## Environment Configuration

**Required env vars (run.auth):**
- `AUTH_DYNAMODB_ID`, `AUTH_DYNAMODB_SECRET` - DynamoDB credentials
- `AUTH_DYNAMODB_DBNAME` - Table name for NextAuth
- `AUTH_ELECTRO_ID`, `AUTH_ELECTRO_SECRET` - ElectroDB credentials
- `AUTH_ELECTRO_DBNAME` - Table name for ElectroDB entities
- `AUTH_JWT_SECRET` - Comma-separated JWT signing keys
- `AUTH_INTERNAL_SECRET` - Shared secret for server-to-server calls
- `AUTH_COOKIE_DOMAIN` - Cookie domain for session persistence
- `AUTH_SES_REGION`, `AUTH_SES_SMTP_FROM` - SES email config
- `OIDC_*` - OIDC provider configuration (keys, endpoints)
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` - GitHub OAuth
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` - Discord OAuth
- `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` - Strava OAuth

**Required env vars (run.human):**
- `OIDC_RUNHUMAN_CLIENT_ID`, `OIDC_RUNHUMAN_SECRET` - OIDC client for run.human
- `RUN_DYNAMODB_*`, `RUN_ELECTRO_*` - Database credentials
- `AUTH_PUBLIC_URL`, `AUTH_INTERNAL_URL` - Auth server URLs
- `S3_UPLOADS_*` - S3 upload bucket credentials
- `RUN_PUBLIC_URL` - Public URL for redirect callbacks

**Required env vars (run.cms):**
- `S3_MEDIA_*` - S3 media bucket credentials
- `STRAPI_OIDC_CLIENT_ID`, `STRAPI_OIDC_CLIENT_SECRET` - OIDC for Strapi SSO
- `OIDC_*` - OIDC endpoints
- `JWT_SECRET` - Strapi JWT signing key
- `SES_FROM_ADDRESS`, `SES_REPLYTO_ADDRESS` - SES email config
- `DATABASE_FILENAME` - SQLite database path
- `APP_KEYS` - Strapi encryption keys (comma-separated)

**Secrets location:**
- AWS Systems Manager Parameter Store (prod)
- AWS Secrets Manager (for sensitive values)
- `.env.local` files (local development only, not committed)
- GitHub Actions secrets (for CI/CD)
- Environment variables injected via ECS task definition

## Webhooks & Callbacks

**Incoming:**
- OAuth callbacks:
  - GitHub: `/api/auth/callback/github`
  - Discord: `/api/auth/callback/discord`
  - Strava: `/api/auth/callback/strava`
  - Email: `/api/auth/callback/nodemailer`
  - OIDC: `/api/auth/callback/run.defcon.run`
- Strapi SSO callback:
  - `/strapi-plugin-sso/oidc/callback` - OIDC callback for CMS admin

**Outgoing:**
- None detected (no third-party integrations that receive webhooks)
- Strapi webhooks: Configured but not used (populated_relations: false)

---

*Integration audit: 2026-02-28*
