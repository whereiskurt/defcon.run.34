# Technology Stack

**Analysis Date:** 2026-02-28

## Languages

**Primary:**
- TypeScript 5.x - All Next.js apps, Strapi CMS, Lambda functions
- JavaScript (ES2020+) - Node.js runtime
- HCL 1.6+ - Terraform infrastructure-as-code
- Shell (bash/zsh) - Build and deployment scripts

**Secondary:**
- SQL - SQLite for Strapi CMS (local), DynamoDB for primary data
- CSS - Tailwind CSS 4.x for styling

## Runtime

**Environment:**
- Node.js 18.x - 22.x (per `package.json` engines in run.cms)
- Docker containerization for multi-region deployment
- AWS Lambda (via Terraform modules)
- AWS ECS Fargate 1.4 (latest)

**Package Manager:**
- npm (monorepo workspace-style, per-app installations)
- Lockfiles: `package-lock.json` (present in each app)

## Frameworks

**Frontend:**
- Next.js 16.1.x - run.human, run.auth, run.gpx apps
  - App Router (new pages structure)
  - SSR/SSG hybrid rendering
  - File-based routing with dynamic segments `[id]`
- React 19.x - Core UI library for all Next.js apps
- HeroUI 2.8.x - Component library (Tailwind-based)
- Framer Motion 12.x - Animation library

**Backend:**
- Next.js API Routes - `src/app/api/**/route.ts` pattern
- Strapi 5.6.0 - Headless CMS for run.cms (cms.defcon.run)
- oidc-provider 9.6.0 - OIDC provider implementation in run.auth
- Koa 3.1.1 - Web server framework (used in run.human)

**Real-Browser Load Testing:**
- Artillery 2.0.22 - Load testing framework
- Artillery Engine Playwright 1.27.0 - Real browser simulation
- Playwright 1.50.0 - Browser automation

**Testing:**
- Playwright Test 1.48.0 - E2E testing framework (run.auth/e2e)
- Located: `apps/run.auth/e2e/` with test files in `setup/` and `tests/`

**Build/Dev Tools:**
- Tailwind CSS 4.x - Utility-first CSS framework
- ESLint 9.x - Linting configuration (eslint-config-next)
- Vite or Next.js build - Primary bundler (Next.js)
- TypeScript 5.x - Type checking

## Key Dependencies

**Critical AWS SDK Integration:**
- `@aws-sdk/client-dynamodb` 3.x - DynamoDB client for all apps
- `@aws-sdk/lib-dynamodb` 3.x - High-level DynamoDB document interface
- `@aws-sdk/client-s3` 3.x - S3 storage access (uploads, media)
- `@aws-sdk/client-sesv2` 3.x - SES v2 email service (run.auth, run.human)
- `@aws-sdk/client-ses` 3.x - SES email service (run.cms)
- `@aws-sdk/s3-request-presigner` 3.x - S3 presigned URLs for secure uploads
- `@aws-sdk/client-ssm` 3.679.0 - Parameter Store access (waffaw)

**Authentication & Sessions:**
- `next-auth` 5.0.0-beta.30 - Auth session management (all Next.js apps)
- `@auth/core` - Core NextAuth functionality
- `@auth/dynamodb-adapter` 2.11.x - DynamoDB session/user adapter for NextAuth
- `next-auth/providers/discord` - Discord OAuth provider
- `next-auth/providers/github` - GitHub OAuth provider
- `next-auth/providers/strava` - Strava OAuth provider (activity tracking)

**Data Modeling:**
- `electrodb` 3.5.0+ - ElectroDB query builder for DynamoDB (all apps)
  - Provides SQL-like interface to DynamoDB
  - Used for custom entities: auth-profile, run-user, gpx-file, gpx-share, gpx-folder
- `altcha-lib` 1.4.1 - CAPTCHA library (run.auth, waffaw)

**Maps & Location:**
- `leaflet` 1.9.4 - Interactive mapping library
- `react-leaflet` 5.0.0 - React bindings for Leaflet
- `leaflet-gpx` 2.2.0 - GPX track rendering
- `leaflet-polylinedecorator` 1.6.0 - Decorative polylines
- `leaflet-defaulticon-compatibility` 0.1.2 - Icon handling
- `@mapbox/polyline` 1.2.1 - Polyline encoding/decoding

**Utilities:**
- `lucide-react` 0.56+ - Icon library
- `react-icons` 5.5.0 - Additional icons (GitHub, Discord, etc.)
- `jimp` 1.6.0 - Image manipulation (profile photos)
- `pdf-lib` 1.17.1 - PDF generation (certificates, exports)
- `qrcode` 1.5.4 - QR code generation
- `uuid` 10.x+ - UUID generation
- `nanoid` 5.1.6 - Tiny unique string IDs
- `clsx` 2.1.1 - Conditional className builder
- `intl-messageformat` 10.x+ - i18n message formatting
- `nodemailer` 7.0.x - Email sending library (run.auth uses with SES transport)
- `better-sqlite3` 11.6.0 - SQLite driver (run.cms)
- `framer-motion` 12.x - Animation framework

**Strapi CMS Specific:**
- `@strapi/strapi` 5.6.0 - CMS core
- `@strapi/plugin-users-permissions` 5.6.0 - User/role management
- `@strapi/plugin-cloud` 5.6.0 - Strapi Cloud integration
- `@strapi/provider-email-amazon-ses` 5.6.0 - SES email provider
- `@strapi/provider-upload-aws-s3` 4.15.0 - S3 media uploads
- `strapi-plugin-sso` 1.0.8 - OIDC/SSO integration
- `strapi-provider-email-aws-ses-v3` (local) - Custom SES v3 provider
- `@strapi/blocks-react-renderer` 1.0.2 - Rich content rendering
- `react-router-dom` 6.30.2 - Strapi admin routing
- `styled-components` 6.1.19 - CSS-in-JS for Strapi admin

## Configuration

**Environment:**
- Environment variables via `.env.local` and process.env
- AWS credentials via IAM roles (Fargate), local profiles (dev), or `.env` files
- Region-aware configuration: `REGION_SHORT` (use1, cac1, apse1)
- Site domain: `SITE_DOMAIN` (default: defcon.run)

**Build & Deployment Configuration Files:**
- `tsconfig.json` - TypeScript configuration (strict mode)
- `.eslintrc` - ESLint rules for code quality
- `next.config.js` - Next.js build/runtime config
- `tailwind.config.js` - Tailwind CSS theme configuration
- `jest.config.js` or `vitest.config.ts` - Test runner config (if present)

**Docker:**
- `Dockerfile.webapp.dev` - Development container for Next.js apps
- `Dockerfile.app` and `Dockerfile.nginx` - Production containers
- Multi-container architecture: Node.js app + nginx reverse proxy
- Image push to AWS ECR per region

**Terraform/Infrastructure:**
- `terraform.tfvars` - Terraform variables (via env.sh)
- `infra/terraform/providers/*.hcl` - AWS provider configuration
- `infra/terraform/modules/*/v1.0.0/*.tf` - Module definitions
- Terragrunt 0.97 - IaC wrapper for remote state, parallelization

## Platform Requirements

**Development:**
- Node.js 18+ (check with `node --version`)
- Docker & Docker Compose
- AWS CLI v2 with configured profiles (application, management, terraform)
- Terraform 1.14+ and Terragrunt 0.97+
- .env file with AWS credentials (S3, DynamoDB, SES)
- Local DynamoDB for local development (via docker-compose)

**Production:**
- AWS Account(s):
  - Application account (runs services)
  - Management account (DNS delegation)
  - Terraform account (state files)
- AWS Regions: us-east-1 (primary), ca-central-1 (Canada), ap-southeast-1 (Singapore)
- CloudFront global distribution
- DynamoDB Global Tables (multi-region replication)
- S3 Cross-Region Replication (CRR)
- ECS Fargate clusters per region
- Litestream for SQLite replication (run.cms database)

---

*Stack analysis: 2026-02-28*
