# Architecture

Details on the defcon.run 34 multi-region AWS architecture.

## Multi-Region Deployment Pattern

- **CloudFront** routes requests to regional ALBs via path prefix (`/use1/*`, `/cac1/*`)
- Each region runs identical ECS Fargate tasks with region-specific environment variables
- Next.js apps use dynamic `basePath` based on region label (e.g., `/use1`, `/cac1`)
- Static assets are synced to S3 per-region and served via CloudFront

## Container Architecture

Each app deploys two containers per ECS task:
1. **nginx** - TLS termination, reverse proxy to Next.js app
2. **webapp** - Next.js server (`node server.js`)

## Service Configuration

Services are defined in `infra/terraform/live/site/services/{service-name}/service.hcl`:
- ECR repository definitions
- ECS task definitions (containers, CPU/memory, env vars, secrets)
- DynamoDB table definitions with optional multi-region replication
- Load balancer configuration
- Service-specific S3 buckets and Lambda processors

### Template Variables

Used in service.hcl files:
- `{{REGION}}` - Full AWS region (e.g., `us-east-1`)
- `{{REGION_LABEL}}` - Short region label (e.g., `use1`)
- `{{SITE_LABEL}}` - Site prefix (e.g., `dc34`)

## Secrets Management

Secrets are stored in SSM Parameter Store and referenced in service.hcl via `secrets` array. Secret values come from `.secrets.sops.json` (SOPS-encrypted) or `.secrets.json` (plaintext, not recommended).

Path pattern: `/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/{provider}/{key}`

## AWS Profiles

Scripts expect these AWS CLI profiles:
- `application` - For ECR push, S3 sync, ECS operations
- `terraform` - For infrastructure changes (via Terragrunt)
