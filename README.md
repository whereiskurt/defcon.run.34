# defcon.run 34

A multi-region AWS infrastructure and web application suite for hosting a 4-day running event at DEF CON 34 in Las Vegas.

**This is a hobby project** where I experiment with modern cloud architecture, AI-assisted development workflows, and full-stack technologies. It's a playground for learning new tools and approaches while building something real.

## What It Does

- **Event Registration** — Runner sign-ups with email verification via OIDC
- **Route Planning** — GPX route editor for planning runs across Las Vegas
- **Content Management** — Headless CMS for event schedules and announcements
- **Multi-Region Resilience** — Active-active deployment across US East and Canada Central

## Architecture Overview

```
                              Internet
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────┐
│                    CloudFront + WAF                          │
│  Per-app WebACLs: rate limiting, brute-force protection      │
│  Path-based routing: /use1/* → US East, /cac1/* → Canada     │
└──────────────────────────────────────────────────────────────┘
                     │                    │
                     ▼                    ▼
           ┌─────────────────┐  ┌─────────────────┐
           │   us-east-1     │  │  ca-central-1   │
           │  ┌───────────┐  │  │  ┌───────────┐  │
           │  │    ALB    │  │  │  │    ALB    │  │
           │  └─────┬─────┘  │  │  └─────┬─────┘  │
           │        │        │  │        │        │
           │  ┌─────▼─────┐  │  │  ┌─────▼─────┐  │
           │  │ ECS Tasks │  │  │  │ ECS Tasks │  │
           │  │ (Fargate) │  │  │  │ (Fargate) │  │
           │  └───────────┘  │  │  └───────────┘  │
           └─────────────────┘  └─────────────────┘
```

### Services

| Service | URL | Purpose | Stack |
|---------|-----|---------|-------|
| **run.human** | run.defcon.run | Main app, registration | Next.js 16, React 19, DynamoDB |
| **run.auth** | auth.defcon.run | OIDC provider, SSO | Next.js, Auth.js, oidc-provider |
| **run.gpx** | gpx.defcon.run | GPX route editor | Next.js + SvelteKit (gpx-studio) |
| **run.cms** | cms.defcon.run | Headless CMS | Strapi 5, SQLite + Litestream |

## Tech Stack

### Frontend
- **Next.js 16** with React 19 and App Router
- **HeroUI** component library with Tailwind 4
- **gpx-studio** (SvelteKit) embedded for route editing

### Backend & Data
- **DynamoDB** with ElectroDB for data modeling
- **SQLite + Litestream** for CMS (master-worker replication to S3)
- **S3** for GPX files, static assets, email storage

### Infrastructure
- **Terraform 1.14** with **Terragrunt 0.97** for DRY multi-region configs
- **ECS Fargate** with nginx sidecars for TLS
- **CloudFront** with per-app WAF WebACLs
- **OIDC federation** for GitHub Actions (no long-lived credentials)

### Development Tooling
- **SOPS** for secrets management (KMS-encrypted)
- **Playwright** for E2E testing with multi-user scenarios
- **GitHub Actions** with approval-gated deployments

## Architectural Patterns

### Multi-Region Active-Active

Both regions run identical services. CloudFront routes by path prefix (`/use1/*`, `/cac1/*`) with dynamic `basePath` in apps. DynamoDB global tables replicate across regions.

### Master-Worker CMS Replication

The CMS uses a pattern I'm proud of:

```
┌──────── Master (us-east-1) ────────┐     ┌──────── Workers ────────┐
│  Strapi → SQLite → Litestream      │────▶│  S3 → SQLite → Strapi   │
│  (writes, continuous WAL sync)     │     │  (reads, 5-min restore) │
└────────────────────────────────────┘     └─────────────────────────┘
```

Litestream continuously streams SQLite WAL to S3. Workers periodically restore and atomically swap DBs. Admin writes go to master; reads fan out to workers via service discovery.

### Embedded Open Source

The GPX editor embeds [gpx-studio](https://gpx.studio), an open-source SvelteKit app. I wrapped it in Next.js for auth integration:

- Next.js handles authentication (Auth.js) and API routes
- gpx-studio is built at deploy time and served as static files
- Cloud storage uses presigned S3 URLs with DynamoDB metadata

## AI-Assisted Development Workflow

This project uses a suite of tools that enhance development with AI assistants:

### Devflow — Parallel Instance Coordination

Multiple Claude instances can work on the same feature using git worktrees:

```
┌─────────────────────────────────────────────────────────────────┐
│  CLAUDE 1                           CLAUDE 2                    │
│  /devflow:start                     /devflow:start              │
│      │                                  │                       │
│      ▼                                  ▼                       │
│  Creates feature branch             Detects feature exists      │
│  Creates work worktree              Creates work worktree       │
│      │                                  │                       │
│  ┌─────────────────┐              ┌─────────────────┐           │
│  │ Work isolated   │              │ Work isolated   │           │
│  │ wt-1234567      │              │ wt-8901234      │           │
│  └────────┬────────┘              └────────┬────────┘           │
│           ▼                                ▼                    │
│  /devflow:close                    /devflow:close               │
│  Merge → feature branch            Merge → feature branch       │
│                                    "Last one - create PR"       │
└─────────────────────────────────────────────────────────────────┘
```

### OpenSpec — Spec-Driven Development

Features start as proposals with formal specifications:

```
openspec/
├── changes/           # Active proposals
│   └── add-gpx-versioning-sharing/
│       ├── proposal.md   # What and why
│       ├── tasks.md      # Implementation checklist
│       └── specs/        # Delta specifications
└── specs/             # Living truth of what's built
    ├── human-auth/
    ├── gpx-cloud-save-ux/
    └── e2e-testing/
```

Each requirement has formal scenarios (`WHEN`/`THEN`). Changes are validated before implementation and archived after deployment.

### Beads — Dependency-Aware Issue Tracking

`bd` tracks issues with first-class dependency support:

```bash
bd ready                    # Find unblocked work
bd create --title="..." --type=task --priority=2
bd dep add <issue> <depends-on>
bv --robot-triage          # AI triage with graph metrics
```

The visualization tool (`bv`) computes PageRank, critical paths, and parallel execution tracks—no more manually parsing backlogs.

### CASS — Persistent Memory

`cm` extracts learnings from sessions and retrieves context before work:

```bash
cm context "implement user auth"  # Get rules and anti-patterns
# ... do the work ...
cm reflect --days 1               # Extract learnings
```

## Building a Complex Feature: GPX Editor

The GPX editor demonstrates the full workflow. Here's how it came together:

### 1. Proposal Phase
Created `openspec/changes/add-gpxstudio-service/proposal.md` defining:
- Authentication integration requirements
- Cloud storage API design
- Multi-region deployment pattern

### 2. Implementation
- Forked gpx-studio, modified build for embedding
- Built Next.js wrapper with Auth.js integration
- Designed DynamoDB schema with ElectroDB for file/folder metadata
- Implemented presigned S3 URLs for large file uploads
- Added versioning and public/private share links

### 3. Infrastructure
- Terraform module for single-container ECS task (no nginx sidecar)
- DynamoDB global tables for multi-region file metadata
- S3 buckets per region for GPX file storage
- WAF rules for upload size limits

### 4. Testing
- Playwright E2E tests with multi-user scenarios
- Cookie jar session management for test efficiency
- Geographic diversity in test files for map verification

## Running Locally

```bash
# Development servers (VS Code tasks auto-start these)
PORT=3001 npm run dev      # run.human (apps/run.human/webapp)
PORT=3002 npm run dev      # run.auth (apps/run.auth/webapp)
PORT=3003 npm run dev      # run.gpx (apps/run.gpx/webapp)
PORT=1337 npm run develop  # run.cms (apps/run.cms/app)

# GPX requires building the frontend first
cd apps/run.gpx && ./build-frontend.sh

# Release all apps to all regions
./apps/release-all.sh --parallel

# E2E tests
cd apps && ./e2e.sh --headed
```

## Project Structure

```
apps/
├── run.auth/       # OIDC authentication service
├── run.cms/        # Strapi CMS with Litestream
├── run.gpx/        # GPX editor (Next.js + gpx-studio)
├── run.human/      # Main event application
├── build.sh        # Docker build + ECR push
├── deploy.sh       # ECS deployment via Terragrunt
└── release-all.sh  # Multi-region parallel release

infra/terraform/
├── live/site/      # Terragrunt live configs
│   ├── services/   # Per-service definitions
│   └── region/     # Regional resources
└── modules/        # Reusable Terraform modules

openspec/
├── changes/        # Active proposals
└── specs/          # Current specifications

.claude/            # AI assistant documentation
├── commands/       # Skill definitions (devflow, openspec)
├── architecture.md
├── beads.md
├── cass.md
└── openspec.md
```

## What I've Learned

This project has been a vehicle for exploring:

- **Multi-region AWS patterns** — CloudFront path-based routing, DynamoDB global tables, S3 replication
- **Database replication** — Litestream for SQLite WAL streaming, atomic DB swaps
- **AI-assisted development** — Structured workflows for spec-driven development with Claude
- **Embedding open source** — Wrapping SvelteKit apps in Next.js with auth integration
- **Infrastructure as Code** — Terragrunt for DRY multi-region Terraform configurations
- **E2E testing patterns** — Session persistence, multi-user scenarios, geographic test diversity

## License

This is a personal hobby project. The infrastructure patterns and tooling workflows are shared for learning purposes.

---

*Built for runners at DEF CON 34, Las Vegas 2026*
