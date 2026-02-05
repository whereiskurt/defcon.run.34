# WIP: defcon.run 34
Hello World! 🤗

Welcome to the defcon.run.34 codebase. I've been working on variations of this for years - thousands of hours. My hope is this code will useful for you or give your inspiration for what's possible. 

This AWS infrastructure code is multi-regional and re-usable across projects/domains, which is something that's been hard to get right and kinda of a BIG CLAIM that I'm proud of. 

Because multi-regional AWS deployments are tricky to get working so this code base could help accelerate you. It's very easy to start with just `us-east-1` and then add `ca-central-1` at any time. 

The `site.hcl` defines a `skip_regions  = ["ca-central-1", "ap-southeast-1"]` - which is ensures those regions are skipped and do not get AWS resources. Simply remove to get multi-region resource deployments.

This code runs https://run.defcon.run inside of my AWS account, but, can easily be re-configured to run your AWS webscale infrastructure, inside your AWS acccount (ie. https://service.example.com.) 

Review the `env.sh` and `infra/terraform/live/site/site.hcl` files you'll see the variables that control AWS accounts, domain names, etc.

Being truly multi-regional without dependencies on `us-east-1` involves deploying all regional services like ECR, ECS, SSM, S3, ... regionally (i.e `ca-central-1`, `ap-southeast-1`, etc). You must also `build`, `release`, and `deploy` each app image to each of the regions. This code base helps by leveraging features of `terragrunt` and the `release-all.sh` script that helps unity the deployments and ensure all regions are the same.


Adding another region is trivial (copy+paste+rename) and something that `claude` was even able to do with great ease given the working examples. TODO: Create a `/skill` to CRUD new region easily.

## What's here?
The main pillars are `infrastructure` <-> `services` <-> `application`, with `services` gluing the applications instance into the infrastructure.

If you've worked with terragrunt+terraform this layout may seem familar. `live/site` terragrunt structure contain instances of terraform `modules`. Each `region/` contains a `region.hcl` defining the regional specific settings. Other than the unique `region.hcl` files, each of the `ca-central-1/`, `ap-southeast-1/` are just copies/synlinks to `us-east-1/`. Our infrastructure deploys the same modules for all of the regions.

## Infrastructure Service
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
## Application
> Checkout [`apps/README.md`](apps/README.md) for request flow, authentication flow, CMS replication, and GPX architecture diagrams.

Using the `./release-all.sh --pr --with-terraform --regions=use1` will bump the versions, push the application to the ECR repositories, rewrite the taskdefs to use the version number, and trigger a ECS deployment. Making, `--regions=use1,apse1,cac1` would deploy to all regions.   

```
apps/                   # Application services → see apps/README.md
├── run.auth/           #   OIDC auth service
├── run.cms/            #   Strapi + Litestream
├── run.gpx/            #   Next.js + gpx-studio
├── run.human/          #   Main event app
└── release-all.sh      #   Multi-region release
```

| Service | URL | What It Does |
|---------|-----|--------------|
| **run.auth** | auth.defcon.run | OIDC provider — SSO across all services |
| **run.human** | run.defcon.run | Main app — registration, event info |
| **run.gpx** | gpx.defcon.run | GPX route editor — plan your Vegas runs |
| **run.cms** | cms.defcon.run | Headless CMS — schedules, announcements |
| **run.meshtk** | mqtt.defcon.run | Meshtastic and MQTT services+UIs |

Future commits will add `meshtk` in as a service for parity with defcon.run.33 


Since the end-off DEF CON 33 (Aug 2025) to now (February 2026) - I've been working to establish the new architecture and patterns we'll be using to build out `run.defcon.run` this year. For example, we have new `auth` and `gpx` services, we're using `terragrunt`+`terraform modules` to support our future vision, as well as `.claude/` skills an `AGENTS.md` to focus the tooling.

This is a hobby project where we experiment with modern AWS cloud architecture, AI-assisted Claude Code workflows, and full-stack webapp tech - with the goal of building something fun and useful for our annual a 4-day running event at DEFCON in Las Vegas.

<img width="350" alt="Screenshot 2025-08-08 at 13 54 31" src="https://github.com/user-attachments/assets/4fa9373a-43b8-40f0-b9fc-e5819fdafb2f" />

> "Multi-region AWS IaC: CloudFront + WAF + ALB → ECS Fargate (Next.js, Strapi, SvelteKit). DynamoDB global tables + Litestream SQLite replication. AI-assisted spec-driven development with parallel Claude instances. All Terraform+Terragrunt with modules."

## Motivation

A massive motivation is learning Claude Code and new AI development workflows. July 2025 Claude wrote the first implementations of our Heat Map and the Leaderboard. Ultimately, Claude became a massive multipler and I completed more features than I could've ever imagined.

[defcon.run 33](https://github.com/khundeck/defcon.run.33) was a huge success by all measures, where we tried a tonne of new ideas (ie. meshtastic CTF), heatmaps, leaderboards. I learned from that a few key areas to focus on: better auth, a proper GPX route editor for planning runs, and a workflow that lets me spin up multiple Claude instances working in parallel on the same feature. This repo is the result - and we'll be working on until DEF CON 34 this year.

There is hundreds of hours of AWS and development workflow magic in this repo that I'm happy to share with you. 🙂

## What It Does
Today (February) these are the basics so far:
- **Event Registration** — Runner sign-ups with email verification via custom OIDC provider
- **Route Planning** — Full GPX editor (embedded [gpx-studio](https://gpx.studio)) for planning runs across Las Vegas
- **Content Management** — Headless CMS for schedules and announcements with master-worker replication
- **Multi-Region Resilience** — Active-active pattern (US East + extendable to any region)

What's missing is the `meshtk` integration which will make meshtastic integration possible.

## Architecture

```
                                    Internet
                                       │
                                       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                           CloudFront + WAF                                 │
│     Per-app WebACLs: rate limiting, geo-blocking, brute-force protection   │
│     Path-based routing: /use1/* → Virginia, /apse1/* → Singapore           │
└────────────────────────────────────────────────────────────────────────────┘
                        │                              │
                        ▼                              ▼
              ┌─────────────────┐            ┌─────────────────┐
              │   us-east-1     │            │ ap-southeast-1  │
              │   (Virginia)    │            │   (Singapore)   │
              │  ┌───────────┐  │            │  ┌───────────┐  │
              │  │    ALB    │  │            │  │    ALB    │  │
              │  └─────┬─────┘  │            │  └─────┬─────┘  │
              │        │        │            │        │        │
              │  ┌─────▼─────┐  │            │  ┌─────▼─────┐  │
              │  │ ECS Tasks │  │            │  │ ECS Tasks │  │
              │  │ (Fargate) │  │            │  │ (Fargate) │  │
              │  └─────┬─────┘  │            │  └─────┬─────┘  │
              │        │        │            │        │        │
              │  ┌─────▼─────┐  │            │  ┌─────▼─────┐  │
              │  │ DynamoDB  │◀─┼────────────┼─▶│ DynamoDB  │  │
              │  │ (Global)  │  │  Replicate │  │ (Global)  │  │
              │  └───────────┘  │            │  └───────────┘  │
              └─────────────────┘            └─────────────────┘
```


## Tech Stack

| Layer | Stack |
|-------|-------|
| **Frontend** | Next.js 16, React 19, HeroUI, Tailwind 4, gpx-studio (SvelteKit) |
| **Backend** | DynamoDB + ElectroDB, SQLite + Litestream, S3 |
| **Auth** | Auth.js, oidc-provider, SES email verification |
| **Infrastructure** | Terraform 1.14, Terragrunt 0.97, ECS Fargate, CloudFront + WAF |
| **CI/CD** | GitHub Actions, OIDC federation (no long-lived creds), SOPS secrets |
| **Testing** | Playwright E2E with multi-user scenarios |

## Running It

### Devcontainers

If you use VS Code you can launch a devcontainer via `.devcontainer/devcontainer.json`. The `.vscode/tasks.json` file has all of the start-up commands for the dev servers.

### From the Shell

```bash
PORT=3001 npm run dev      # run.human
PORT=3002 npm run dev      # run.auth
PORT=3003 npm run dev      # run.gpx
PORT=1337 npm run develop  # run.cms

# GPX needs frontend built first
cd apps/run.gpx && ./build-frontend.sh

# Release everything
./apps/release-all.sh --parallel
```

## Project Structure


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

### Last Year's Architecture
This was [last year's architecture](https://github.com/whereiskurt/defcon.run.33/) and the basis for this years:

![Architecture Overview](https://github.com/user-attachments/assets/0f631149-7046-43f2-9890-5fd04b23762d)

TODO: Redraw this diagram w/ `claude`. :-)

---

*Built for runners at DEF CON 34, Las Vegas 2026* 🏃‍♂️🎰
