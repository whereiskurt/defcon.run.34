# defcon.run.34
I hope this code will be useful for you and give your inspiration for what's possible with multi-regional webscale application deployments. This is ultimately a hobby project where we experiment with modern AWS cloud architecture, AI-assisted Claude Code workflows, and full-stack webapp tech - with the goal of building something fun and useful for our annual a 4-day running event at DEF CON in Las Vegas.

> "Multi-region AWS IaC: CloudFront + WAF + ALB → ECS Fargate (Next.js, Strapi, SvelteKit). DynamoDB global tables + Litestream SQLite replication. AI-assisted spec-driven development with parallel Claude instances. All Terraform+Terragrunt with modules."

# Infrastructure, Services and Apps
The main functional areas are `infrastructure`, `services` and `application`. 

Setting up a `service` is about mapping an application onto infrastructure. The `run.auth` service has both an nginx container and Node.js container - two different images compiled and released to ECR, referenced in a ECS taskdef being deployed into an ECS Cluster.

The `live/site` terragrunt structure contains instances of terraform `modules`. Each `region/` with a `region.hcl` defines the regional specific settings (eg. short names 'apse1'). Each region folder `ca-central-1/`, `ap-southeast-1/` is just a copy of the `us-east-1/` because our site deploys the same modules for all of the regions.

## Multi-region Architecture
This is the main application architecture:

```
                                     Internet
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                            CloudFront + WAF                                │
│     Per-app WebACLs: rate limiting, geo-blocking, brute-force protection   │
│     Path-based routing: /use1/* → Virginia, /apse1/* → Singapore           │
└────────────────────────────────────────────────────────────────────────────┘
                       │                                │
                       ▼                                ▼
         ┌─────────────────────────┐      ┌─────────────────────────┐
         │       us-east-1         │      │     ap-southeast-1      │
         │       (Virginia)        │      │       (Singapore)       │
         │    ┌─────────────┐      │      │    ┌─────────────┐      │
         │    │     ALB     │      │      │    │     ALB     │      │
         │    └──────┬──────┘      │      │    └──────┬──────┘      │
         │           │             │      │           │             │
         │    ┌──────▼──────┐      │      │    ┌──────▼──────┐      │
         │    │  ECS Tasks  │      │      │    │  ECS Tasks  │      │
         │    │  (Fargate)  │      │      │    │  (Fargate)  │      │
         │    └───┬─────┬───┘      │      │    └───┬─────┬───┘      │
         │        │     │          │      │        │     │          │
         │   ┌────▼──┐ ┌▼────────┐ │      │   ┌────▼──┐ ┌▼────────┐ │
         │   │  S3   │ │DynamoDB │ │      │   │  S3   │ │DynamoDB │ │
         │   │       │ │(Global) │ │      │   │       │ │(Global) │ │
         │   └───────┘ └────┬────┘ │      │   └───────┘ └────┬────┘ │
         │        ▲         │      │      │        ▲         │      │
         └────────┼─────────┼──────┘      └────────┼─────────┼──────┘
                  │         │                      │         │
                  └─────────┼──── S3 CRR ──────────┘         │
                            │                                │
                            └──── DynamoDB Global Tables ────┘
```

# AWS Mulit-region Deployments
This AWS infrastructure code is multi-regional and re-usable across projects/domains. AWS Multi-regional deployments are complicated and have lots of little 'gotchas'. This code base shows how-to major services with Cloudfront, SES, S3, DynamoDB.

The `site.hcl` defines a `skip_regions  = ["ca-central-1", "ap-southeast-1"]` which ensures those regions are `skipped` and do not get AWS resources. Simply remove to get multi-region resource deployments. It's very easy to start with just `us-east-1` and then enable at any time. 

The `env.sh` and `infra/terraform/live/site/site.hcl` files 

Being truly multi-regional without dependencies on `us-east-1` involves deploying all regional services like ECR, ECS, SSM, S3 to `ca-central-1`, `ap-southeast-1`, etc. You must also `build`, `release`, and `deploy` each app image to each of the ECR regions. Using the `release-all.sh` script that helps unity the deployments and ensure all regions are the same.

## Infrastructure and Services
> Checkout [`infra/README.md`](infra/README.md) for the deployment pipeline and multi-region active-active patterns.

The modules below create various AWS resources and don't map 1:1. For example, `s3-uploads` configures S3, IAM, KMS, SSM, and uses the variables set `site.hcl` and `services/*/service.hcl`.

```
infra/terraform/
├── live/site/                      # Terragrunt live configuration
│   ├── global/                     # Global resources (CloudFront, ECR, etc.)
│   ├── region/                     # Per-region resources
│   │   ├── us-east-1/              # Virginia (primary)
│   │   ├── ca-central-1/           # Canada
│   │   └── ap-southeat-1/          # Singapore
│   └── services/                   # Per-service Terragrunt definitions
│       ├── run.auth/               # run.auth ECS service
│       ├── run.cms/                # run.cms ECS service
│       └── run.gpx/                # run.gpx ECS service
│       └── run.human/              # run.human ECS service
└── modules/                        # Reusable Terraform modules
    ├── certs/
    ├── cloudfront/
    ├── cloudfront-assets/
    ├── cloudtrail/
    ├── dynamodb/
    ├── ec2spot/
    ├── ecr/
    ├── ecs-cluster/
    ├── ecs-service/
    ├── ecs-task/
    ├── email/
    ├── github-oidc/
    ├── lambda-edge/
    ├── network/
    ├── s3-uploads/
    ├── s3-uploads-processor/
    ├── secrets/
    └── site/
```
The `infra/terraform/live/site/services` maps the application deployments into infrastructure.

| Service | URL | What It Does |
|---------|-----|--------------|
| **run.auth** | auth.defcon.run | OIDC provider — SSO across all services |
| **run.human** | run.defcon.run | Main app — registration, event info |
| **run.gpx** | gpx.defcon.run | GPX route editor — plan your Vegas runs |
| **run.cms** | cms.defcon.run | Headless CMS — schedules, announcements |
| **run.meshtk** | mqtt.defcon.run | Meshtastic and MQTT services+UIs |

## Applications
> Checkout [`apps/README.md`](apps/README.md) for request flow, authentication flow, CMS replication, and GPX architecture diagrams.

Using the `./release-all.sh --pr --with-terraform --regions=use1` will bump the versions, push the application to the ECR repositories, rewrite the ECS taskdefs to use the new version numbers, and trigger a ECS deployments. Making, `--regions=use1,apse1,cac1` would deploy to all regions.   

```
apps/                   # Application services → see apps/README.md
├── run.auth/           #   OIDC auth service
├── run.cms/            #   Strapi + Litestream
├── run.gpx/            #   Next.js + gpx-studio
├── run.human/          #   Main event app
└── release-all.sh      #   Multi-region release
```
The applications can be run locally without any AWS connections. Only the `run.auth` email registration requires outbound SES configuration, but it's not necessary if you use OIDC providers (ie. Discord, github.)

### devcontainers
In `vscode` you can launch a devcontainer via `.devcontainer/devcontainer.json`.  The `.vscode/tasks.json` file has all of the start-up commands for the dev servers.

## What It Does
Today (February) these are the basics so far:
- **Event Registration** — Runner sign-ups with email verification via custom OIDC provider
- **Route Planning** — Full GPX editor (embedded [gpx-studio](https://gpx.studio)) for planning runs across Las Vegas
- **Content Management** — Headless CMS for schedules and announcements with master-worker replication
- **Multi-Region Resilience** — Active-active pattern (US East + extendable to any region)

## Tech Stack

| Layer | Stack |
|-------|-------|
| **Frontend** | Next.js 16, React 19, HeroUI, Tailwind 4, gpx-studio (SvelteKit) |
| **Backend** | DynamoDB + ElectroDB, SQLite + Litestream, S3 |
| **Auth** | Auth.js, oidc-provider, SES email verification |
| **Infrastructure** | Terraform 1.14, Terragrunt 0.97, ECS Fargate, CloudFront + WAF |
| **CI/CD** | GitHub Actions, OIDC federation (no long-lived creds), SOPS secrets |
| **Testing** | Playwright E2E with multi-user scenarios |


# Motivations

[defcon.run 33](https://github.com/khundeck/defcon.run.33) was a huge success by all measures, where we tried a tonne of new ideas (ie. meshtastic CTF), heatmaps, leaderboards. I learned from that a few key areas to focus on: auth for webapp and meshtk, a proper GPX route editor for planning runs, and a workflow that lets me spin up multiple Claude instances working in parallel on features, while I sleep. ;-) This repo is the result - and we'll be working on until DEF CON 34 this year.

Another massive motivation is continuing to learn Claude Code and new AI development workflows. 

July 2025 Claude wrote the first implementations Heat Map and the Leaderboard, and was able to help me finish the crypto implementation in meshtk. Ultimately, Claude became a massive multiplyer and I completed more features than I could've ever imagined.

There is hundreds of hours of AWS and development workflow magic in this repo that I'm happy to share with you. 🙂


## AI-Assisted Development

This project uses a suite of Claude Code tools for AI-assisted development — parallel Claude instances via git worktrees, spec-driven proposals, dependency-aware issue tracking, and persistent memory. See the [`.claude/`](.claude/) directory for full documentation.

## What I Learned

This project has been my vehicle for exploring:

- **Multi-region AWS** — CloudFront path-based routing, DynamoDB global tables, regional failover
- **Database replication** — Litestream SQLite WAL streaming, atomic DB swaps
- **AI-assisted development** — Structured workflows for parallel Claude instances
- **Embedding open source** — Wrapping SvelteKit in Next.js with auth
- **Infrastructure as Code** — Terragrunt for DRY multi-region Terraform
- **E2E testing** — Session persistence, multi-user scenarios, geographic test diversity
