# Project Context

## Purpose
defcon.run 34 (2026) event infrastructure monorepo. This project provides the web applications and AWS infrastructure for the defcon.run running/fitness community at DEF CON, enabling event registration, authentication, activity tracking, and participant management across multiple AWS regions.

**Goals:**
- Multi-region high availability (US East + Canada Central)
- Secure authentication with multiple OAuth providers
- Real-time activity tracking with GPS/route visualization
- Containerized deployment on AWS ECS Fargate

## Tech Stack

### Frontend
- **Framework**: Next.js 16 with App Router
- **React**: React 19
- **UI Components**: HeroUI (formerly NextUI)
- **Styling**: Tailwind CSS 4
- **Maps**: Leaflet with react-leaflet
- **Icons**: Lucide React

### Backend / Auth
- **Authentication**: NextAuth.js v5 (Auth.js) with DynamoDB adapter
- **OIDC Provider**: oidc-provider (custom OIDC server)
- **Database**: DynamoDB with ElectroDB entity framework
- **Email**: AWS SES for transactional emails
- **CAPTCHA**: Altcha (proof-of-work CAPTCHA)

### Infrastructure
- **IaC**: Terraform modules with Terragrunt orchestration
- **Container Runtime**: AWS ECS Fargate
- **Container Registry**: AWS ECR (multi-region)
- **CDN/Edge**: CloudFront with WAF
- **Secrets**: AWS SSM Parameter Store with SOPS encryption
- **Regions**: us-east-1 (use1), ca-central-1 (cac1)

### Development
- **Language**: TypeScript 5 (strict mode)
- **Linting**: ESLint 9 with eslint-config-next
- **Package Manager**: npm

## Project Conventions

### Code Style
- **TypeScript**: Strict mode enabled, ES2017 target
- **ESLint**: Next.js recommended config with core web vitals
- **Path Aliases**: Use `@/` for `./src/`, `@components/` for components, `@auth`, `@fonts`, `@site` for config
- **File Naming**: kebab-case for files, PascalCase for React components
- **No semicolons enforcement**: Follow existing patterns in codebase

### Architecture Patterns
- **Multi-region routing**: CloudFront routes to regional ALBs via path prefix (`/use1/*`, `/cac1/*`)
- **Container sidecar pattern**: Each ECS task runs nginx (TLS termination) + webapp (Next.js)
- **Service configuration**: Defined in HCL files at `infra/terraform/live/site/services/{name}/service.hcl`
- **Template variables**: `{{REGION}}`, `{{REGION_LABEL}}`, `{{SITE_LABEL}}` in service configs
- **ElectroDB entities**: Use single-table design with `pk`/`sk` pattern

### Testing Strategy
- **Linting**: `npm run lint` in webapp directories
- **Security Scanning**: GitHub workflows for Gitleaks, npm audit, Checkov, Prowler
- **Infrastructure Validation**: `terraform validate` and `terragrunt hclfmt`
- **No unit test framework currently configured** - add if needed

### Git Workflow
- **Main branch**: `main`
- **Commit style**: Imperative mood, concise descriptions (e.g., "Fix Prowler muted findings count")
- **No enforced PR process** - direct commits to main acceptable
- **Pre-commit hooks**: Husky configured

## Domain Context

### Applications
- **run.auth** (auth.defcon.run): Central authentication service with OIDC provider
- **run.human** (run.defcon.run): Main participant-facing application

### Key Concepts
- **Region labels**: `use1` = us-east-1, `cac1` = ca-central-1
- **Site label**: `dc34` (defcon.run 34)
- **OAuth providers**: GitHub, Strava, Discord + email magic links
- **basePath**: Next.js apps use dynamic basePath per region (e.g., `/use1`, `/cac1`)

### Release Process
```bash
# Single app release
./apps/release.sh run.auth

# Multi-region parallel release
./apps/release-all.sh --parallel

# Deploy only (skip build)
./apps/release-all.sh --skip-bump --skip-build
```

## Important Constraints

### Security
- Secrets must be stored in SSM Parameter Store, never in code
- SOPS encryption required for `.secrets.sops.json` files
- No plaintext `.secrets.json` in production
- IAM roles use confused deputy protection

### Infrastructure
- ECS Fargate does not support tmpfs mounts (affects read-only root filesystem)
- DynamoDB global tables require stream_view_type = "NEW_AND_OLD_IMAGES"
- ECR images use immutable tags with lifecycle policy (max 10 images, 30 day expiration)

### AWS Profiles
Scripts require these named profiles:
- `application` - ECR push, S3 sync, ECS operations
- `terraform` - Infrastructure changes

### Environment Setup
Before running Terraform/Terragrunt commands, source the environment:
```bash
export SGUID=80a6b349
source ./env.sh
```
This sets `TG_BUCKET` and other variables needed for state management.

## External Dependencies

### AWS Services
- **ECS Fargate**: Container orchestration
- **ECR**: Container registry (multi-region)
- **CloudFront**: CDN with custom domain
- **WAF**: Web Application Firewall
- **DynamoDB**: Primary database with global tables
- **SES**: Email delivery
- **SSM Parameter Store**: Secrets management
- **CloudWatch**: Logging and monitoring

### OAuth Providers
- **GitHub**: Developer authentication
- **Strava**: Fitness activity integration
- **Discord**: Community authentication

### Domains
- `defcon.run` - Primary domain
- `auth.defcon.run` - Authentication service
- `run.defcon.run` - Main application (implied)
