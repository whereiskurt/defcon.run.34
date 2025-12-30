<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DEF CON 34 (2026) monorepo containing AWS multi-region infrastructure (Terragrunt/Terraform) and Next.js web applications. The project deploys to two AWS regions: `us-east-1` (use1) and `ca-central-1` (cac1) with CloudFront distribution in front.

## Repository Structure

```
apps/                           # Application code
├── run.auth/                   # Auth service (auth.defcon.run)
│   ├── nginx/                  # Nginx reverse proxy container
│   └── webapp/                 # Next.js app with OIDC provider
├── run.human/                  # Main app (run.defcon.run)
│   ├── nginx/                  # Nginx reverse proxy container
│   └── webapp/                 # Next.js app
├── build.sh                    # Build and push Docker image to ECR
├── deploy.sh                   # Deploy to ECS via Terragrunt
├── release.sh                  # Full release: version bump + build + deploy
├── release-all.sh              # Multi-region parallel release
└── version.sh                  # Bump patch version in VERSION file

infra/terraform/
├── live/site/                  # Terragrunt live configuration
│   ├── site.hcl                # Main site configuration
│   ├── services/auth/          # Auth service definition
│   ├── services/run-human/     # Run-human service definition
│   └── region/{us-east-1,ca-central-1}/  # Regional resources
├── modules/                    # Terraform modules (versioned)
└── providers/                  # Provider configurations
```

## Common Commands

### Application Development

```bash
# Run webapp in development mode (from apps/run.auth/webapp or apps/run.human/webapp)
npm run dev
npm run build
npm run lint

# Build Docker image and push to ECR
./apps/build.sh nginx run.auth     # or run.human
./apps/build.sh webapp run.auth    # or run.human

# Bump version (modifies VERSION file)
./apps/version.sh nginx run.auth
./apps/version.sh webapp run.auth

# Full release for single app (single region)
./apps/release.sh run.auth

# Multi-region release (both apps, both regions)
./apps/release-all.sh
./apps/release-all.sh --apps run.auth --regions use1
./apps/release-all.sh --parallel                       # Faster parallel builds
./apps/release-all.sh --skip-bump --skip-build         # Deploy only
```

### Infrastructure

```bash
# From infra/terraform/live/site/
terragrunt run-all plan
terragrunt run-all apply --terragrunt-non-interactive -auto-approve

# Single module
cd infra/terraform/live/site/region/us-east-1/ecs-service
terragrunt plan
terragrunt apply
```

## Architecture

### Multi-Region Deployment Pattern

- **CloudFront** routes requests to regional ALBs via path prefix (`/use1/*`, `/cac1/*`)
- Each region runs identical ECS Fargate tasks with region-specific environment variables
- Next.js apps use dynamic `basePath` based on region label (e.g., `/use1`, `/cac1`)
- Static assets are synced to S3 per-region and served via CloudFront

### Container Architecture

Each app deploys two containers per ECS task:
1. **nginx** - TLS termination, reverse proxy to Next.js app
2. **webapp** - Next.js server (`node server.js`)

### Service Configuration

Services are defined in `infra/terraform/live/site/services/{service-name}/service.hcl`:
- ECR repository definitions
- ECS task definitions (containers, CPU/memory, env vars, secrets)
- DynamoDB table definitions with optional multi-region replication
- Load balancer configuration
- Service-specific S3 buckets and Lambda processors

Template variables in service.hcl:
- `{{REGION}}` - Full AWS region (e.g., `us-east-1`)
- `{{REGION_LABEL}}` - Short region label (e.g., `use1`)
- `{{SITE_LABEL}}` - Site prefix (e.g., `dc34`)

### Secrets Management

Secrets are stored in SSM Parameter Store and referenced in service.hcl via `secrets` array. Secret values come from `.secrets.sops.json` (SOPS-encrypted) or `.secrets.json` (plaintext, not recommended).

Path pattern: `/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/{provider}/{key}`

## Key Technologies

- **Frontend**: Next.js 16, React 19, HeroUI, Tailwind CSS 4
- **Auth**: NextAuth.js (Auth.js), OIDC provider (oidc-provider)
- **Database**: DynamoDB with ElectroDB entity framework
- **Infrastructure**: Terraform modules, Terragrunt for orchestration
- **Container**: Docker, AWS ECR, ECS Fargate
- **CDN**: CloudFront with WAF

## AWS Profiles

Scripts expect these AWS CLI profiles:
- `application` - For ECR push, S3 sync, ECS operations
- `terraform` - For infrastructure changes (via Terragrunt)

