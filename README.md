# defcon.run 34
Hello World! 🤗 

This is a hobby project where we experiment with modern AWS cloud architecture, AI-assisted Claude Code workflows, and full-stack webapp tech - with the goal of building something fun and useful for our annual a 4-day running event at DEFCON in Las Vegas.
<img width="250" alt="Screenshot 2025-10-03 at 09 48 16" src="https://github.com/user-attachments/assets/9214fceb-2f76-48be-b89f-54ecf7692318" />
<img width="350" alt="Screenshot 2025-08-08 at 13 54 31" src="https://github.com/user-attachments/assets/4fa9373a-43b8-40f0-b9fc-e5819fdafb2f" />
<img width="200"  alt="Screenshot 2025-08-10 at 07 30 29" src="https://github.com/user-attachments/assets/018b73fe-ceaa-4296-9bc6-226bcb3f6258" />

From the end-off DEF CON 33 (Aug 2025) to now (February 2026) - I've been working to establish the architecture and new patterns we'll be using to build out run.defcon.run this year. For example, we have new `auth` and `gpx` services to support our future vision, as well as `.claude/` skills an `AGENTS.md` to focus the tooling.  

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

### Request Flow

```
┌────────┐    ┌────────────┐    ┌─────┐    ┌─────────┐    ┌───────────┐
│ Browser│───▶│ CloudFront │───▶│ WAF │───▶│   ALB   │───▶│ECS Fargate│
└────────┘    │  (Edge)    │    │     │    │(Regional)│   │ (Next.js) │
              └────────────┘    └─────┘    └─────────┘    └────┬──────┘
                                                               │
              ┌────────────────────────────────────────────────┘
              ▼
    ┌──────────────────────────────────────────────────────────┐
    │                     Data Layer                           │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
    │  │  DynamoDB   │  │     S3      │  │    SES      │       │
    │  │ (ElectroDB) │  │  (Uploads)  │  │  (Email)    │       │
    │  └─────────────┘  └─────────────┘  └─────────────┘       │
    └──────────────────────────────────────────────────────────┘
```

### Authentication Flow (OIDC)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          User Login Flow                                 │
└──────────────────────────────────────────────────────────────────────────┘

  ┌────────┐         ┌────────────┐         ┌────────────┐
  │  User  │         │ run.human  │         │ run.auth   │
  │Browser │         │ (App)      │         │ (OIDC)     │
  └───┬────┘         └─────┬──────┘         └─────┬──────┘
      │                    │                      │
      │  1. Click Login    │                      │
      │───────────────────▶│                      │
      │                    │  2. Redirect to      │
      │                    │     /authorize       │
      │◀───────────────────│─────────────────────▶│
      │                    │                      │
      │  3. Enter email    │                      │
      │──────────────────────────────────────────▶│
      │                    │                      │
      │                    │     ┌────────────┐   │
      │                    │     │    SES     │   │
      │                    │     │  (Email)   │◀──│ 4. Send magic link
      │                    │     └─────┬──────┘   │
      │  5. Click link     │           │          │
      │◀───────────────────────────────┘          │
      │                    │                      │
      │──────────────────────────────────────────▶│ 6. Verify token
      │                    │                      │
      │◀─────────────────────────────────────────▶│ 7. Issue JWT
      │  8. Redirect with  │                      │
      │     session cookie │                      │
      │───────────────────▶│                      │
      │                    │                      │
      │  9. Authenticated! │                      │
      │◀───────────────────│                      │
```

### Deployment Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    GitHub Actions (OIDC Federation)                     │
│                    No long-lived AWS credentials                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
           ┌────────────────────────┼────────────────────────┐
           ▼                        ▼                        ▼
    ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
    │   Build     │          │   Build     │          │   Build     │
    │  run.auth   │          │  run.human  │          │   run.gpx   │
    └──────┬──────┘          └──────┬──────┘          └──────┬──────┘
           │                        │                        │
           └────────────────────────┼────────────────────────┘
                                    ▼
                         ┌─────────────────────┐
                         │     Push to ECR     │
                         │  (Container Images) │
                         └──────────┬──────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼                               ▼
           ┌────────────────┐              ┌────────────────┐
           │  Deploy ECS    │              │  Deploy ECS    │
           │  us-east-1     │              │ ap-southeast-1 │
           │  (Terragrunt)  │              │  (Terragrunt)  │
           └────────────────┘              └────────────────┘
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


### Last Year's Architecture
This was [last year's architecture](https://github.com/whereiskurt/defcon.run.33/) and the basis for this years: 

![Architecture Overview](https://github.com/user-attachments/assets/0f631149-7046-43f2-9890-5fd04b23762d)

TODO: Redraw this diagram w/ `claude`. :-)


## Cool Patterns :-)

### Master-Worker CMS Replication

I'm continuing to explore this approach, but it seems like a headless Strapi master that litestreams to an S3 buckets, with read-only workers, is cheap robust pattern. The CMS uses SQLite with [Litestream](https://litestream.io/) for continuous replication:

```
┌──────── Master (us-east-1) ────────┐     ┌──────── Workers ────────┐
│  Strapi → SQLite → Litestream      │────▶│  S3 → SQLite → Strapi   │
│  (writes, continuous WAL sync)     │     │  (reads, 5-min restore) │
└────────────────────────────────────┘     └─────────────────────────┘
```

Admin writes go to master. Litestream streams WAL to S3. Workers periodically restore and atomically swap DBs. Reads fan out via ECS service discovery. Simple, cheap, resilient.

### Embedded Open Source

The GPX editor embeds [gpx-studio](https://gpx.studio) — an open-source SvelteKit app. I wrapped it in Next.js:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         run.gpx Architecture                             │
└──────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     Next.js Shell                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │   Auth.js       │  │   API Routes    │  │   /studio   │  │
│  │   (Session)     │  │   (/api/gpx/*)  │  │  (Static)   │  │
│  └────────┬────────┘  └────────┬────────┘  └──────┬──────┘  │
└───────────┼────────────────────┼──────────────────┼─────────┘
            │                    │                  │
            ▼                    ▼                  ▼
     ┌────────────┐       ┌────────────┐    ┌─────────────────┐
     │  DynamoDB  │       │     S3     │    │   gpx-studio    │
     │ (Metadata) │       │  (Files)   │    │   (SvelteKit)   │
     │ - versions │       │ - .gpx     │    │  Built at deploy│
     │ - shares   │       │ - exports  │    │  Served static  │
     └────────────┘       └────────────┘    └─────────────────┘

Flow: User → Auth → Load GPX list → Open in Studio → Save via API → S3
```

- Next.js handles auth (Auth.js) and API routes
- gpx-studio built at deploy time, served as static files under `/studio/*`
- Cloud storage via presigned S3 URLs + DynamoDB metadata
- Versioning and public/private share links

### Multi-Region Active-Active

Both regions run identical services. CloudFront routes by path prefix (`/use1/*`, `/apse1/*`). Apps use dynamic `basePath`. DynamoDB global tables replicate across regions. One `release-all.sh --parallel` and you're live everywhere.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Adding a New Region                                  │
└─────────────────────────────────────────────────────────────────────────┘

1. Create regional config:     infra/terraform/live/site/region/ap-southeast-1/
2. Add service definitions:    infra/terraform/live/site/services/*/apse1.hcl
3. Update CloudFront origins:  Add /apse1/* path routing
4. Extend DynamoDB tables:     Add region to global table replicas
5. Deploy:                     ./apps/release-all.sh --parallel

┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  us-east-1   │    │ap-southeast-1│    │  eu-west-1   │
│  (Primary)   │◀──▶│  (Asia)      │◀──▶│  (Europe)    │
│              │    │              │    │   (Future)   │
└──────────────┘    └──────────────┘    └──────────────┘
       ▲                   ▲                   ▲
       └───────────────────┴───────────────────┘
                  DynamoDB Global Tables
```

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

# Running It
## devcontainers
If you use `vscode` you should be able to launch a devcontainer based on the `.devcontainer/devcontainer.json` configuration file. The `.vscode/tasks.json` file has all of the start-up commands for the servers. 


## From the shell
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
