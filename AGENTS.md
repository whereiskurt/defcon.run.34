# AGENTS.md

Instructions for AI coding assistants working in this repository.

## Project Overview

**defcon.run 34** monorepo — an official event at DEF CON 34 (2026). Contains AWS multi-region infrastructure (Terragrunt/Terraform) and Next.js web applications deploying to `us-east-1` (use1) and `ca-central-1` (cac1) with CloudFront.

## Repository Structure

```
apps/
├── run.auth/       # Auth service (auth.defcon.run) - Next.js + OIDC
├── run.cms/        # CMS service (cms.defcon.run) - Strapi 5
├── run.human/      # Main app (run.defcon.run) - Next.js
├── build.sh        # Build and push Docker image to ECR
├── deploy.sh       # Deploy to ECS via Terragrunt
└── release-all.sh  # Multi-region parallel release

infra/terraform/
├── live/site/   # Terragrunt live configuration
│   ├── services/{auth,cms,run-human}/  # Service definitions
│   └── region/{us-east-1,ca-central-1}/  # Regional resources
└── modules/     # Terraform modules

openspec/     # Spec-driven development
├── changes/  # Proposals - what SHOULD change
└── specs/    # Current truth - what IS built
```

## Key Technologies

| Layer | Stack |
|-------|-------|
| Frontend | Next.js 16, React 19, HeroUI, Tailwind 4 |
| CMS | Strapi 5.6 + SQLite + Litestream |
| Auth | Auth.js, oidc-provider |
| Database |AWS DynamoDB + ElectroDB |
| Infrastructure | Terraform 1.8, Terragrunt 0.96 |
| Container | Docker, AWS ECR, AWS ECS Fargate |
| CDN | AWS CloudFront + WAF |

## Quick Start

```bash
# Development
cd apps/run.human/webapp && npm run dev

# Release (all apps, all regions)
./apps/release-all.sh --parallel

# Infrastructure
cd infra/terraform/live/site && terragrunt run-all plan

# Issue tracking
bd ready                 # Find unblocked work
bd close <id> && bd sync # Complete and sync
```

## Detailed Documentation

Read these files for in-depth information:

| Topic | File | When to read |
|-------|------|--------------|
| **Architecture** | [.claude/architecture.md](.claude/architecture.md) | Multi-region patterns, containers, secrets |
| **Commands** | [.claude/commands.md](.claude/commands.md) | Full command reference |
| **OpenSpec** | [.claude/openspec.md](.claude/openspec.md) | Creating/implementing change proposals/TODOs |
| **Issue Tracking** | [.claude/beads.md](.claude/beads.md) | bd/beads workflow and bv visualization |
| **Best Practices** | [.claude/best-practices.md](.claude/best-practices.md) | Code style, naming, session protocol |

## Essential Rules

1. **OpenSpec for features** — Create proposals for new capabilities, breaking changes, or architecture shifts. Skip for bug fixes and typos.

2. **bd for issue tracking** — Use `bd ready` to find work, `bd sync` at session end. Priority: 0-4 (not high/medium/low).

3. **Session close protocol** — Always run: `git status` → `git add` → `bd sync` → `git commit` → `bd sync` → `git push`

4. **Simplicity first** — <100 lines, single-file until proven insufficient, boring patterns preferred.

---

Remember: Specs are truth. Changes are proposals. Keep them in sync.
