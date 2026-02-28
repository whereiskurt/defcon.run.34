# Technology Stack

**Analysis Date:** 2026-02-28

## Languages

**Primary:**
- TypeScript 5.x - All Next.js web applications (`apps/run.human/webapp/`, `apps/run.auth/webapp/`, `apps/run.gpx/webapp/`), ElectroDB entities, API routes
- HCL (HashiCorp Configuration Language) - All Terraform/Terragrunt infrastructure (`infra/terraform/`)

**Secondary:**
- Go 1.22 - ConfigUI local infrastructure management tool (`apps/configui/`)
- Python 3 - AWS Lambda upload processors (`infra/terraform/live/site/services/run.human/lambdas/`)
- Bash - Build, deploy, and release scripts (`apps/build.sh`, `apps/deploy.sh`, `apps/release-all.sh`), waffaw agent (`apps/waffaw/agent.sh`)

## Runtime

**Environment:**
- Node.js (current-alpine in Docker, Node 22 for CMS, Node 22 for CI)
- Target: `ES2017` (tsconfig compilerOptions)

**Package Manager:**
- npm (all apps use `package-lock.json`)
- Lockfiles: Present in all apps

## Frameworks

**Core:**
- Next.js 16.1.x - Web framework for run.human, run.auth, run.gpx (`apps/run.*/webapp/package.json`)
- React 19.2.x - UI rendering for run.human, run.auth, run.gpx
- Strapi 5.6 - Headless CMS (`apps/run.cms/app/package.json`)
- HeroUI 2.8.x - Component library for run.human and run.auth
- Tailwind CSS 4 - Utility CSS framework for all Next.js apps

**Auth:**
- Auth.js (next-auth) 5.0.0-beta.30 - Session management across all Next.js apps
- oidc-provider 9.6.0 - OpenID Connect provider in run.auth (`apps/run.auth/webapp/src/config/oidc.ts`)
- Altcha 2.3.0 / altcha-lib 1.4.1 - Proof-of-work CAPTCHA (`apps/run.auth/webapp/src/app/api/captcha/`)

**Data:**
- ElectroDB 3.5.x - DynamoDB ORM/entity modeling (`apps/run.*/webapp/src/entities/`)
- @auth/dynamodb-adapter 2.11.x - Auth.js session storage in DynamoDB
- better-sqlite3 11.6.0 - SQLite driver for Strapi CMS (`apps/run.cms/app/package.json`)

**Testing:**
- Playwright 1.48+ - E2E browser testing (`apps/run.auth/e2e/`)
- Artillery 2.0.22 + artillery-engine-playwright 1.27.0 - Load testing with real browsers (`apps/waffaw/`)

**Build/Dev:**
- Docker + Docker Buildx - Container builds (multi-stage, `linux/amd64`)
- Terragrunt 0.97 - Terraform orchestration across modules and regions
- Terraform 1.14 - Infrastructure as Code
- Litestream 0.5.5 - SQLite replication to S3 for CMS (`apps/run.cms/app/Dockerfile.app`)
- supervisord - Process management in CMS containers (master + worker modes)

**Security/Scanning (CI):**
- Gitleaks - Secret scanning (`.github/workflows/gitleaks-scan.yml`)
- Checkov - Infrastructure security scanning (`.github/workflows/checkov-scan.yml`)
- Prowler - AWS security posture (`.github/workflows/prowler-scan.yml`)
- npm audit - Dependency vulnerability scanning (`.github/workflows/npm-audit.yml`)

## Key Dependencies

**Critical (AWS SDK):**
- `@aws-sdk/client-dynamodb` ^3.948.0 - DynamoDB access (all apps)
- `@aws-sdk/lib-dynamodb` ^3.948.0 - DynamoDB Document Client
- `@aws-sdk/client-s3` ^3.948.0 - S3 file storage (run.human, run.gpx)
- `@aws-sdk/s3-request-presigner` ^3.948.0 - Presigned URL generation
- `@aws-sdk/client-ses` ^3.948.0 - Email sending via SES (run.auth, run.cms)
- `@aws-sdk/client-sesv2` ^3.950.0 - SES v2 for transactional email

**UI/Frontend:**
- `@heroui/react` ^2.8.8 - Component library (run.human, run.auth)
- `framer-motion` ^12.23.26 - Animation library
- `lucide-react` ^0.561.0 - Icon set
- `react-icons` ^5.5.0 - Additional icons
- `next-themes` ^0.4.6 - Theme (dark/light) management
- `clsx` 2.1.1 - Conditional CSS class utility

**Mapping/GPS:**
- `leaflet` ^1.9.4 - Map rendering (run.human)
- `react-leaflet` ^5.0.0 - React bindings for Leaflet
- `leaflet-gpx` ^2.2.0 - GPX track overlay on maps
- `leaflet-polylinedecorator` ^1.6.0 - Polyline decorators
- `@mapbox/polyline` ^1.2.1 - Polyline encoding/decoding

**Content/Media:**
- `@strapi/blocks-react-renderer` ^1.0.2 - Render Strapi rich text in React
- `jimp` ^1.6.0 - Image processing (Node.js)
- `pdf-lib` ^1.17.1 - PDF generation (QR code sheets)
- `qrcode` ^1.5.4 - QR code generation
- `intl-messageformat` ^10.7.18 - i18n message formatting

**CMS-Specific:**
- `@strapi/strapi` ^5.6.0 - Core CMS framework
- `@strapi/provider-upload-aws-s3` ^4.15.0 - S3 media upload provider
- `@strapi/provider-email-amazon-ses` ^5.6.0 - SES email provider
- `strapi-plugin-sso` ^1.0.8 - Single Sign-On plugin for OIDC
- `strapi-provider-email-aws-ses-v3` - Custom local SES v3 provider (`apps/run.cms/app/providers/`)
- `styled-components` ^6.1.19 - CSS-in-JS for Strapi admin

**Waffaw (WAF Testing):**
- `artillery` ^2.0.22 - Load testing framework
- `artillery-engine-playwright` ^1.27.0 - Real browser traffic generation
- `playwright` ^1.50.0 - Browser automation with real TLS fingerprints

**Infrastructure:**
- `nodemailer` ^7.0.11 - Email transport (uses SES as backend)
- `koa` ^3.1.1 - Embedded in oidc-provider for OIDC endpoint serving
- `nanoid` ^5.1.6 - Short ID generation (run.gpx)

**GPX Studio (Submodule):**
- SvelteKit - GPX editor frontend (built separately via `apps/run.gpx/build-frontend.sh`)
- Embedded as git submodule at `apps/run.gpx/gpx-studio/`

## Configuration

**TypeScript:**
- Config: `apps/run.*/webapp/tsconfig.json`
- Target: ES2017, strict mode enabled
- Module resolution: bundler
- Path aliases: `@auth`, `@components/*`, `@/*`, `@fonts`, `@site`, `@public/*`, `@header`, `@svgtypes`

**Build Config:**
- Next.js: `apps/run.*/webapp/next.config.ts` (inferred, standard Next.js)
- Tailwind: `@tailwindcss/postcss` ^4 in devDependencies
- ESLint: `eslint` ^9 with `eslint-config-next` 16.x

**Environment:**
- Local dev env: `env.local.sh` (gitignored), `env.sh` (committed), `env.sops.sh` (SOPS-encrypted)
- Docker Compose: `apps/docker-compose.yaml` for local development (DynamoDB Local, all services)
- SOPS: Used for encrypting secrets (`.secrets.sops.json` at terragrunt level)
- SSM Parameter Store: Runtime secrets injected into ECS tasks via `valueFrom`

**Infrastructure Config:**
- Site-wide: `infra/terraform/live/site/site.hcl` - All site config (DNS, services, regions, WAF, CloudFront)
- Per-service: `infra/terraform/live/site/services/{app}/service.hcl` - Container specs, DynamoDB tables, S3 buckets
- Modules: `infra/terraform/modules/{module}/v1.0.0/` - Versioned Terraform modules

## Platform Requirements

**Development:**
- Node.js 22+ (current LTS)
- npm 6+
- Docker + Docker Buildx (for container builds)
- AWS CLI + credentials (for S3 asset sync, SSM parameter reads)
- Go 1.22 (for configui only)
- Terragrunt 0.97 + Terraform 1.14 (for infrastructure)
- SOPS (for secrets decryption)

**Production:**
- AWS ECS Fargate - Container orchestration
- Docker images: `linux/amd64`
- Node.js (current-alpine) - Runtime for Next.js apps
- Node.js 22-alpine - Runtime for Strapi CMS
- nginx - Reverse proxy sidecar (run.human, run.auth, run.cms)
- supervisord - Process management (CMS master/worker modes)

**Container Architecture:**
- run.auth: nginx sidecar + Next.js app (512 CPU / 1024 MB)
- run.human: nginx sidecar + Next.js app (512 CPU / 1024 MB)
- run.cms-master: nginx sidecar + Strapi + Litestream (512 CPU / 1024 MB)
- run.cms-worker: nginx sidecar + Strapi + Litestream (512 CPU / 1024 MB)
- run.gpx: Single container, no nginx (256 CPU / 512 MB)

**Multi-Region:**
- Primary: `us-east-1` (use1)
- Secondary: `ca-central-1` (cac1)
- Tertiary: `ap-southeast-1` (apse1) - currently in skip_regions

---

*Stack analysis: 2026-02-28*
