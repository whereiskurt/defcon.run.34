# defcon.run 34

> "Multi-region AWS IaC: CloudFront + WAF + ALB → ECS Fargate (Next.js, Strapi, SvelteKit). DynamoDB global tables + Litestream SQLite replication. AI-assisted spec-driven development with parallel Claude instances. All Terraform+Terragrunt."

This is a hobby fun project where we experiment with modern cloud architecture, AI-assisted workflows, and full-stack tech — while building something real: a 4-day running event at **DEF CON 34** in Las Vegas.

There's A LOT of AWS and development workflow magic in this repo that I'm happy to share. 🏃‍♂️ Multi-region active-active deployments, SQLite WAL streaming to S3, embedding open-source SvelteKit apps in Next.js, and a suite of AI development tools for parallel Claude coordination. I learned a ton building this — hopefully it's useful to others!

![Architecture Overview](https://github.com/user-attachments/assets/0f631149-7046-43f2-9890-5fd04b23762d)

## Motivation

After [defcon.run 33](https://github.com/khundeck/defcon.run.33), I wanted to level up: better auth, a proper GPX route editor for planning runs, and a workflow that lets me spin up multiple Claude instances working in parallel on the same feature. This repo is the result — and we're headed to Vegas with it!

## What It Does

- **Event Registration** — Runner sign-ups with email verification via custom OIDC provider
- **Route Planning** — Full GPX editor (embedded [gpx-studio](https://gpx.studio)) for planning runs across Las Vegas
- **Content Management** — Headless CMS for schedules and announcements with master-worker replication
- **Multi-Region Resilience** — Active-active across US East and Canada Central

## Architecture

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

| Service | URL | What It Does |
|---------|-----|--------------|
| **run.human** | run.defcon.run | Main app — registration, event info |
| **run.auth** | auth.defcon.run | OIDC provider — SSO across all services |
| **run.gpx** | gpx.defcon.run | GPX route editor — plan your Vegas runs |
| **run.cms** | cms.defcon.run | Headless CMS — schedules, announcements |

## Tech Stack

| Layer | Stack |
|-------|-------|
| **Frontend** | Next.js 16, React 19, HeroUI, Tailwind 4, gpx-studio (SvelteKit) |
| **Backend** | DynamoDB + ElectroDB, SQLite + Litestream, S3 |
| **Auth** | Auth.js, oidc-provider, SES email verification |
| **Infrastructure** | Terraform 1.14, Terragrunt 0.97, ECS Fargate, CloudFront + WAF |
| **CI/CD** | GitHub Actions, OIDC federation (no long-lived creds), SOPS secrets |
| **Testing** | Playwright E2E with multi-user scenarios |

## Cool Patterns I Built

### Master-Worker CMS Replication

This one I'm proud of. The CMS uses SQLite with [Litestream](https://litestream.io/) for continuous replication:

```
┌──────── Master (us-east-1) ────────┐     ┌──────── Workers ────────┐
│  Strapi → SQLite → Litestream      │────▶│  S3 → SQLite → Strapi   │
│  (writes, continuous WAL sync)     │     │  (reads, 5-min restore) │
└────────────────────────────────────┘     └─────────────────────────┘
```

Admin writes go to master. Litestream streams WAL to S3. Workers periodically restore and atomically swap DBs. Reads fan out via ECS service discovery. Simple, cheap, resilient.

### Embedded Open Source

The GPX editor embeds [gpx-studio](https://gpx.studio) — an open-source SvelteKit app. I wrapped it in Next.js:

- Next.js handles auth (Auth.js) and API routes
- gpx-studio built at deploy time, served as static files under `/studio/*`
- Cloud storage via presigned S3 URLs + DynamoDB metadata
- Versioning and public/private share links

### Multi-Region Active-Active

Both regions run identical services. CloudFront routes by path prefix (`/use1/*`, `/cac1/*`). Apps use dynamic `basePath`. DynamoDB global tables replicate across regions. One `release-all.sh --parallel` and you're live everywhere.

## AI-Assisted Development Workflow

This is where it gets fun. I built a suite of tools for working with Claude:

### Devflow — Parallel Claude Coordination

Multiple Claude instances can work on the same feature using git worktrees:

```
┌─────────────────────────────────────────────────────────────────┐
│  CLAUDE 1                           CLAUDE 2                    │
│  /devflow:start                     /devflow:start              │
│      │                                  │                       │
│      ▼                                  ▼                       │
│  Creates feature branch             Joins existing feature      │
│  Creates work worktree              Creates work worktree       │
│      │                                  │                       │
│  ┌─────────────────┐              ┌─────────────────┐           │
│  │ Work isolated   │              │ Work isolated   │           │
│  │ wt-1234567      │              │ wt-8901234      │           │
│  └────────┬────────┘              └────────┬────────┘           │
│           ▼                                ▼                    │
│  /devflow:close                    /devflow:close               │
│  Merge → feature                   Merge → feature              │
│                                    "Last one — create PR"       │
└─────────────────────────────────────────────────────────────────┘
```

Each Claude gets isolated workspace. Work merges to shared feature branch. Last one out creates the PR.

### OpenSpec — Spec-Driven Development

Features start as proposals with formal `WHEN`/`THEN` scenarios:

```
openspec/
├── changes/           # Active proposals
│   └── add-gpx-versioning/
│       ├── proposal.md   # What and why
│       ├── tasks.md      # Implementation checklist
│       └── specs/        # Delta specifications
└── specs/             # Living truth — what's actually built
```

Validate before implementation. Archive after deployment. Specs are always truth.

### Beads + bv — Dependency-Aware Issue Tracking

```bash
bd ready                    # Find unblocked work
bd create --title="..." --type=task --priority=2
bv --robot-triage          # AI triage with PageRank, critical paths
```

No more manually parsing backlogs. `bv` computes graph metrics and tells you what to work on.

### CASS — Persistent Memory

```bash
cm context "implement user auth"  # Get rules and anti-patterns before work
cm reflect --days 1               # Extract learnings after
```

Memory that survives across sessions. Rules accumulate over time.

## Running It

```bash
# Dev servers (VS Code tasks auto-start these)
PORT=3001 npm run dev      # run.human
PORT=3002 npm run dev      # run.auth
PORT=3003 npm run dev      # run.gpx
PORT=1337 npm run develop  # run.cms

# GPX needs frontend built first
cd apps/run.gpx && ./build-frontend.sh

# Release everything
./apps/release-all.sh --parallel

# E2E tests
cd apps && ./e2e.sh --headed
```

## Project Structure

```
apps/
├── run.auth/       # OIDC auth service
├── run.cms/        # Strapi + Litestream
├── run.gpx/        # Next.js + gpx-studio
├── run.human/      # Main event app
└── release-all.sh  # Multi-region release

infra/terraform/
├── live/site/      # Terragrunt configs
└── modules/        # Terraform modules

openspec/           # Spec-driven development
├── changes/        # Active proposals
└── specs/          # Current specifications

.claude/            # AI workflow docs
├── commands/       # devflow, openspec skills
└── *.md            # architecture, beads, cass guides
```

## What I Learned

This project has been my vehicle for exploring:

- **Multi-region AWS** — CloudFront path-based routing, DynamoDB global tables, regional failover
- **Database replication** — Litestream SQLite WAL streaming, atomic DB swaps
- **AI-assisted development** — Structured workflows for parallel Claude instances
- **Embedding open source** — Wrapping SvelteKit in Next.js with auth
- **Infrastructure as Code** — Terragrunt for DRY multi-region Terraform
- **E2E testing** — Session persistence, multi-user scenarios, geographic test diversity

---

*Built for runners at DEF CON 34, Las Vegas 2026* 🏃‍♂️🎰
