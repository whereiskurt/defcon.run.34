# Architecture

Multi-region AWS architecture for defcon.run 34 — an official DEF CON 34 event (2026).

## System Overview

| Component | Domain | Stack | Purpose |
|-----------|--------|-------|---------|
| **run.auth** | auth.defcon.run | Next.js 16, Auth.js v5, oidc-provider v9 | Central identity provider |
| **run.human** | run.defcon.run | Next.js 16, React 19, HeroUI, Tailwind 4 | Main application |
| **run.gpx** | gpx.defcon.run | Next.js + vendored gpx-studio (SvelteKit) | GPX route editor |
| **run.cms** | cms.defcon.run | Strapi 5.6, SQLite, Litestream | Content management |
| **configui** | localhost only | Go binary | Infrastructure config UI |
| **waffaw** | — | Artillery, Playwright, bash agent | WAF testing platform (~70% built) |

**Regions:** us-east-1 (primary), ca-central-1, ap-southeast-1

**Path:** All traffic flows through CloudFront + WAF → regional ALBs → ECS Fargate tasks.

## Authentication Architecture

run.auth is the central identity provider running dual Auth.js v5 (session management) + oidc-provider v9 (OIDC server).

**Auth Methods:**

| Method | Purpose | Notes |
|--------|---------|-------|
| Email OTP | Primary login | Via SES, ALTCHA proof-of-work captcha |
| Discord OAuth | Social login | |
| GitHub OAuth | Social login | |
| Strava OAuth | Account linking only | Not a login method |

**OIDC Configuration:**

| Setting | Value |
|---------|-------|
| Clients | run.human, run.gpx (gpx.studio), run.cms (cms.strapi) |
| PKCE | Required |
| Grants | authorization_code, refresh_token |
| Access token TTL | 1 hour |
| Refresh token TTL | 14 days |
| Auth code TTL | 10 minutes |
| Session | JWT in httpOnly cookie, 15-day TTL, 24h auto-refresh |
| Scopes | openid, profile, email, services |
| Claims delivery | ID token (conformIdTokenClaims: false) |

The `services` scope provides `linked_providers` and `mapboxPublicToken` in claims.

**Known gaps:**
- No rate limiting on any auth endpoints
- `sessionVersion` field exists but is not yet enforced in JWT validation
- `allowDangerousEmailAccountLinking=true` is enabled

## Service Architecture

### run.human (run.defcon.run)

Next.js 16 + React 19 + HeroUI + Tailwind 4. Features: user profiles, Meshtastic radio management, GPS check-ins, file uploads, quota display.

- **Data:** DynamoDB via ElectroDB (RunUser, UserUpload entities)
- **Quota:** Centralized in run.auth, consumed via HTTP client with `X-Internal-Secret` header
- **Uploads:** S3 presigned URLs (GPX 5MB, photos 20MB)
- **Config:** `apps/run.human/`, service def at `infra/terraform/live/site/services/run.human/`

### run.gpx (gpx.defcon.run)

Next.js wrapping a vendored gpx-studio (SvelteKit, built from source).

- **Build:** 3-stage Docker (gpx-builder -> webapp-builder -> runner)
- **Cloud save:** S3 + DynamoDB, 50-version history, folder organization
- **Sharing:** Public/private with email allowlist, 21-char nanoid share tokens
- **GPX validation:** Binary magic byte detection, control char rejection, XML structure check
- **Auth flow:** Next.js checks session -> redirect to `/studio/app` -> gpx-studio reads `/api/auth/session`
- **Config:** `apps/run.gpx/`, build script `apps/run.gpx/build-frontend.sh`

### run.cms (cms.defcon.run)

Strapi 5.6 + SQLite + Litestream replication. Master/Worker architecture.

- **Master** (us-east-1 only): Handles writes, runs `litestream replicate` continuously to S3
- **Workers** (all regions): Read-only, restore from S3 every 5 minutes via `litestream-sync.sh`
- **Auth:** OIDC SSO via strapi-plugin-sso with service claim validation
- **Middleware:** cookie-auth (JWT from httpOnly cookie), services-validation (re-validates cms service)
- **Nginx:** TLS termination, regional prefix stripping, admin registration blocking
- **Process:** supervisord manages Strapi + Litestream together
- **Config:** `apps/run.cms/`, service def at `infra/terraform/live/site/services/run.cms/`

## Multi-Region Routing

```
                        Internet
                           |
                    CloudFront Distribution (per domain)
                     |-- WAF WebACL
                     |-- Origin router (path-based)
                           |
              /use1/* -> us-east-1 ALB
              /cac1/* -> ca-central-1 ALB
              /apse1/* -> ap-southeast-1 ALB
              /_next/static/* -> S3
                           |
                    Regional ALB
                     (CloudFront-only ingress via prefix list)
                           |
                    ECS Fargate Tasks
```

- **Path routing:** CloudFront routes `/{region_label}/*` to the corresponding regional ALB
- **basePath:** Next.js `basePath` set to `/{region}` at Docker build time
- **Region preference:** `preferred-region` cookie, `index.html` region router at domain root
- **Service discovery:** Cloud Map namespace per region (`app-{region}-{site}.local`)

## Container Patterns

### Next.js Apps (run.auth, run.human)

Two-container ECS task: nginx (:443, TLS/proxy) -> webapp (:3000, `node server.js`).

### GPX Editor (run.gpx)

Single-container ECS task: webapp (:3000) serves both Next.js routes and gpx-studio static assets. ALB terminates TLS.

### CMS (run.cms)

Two-container ECS task: nginx (:443) -> supervisord (Strapi :1337 + Litestream). Master runs `litestream replicate`; workers run periodic `litestream-sync.sh` restore.

## Infrastructure

### Stack

Terraform 1.14 + Terragrunt 0.97. 20 modules in `infra/terraform/modules/`.

### Modules

| Module | Purpose |
|--------|---------|
| certs | ACM certificates |
| cloudfront | CloudFront distributions |
| cloudfront-assets | S3 + CloudFront for static assets |
| cloudtrail | CloudTrail audit logging |
| dynamodb | DynamoDB tables + Global Tables v2 |
| ec2spot | EC2 Spot instances (waffaw fleet) |
| ecr | Elastic Container Registry |
| ecs-cluster | ECS Fargate clusters |
| ecs-service | ECS service definitions |
| ecs-task | ECS task definitions |
| email | SES email configuration |
| email-s3-replication | Cross-region email bucket replication |
| github-oidc | GitHub Actions OIDC federation |
| network | VPC (10.0.0.0/16, 2 AZs, public/private subnets, NAT) |
| s3-uploads | S3 upload buckets |
| s3-uploads-processor | Lambda upload processors |
| s3-uploads-replication | Cross-region upload replication |
| secrets | SSM Parameter Store secrets |
| site | Top-level site orchestration |
| waffaw | WAF testing infrastructure |

### ECS Services (5 total)

| Service | Regions | Notes |
|---------|---------|-------|
| auth | us-east-1, ca-central-1 | Central identity provider |
| human | us-east-1, ca-central-1 | Main application |
| cms-master | us-east-1 only | Strapi write node |
| cms-worker | us-east-1, ca-central-1 | Strapi read replicas |
| gpx | us-east-1, ca-central-1 | GPX editor |

### Service Configuration

Services defined in `infra/terraform/live/site/services/{service-name}/service.hcl`. Template variables:
- `{{REGION}}` — Full AWS region (e.g., `us-east-1`)
- `{{REGION_LABEL}}` — Short label (e.g., `use1`)
- `{{SITE_LABEL}}` — Site prefix (e.g., `dc34`)

### Secrets Management

SSM Parameter Store (not Secrets Manager), KMS-encrypted. Source: `.secrets.sops.json` (SOPS-encrypted).

Path pattern: `/{{SITE_LABEL}}/secrets/{{REGION_LABEL}}/{provider}/{key}`

## Security Model

| Layer | Mechanism |
|-------|-----------|
| Session validation | Every 5 min against auth server |
| Server-to-server | `X-Internal-Secret` header, internal service discovery URLs |
| Cookies | httpOnly, secure (prod), sameSite=lax |
| CSRF | Auth.js standard + custom verification on login endpoint |
| Uploads | Quota consumed before presign, GPX binary validation |
| WAF (auth) | Deny-by-default WebACL |
| WAF (others) | AWS Managed Rules (Common, Known Bad Inputs) |
| ALB ingress | CloudFront prefix list — blocks direct internet access |
| TLS | nginx terminates TLS within containers (except run.gpx) |

**Known gaps:** No rate limiting on auth endpoints. Session invalidation (`sessionVersion`) not enforced. `allowDangerousEmailAccountLinking=true`.

## AWS Account Architecture

```
management account
  Route53: defcon.run (root domain, NS delegation)
       |
application account
  us-east-1: ECS, ALB, ECR, S3, SSM, DynamoDB
  ca-central-1: ECS, ALB, ECR, S3, SSM, DynamoDB
  ap-southeast-1: ECS, ALB, ECR, S3, SSM, DynamoDB
  Global: CloudFront, WAF, ACM (us-east-1), Route53 subzones
       |
terraform account
  S3 state bucket + DynamoDB lock table
```

All three profiles can point to the same AWS account. The profile names (`management`, `application`, `terraform`) are conventions used by scripts.

## CI/CD

### GitHub Actions Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `terragrunt-plan.yml` | PRs with `infra/**` changes | Preview infrastructure changes |
| `terragrunt-apply.yml` | Merge to main with `infra/**` | Deploy infrastructure (requires approval) |
| `deploy.yml` | Manual | Deploy app to ECS |
| `rollback.yml` | Manual | Rollback ECS deployment |
| `e2e-tests.yml` | Manual | End-to-end auth tests |
| `gitleaks-scan.yml` | Push | Secret detection |
| `checkov-scan.yml` | Push | Infrastructure security scanning |
| `prowler-scan.yml` | Scheduled/manual | AWS security posture |
| `npm-audit.yml` | Scheduled/manual | Dependency vulnerability scanning |
| `ec2-runner.yml` | Called by other workflows | Self-hosted EC2 runner management |
| `buildpub.yml` | Manual | Build public assets |

### IAM Roles (OIDC Federation)

7 roles, no long-lived credentials: `terragrunt`, `application`, `readonly`, `prowler`, `e2e`, `release`, `deploy`.

### Release Flow

`./apps/release-all.sh --pr` automates: create release branch -> bump VERSION files -> build/push Docker images to ECR -> create/merge PR -> trigger terragrunt-apply if infra changed.

VERSION files live at `apps/{app}/webapp/VERSION` (or `app/VERSION` for CMS) and are copied to `infra/terraform/live/site/services/{service}/VERSION.app`.

## Operational Tools

### ConfigUI (`apps/configui/`)

Go binary, binds to 127.0.0.1 only. Embeds all templates/JS/CSS. Features: HCL generation from web form, terragrunt execution with SSE streaming, SOPS secret editing, service discovery dots, output explorer.

### Waffaw (`apps/waffaw/`)

WAF testing platform (~70% implemented). S3 control plane, Artillery + Playwright for real browser TLS fingerprints, EC2 Spot + ECS Fargate Spot fleet, bash agent with roll-call consensus protocol. Integrates into ConfigUI's Apps section. See `apps/waffaw/DESIGN.md`.
