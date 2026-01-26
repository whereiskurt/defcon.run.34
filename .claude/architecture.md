# Architecture

Details on the defcon.run 34 multi-region AWS architecture.

## Multi-Region Deployment Pattern

- **CloudFront** routes requests to regional ALBs via path prefix (`/use1/*`, `/cac1/*`)
- Each region runs identical ECS Fargate tasks with region-specific environment variables
- Apps use dynamic `basePath` based on region label (e.g., `/use1`, `/cac1`)
- Static assets are synced to S3 per-region and served via CloudFront

## CloudFront + WAF Request Flow

Each application has its own CloudFront distribution with a dedicated WAF WebACL:

```
                           Internet
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CloudFront Distribution                              │
│                     (per app: auth, cms, run-human)                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      WAF WebACL (per app)                             │  │
│  │  - Rate limiting rules                                                │  │
│  │  - AWS Managed Rules (Common, Known Bad Inputs, etc.)                 │  │
│  │  - App-specific rules (auth has stricter login protection, etc.)      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                              │                                              │
│                        ALLOW │ BLOCK → 403                                  │
│                              ▼                                              │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │                    Origin Router (path-based)                      │     │
│  │  /use1/* → us-east-1 ALB     /cac1/* → ca-central-1 ALB            │     │
│  │  /_next/static/* → S3        /cms/* → S3 (media assets)            │     │
│  └────────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
              CloudFront-only (prefix list)
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Regional ALB (us-east-1 / ca-central-1)                  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Security Group: Ingress ONLY from CloudFront prefix list             │  │
│  │  - com.amazonaws.global.cloudfront.origin-facing                      │  │
│  │  - Blocks direct ALB access from internet                             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                              │                                              │
│                              ▼                                              │
│                      ECS Fargate Tasks                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Per-app WAF WebACLs:**

| App | WebACL | Special Rules |
|-----|--------|---------------|
| **auth.defcon.run** | auth-webacl | Stricter rate limits on `/api/oidc/*`, login brute-force protection |
| **cms.defcon.run** | cms-webacl | Admin panel protection, upload size limits |
| **run.defcon.run** | run-human-webacl | Standard protection, API rate limiting |
| **gpx.defcon.run** | gpx-webacl | Standard protection, file upload limits |

**Security layers:**

1. **WAF WebACL** - First line of defense, blocks malicious requests before reaching origin
2. **CloudFront prefix list** - ALB security groups only allow traffic from CloudFront IPs
3. **ALB listener rules** - Route to correct target group based on path/host
4. **nginx TLS** - End-to-end encryption to container

## Container Architectures

The project uses three container patterns depending on application requirements:

### Next.js Apps (run.auth, run.human)

Simple two-container architecture for stateless Next.js applications:

```
┌─────────────────────────────────────────────┐
│              ECS Task                       │
│  ┌─────────────┐      ┌──────────────────┐  │
│  │    nginx    │─────▶│     webapp       │  │
│  │  (TLS/proxy)│      │ (node server.js) │  │
│  │    :443     │      │      :3000       │  │
│  └─────────────┘      └──────────────────┘  │
└─────────────────────────────────────────────┘
```

- **nginx** - TLS termination, reverse proxy
- **webapp** - Next.js server (`node server.js`)

### GPX Editor (run.gpx) - Next.js + Embedded SvelteKit

Single-container architecture for the GPX route editor. TLS termination happens at the ALB.

```
┌─────────────────────────────────────────────┐
│              ECS Task                       │
│  ┌──────────────────────────────────────┐   │
│  │           run-gpx-app                │   │
│  │        (node server.js)              │   │
│  │            :3000                     │   │
│  │  ┌────────────────────────────────┐  │   │
│  │  │  Next.js (auth, API routes)    │  │   │
│  │  │  - /api/auth/* (Auth.js)       │  │   │
│  │  │  - /api/gpx/* (file CRUD)      │  │   │
│  │  │  - /api/user/* (mapbox token)  │  │   │
│  │  ├────────────────────────────────┤  │   │
│  │  │  /studio/* (gpx-studio static) │  │   │
│  │  │  - SvelteKit prebuilt app      │  │   │
│  │  └────────────────────────────────┘  │   │
│  └──────────────────────────────────────┘   │
│                    │                        │
│           ┌───────┴───────┐                 │
│           ▼               ▼                 │
│       DynamoDB           S3                 │
│    (file metadata)   (GPX files)            │
└─────────────────────────────────────────────┘
```

**Key components:**

- **Next.js** - Auth, API routes, and file management
- **gpx-studio** - SvelteKit-based GPX editor (built at deploy time via `build-frontend.sh`)
- **DynamoDB** - File/folder metadata via ElectroDB (multi-region replicated)
- **S3** - GPX file storage with presigned URLs
- **Mapbox** - Map rendering (token from run-auth user profile)

**Authentication flow:**
1. User visits `/gpx` → Next.js checks session
2. If authenticated and has `gpxstudio` service access → redirect to `/studio/app`
3. gpx-studio fetches session from `/api/auth/session`
4. File operations use `/api/gpx/*` endpoints with S3 presigned URLs

**Why no nginx?**
- ALB terminates TLS (HTTPS → HTTP)
- Simpler deployment for this internal-facing tool
- Fewer containers to manage

### CMS (run.cms) - Master/Worker with Litestream

Stateful Strapi application using SQLite with master-worker replication:

```
┌─────────── us-east-1 (Master) ──────────────┐
│              ECS Task                       │
│  ┌─────────────┐      ┌──────────────────┐  │
│  │    nginx    │─────▶│   supervisord    │  │
│  │    :443     │      │  ┌────────────┐  │  │
│  └─────────────┘      │  │  strapi    │  │  │
│                       │  │   :1337    │  │  │
│                       │  ├────────────┤  │  │
│                       │  │ litestream │──┼──┼──▶ S3 (continuous)
│                       │  │ (replicate)│  │  │
│                       │  └────────────┘  │  │
│                       └──────────────────┘  │
└─────────────────────────────────────────────┘

┌─────── us-east-1 / ca-central-1 (Workers) ──┐
│              ECS Task                       │
│  ┌─────────────┐      ┌──────────────────┐  │
│  │    nginx    │─────▶│   supervisord    │  │
│  │    :443     │      │  ┌────────────┐  │  │
│  └─────────────┘      │  │  strapi    │  │  │
│                       │  │   :1337    │  │  │
│                       │  ├────────────┤  │  │
│   S3 ─────────────────┼──┤ litestream │  │  │
│   (periodic restore)  │  │   (sync)   │  │  │
│                       │  └────────────┘  │  │
│                       └──────────────────┘  │
└─────────────────────────────────────────────┘
```

**Key components:**

- **supervisord** - Process supervisor managing Strapi and Litestream together
- **Strapi** - Headless CMS serving content API on port 1337
- **Litestream** - SQLite replication to/from S3
- **SQLite** - Embedded database at `/data/strapi.db`

**Master (us-east-1 only):**
- Handles all write operations (admin panel, content updates)
- Runs `litestream replicate` continuously pushing WAL to S3
- Exposed via ALB for admin access

**Workers (both regions):**
- Read-only content API for Next.js apps
- Run `litestream-sync.sh` script:
  1. Initial restore from S3 on startup
  2. Periodic sync every 5 minutes (atomic swap)
- Accessed via ECS Service Discovery (internal only, no ALB)
- Auto-scales 1-3 instances based on CPU

**Data flow:**
1. Admin edits content via Master
2. Litestream continuously replicates SQLite WAL to S3 (1s interval)
3. Workers periodically restore from S3 (5 minute sync)
4. Next.js apps query local Worker via service discovery

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

## AWS Multi-Account Architecture

The infrastructure uses a multi-account pattern for separation of concerns:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     management account                              │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Route53 Hosted Zone: defcon.run                              │  │
│  │  - NS records delegate to application account hosted zones    │  │
│  │  - Owns the root domain registration                          │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                          NS delegation
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     application account                             │
│  ┌─────────────────────┐  ┌─────────────────────┐                   │
│  │   us-east-1 (use1)  │  │  ca-central-1 (cac1)│                   │
│  │  - ECS Fargate      │  │  - ECS Fargate      │                   │
│  │  - ALB              │  │  - ALB              │                   │
│  │  - ECR              │  │  - ECR              │                   │
│  │  - S3 buckets       │  │  - S3 buckets       │                   │
│  │  - SSM secrets      │  │  - SSM secrets      │                   │
│  │  - DynamoDB         │  │  - DynamoDB         │                   │
│  └─────────────────────┘  └─────────────────────┘                   │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Global: CloudFront, WAF, ACM (us-east-1), Route53 subzones   │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      terraform account                              │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Terraform State Storage                                      │  │
│  │  - S3 bucket for .tfstate files                               │  │
│  │  - DynamoDB table for state locking                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**Account responsibilities:**

| Account | Purpose |
|---------|---------|
| **management** | Owns `defcon.run` domain, delegates subzones via NS records |
| **application** | All runtime resources (ECS, ALB, S3, DynamoDB, CloudFront) |
| **terraform** | Terraform state bucket and DynamoDB lock table |

### AWS CLI Profiles

Scripts expect these named profiles in `~/.aws/config`:

| Profile | Account | Used for |
|---------|---------|----------|
| `management` | management | Route53 zone delegation (rarely needed) |
| `application` | application | ECR push, S3 sync, ECS operations, deployments |
| `terraform` | terraform | Terragrunt/Terraform state access |

**Single-account option:** All three profiles can point to the same AWS account if separation isn't needed. The profile names are conventions used by scripts, not hard requirements for distinct accounts.

## CI/CD Pipeline

### GitHub Actions Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `terragrunt-plan.yml` | PRs with `infra/**` changes | Preview infrastructure changes |
| `terragrunt-apply.yml` | Merge to main with `infra/**` changes | Deploy infrastructure (requires approval) |
| `e2e-tests.yml` | Manual / workflow_dispatch | End-to-end testing |
| `gitleaks-scan.yml` | Push | Secret detection |
| `checkov-scan.yml` | Push | Infrastructure security scanning |

### Infrastructure Deployment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  PR with infra/ changes                                         │
│  ↓                                                              │
│  Terragrunt Plan (auto) ──→ Plan output in PR comment           │
│  ↓                                                              │
│  Merge to main                                                  │
│  ↓                                                              │
│  Terragrunt Apply (triggered) ──→ Waits for approval            │
│  ↓                                                              │
│  Approve in GitHub (terraform-apply environment)                │
│  ↓                                                              │
│  terragrunt run apply --all                                     │
└─────────────────────────────────────────────────────────────────┘
```

**Environment Protection:**

The `terraform-apply` GitHub environment requires manual approval before `terragrunt apply` runs. Configure required reviewers at:
`Settings → Environments → terraform-apply → Environment protection rules`

### Release Automation

The `release-all.sh` script automates the full release cycle:

```bash
./apps/release-all.sh --pr    # Recommended: full release with PR
```

**What happens:**

1. Creates release branch (`release/YYYY-MM-DD-HHMMSS`)
2. Bumps VERSION files for all apps (nginx + webapp)
3. Copies VERSION files to terraform service directories
4. Commits all VERSION files in single commit
5. Pushes branch and creates PR with version summary
6. Builds Docker images for all apps/regions
7. Pushes images to ECR
8. Auto-merges PR (squash merge, deletes branch)
9. If `infra/` changed, triggers `terragrunt-apply` workflow
10. User approves in GitHub Actions → infrastructure deploys

**VERSION File Locations:**

| Type | Path |
|------|------|
| App VERSION | `apps/{app}/webapp/VERSION` or `apps/{app}/app/VERSION` |
| Nginx VERSION | `apps/{app}/nginx/VERSION` |
| Terraform VERSION | `infra/terraform/live/site/services/{service}/VERSION.app` |
| Terraform Nginx | `infra/terraform/live/site/services/{service}/VERSION.nginx` |

### IAM Roles for GitHub Actions

| Role | Purpose |
|------|---------|
| `dc34-github-readonly` | Terragrunt plan (read-only AWS access) |
| `dc34-github-terragrunt` | Terragrunt apply (full AWS access) |
| `dc34-github-e2e` | E2E tests (S3 email bucket access) |

These roles use OIDC federation - no long-lived credentials stored in GitHub.
