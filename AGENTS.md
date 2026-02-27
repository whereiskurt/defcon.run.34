# AGENTS.md

Instructions for AI coding assistants working in this repository.

## Project Overview

**defcon.run 34** monorepo — an official event at DEF CON 34 (2026). Contains AWS multi-region infrastructure (Terragrunt/Terraform) and Next.js web applications deploying to `us-east-1` (use1) and `ca-central-1` (cac1) with CloudFront.

## Repository Structure

```
apps/
├── run.auth/       # Auth service (auth.defcon.run) - Next.js + OIDC
├── run.cms/        # CMS service (cms.defcon.run) - Strapi 5
├── run.gpx/        # GPX editor (gpx.defcon.run) - Next.js + gpx-studio
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
| Infrastructure | Terraform 1.14, Terragrunt 0.97 |
| Container | Docker, AWS ECR, AWS ECS Fargate |
| CDN | AWS CloudFront + WAF |

## Quick Start

```bash
# Development (VS Code tasks auto-start these on folder open)
# See .vscode/tasks.json for all dev servers
PORT=3001 npm run dev      # run.human (from apps/run.human/webapp)
PORT=3002 npm run dev      # run.auth (from apps/run.auth/webapp)
PORT=3003 npm run dev      # run.gpx (from apps/run.gpx/webapp)
PORT=1337 npm run develop  # run.cms (from apps/run.cms/app)

# run.gpx requires building gpx-studio frontend first:
cd apps/run.gpx && ./build-frontend.sh

# Release (all apps, all regions)
./apps/release-all.sh --parallel

# Infrastructure
cd infra/terraform/live/site && terragrunt plan --all

# Issue tracking
bd ready --json          # Find unblocked work (structured output)
bd close <id> && bd sync # Complete and sync
bv --robot-triage        # AI triage: ranked work, graph metrics, next steps

# E2E Tests (requires AWS credentials for S3 email retrieval)
cd apps/run.auth/e2e && npm install && npx playwright install chromium
npm test                 # Run all auth e2e tests
npm run test:headed      # Run with browser visible

# Memory (cm/cass) - before and after work
cm context "<task>"      # BEFORE: Get rules and patterns for this task
cm reflect --days 1      # AFTER: Extract learnings from session
```

## Detailed Documentation

Read these files for in-depth information:

| Topic | File | When to read |
|-------|------|--------------|
| **Architecture** | [.claude/architecture.md](.claude/architecture.md) | Multi-region patterns, containers, secrets |
| **Commands** | [.claude/commands.md](.claude/commands.md) | Full command reference |
| **OpenSpec** | [.claude/openspec.md](.claude/openspec.md) | Creating/implementing change proposals/TODOs |
| **Issue Tracking** | [.claude/beads.md](.claude/beads.md) | bd/beads workflow and bv visualization |
| **Memory (CASS)** | [.claude/cass.md](.claude/cass.md) | cm/cass workflow, reflection, playbook management |
| **Best Practices** | [.claude/best-practices.md](.claude/best-practices.md) | Code style, naming, session protocol |

## Essential Rules

1. **OpenSpec for features** — Create proposals for new capabilities, breaking changes, or architecture shifts. Skip for bug fixes and typos.

2. **bd for issue tracking** — Use `bd ready` to find work, `bd sync` at session end. Priority: 0-4 (not high/medium/low).

3. **Branch workflow** — Always work in a feature branch, never commit directly to main. Create a PR for review. **Wait for explicit user approval before merging.** Never auto-merge PRs unless explicitly told.

4. **Simplicity first** — <100 lines, single-file until proven insufficient, boring patterns preferred.

5. **Memory (cm/cass)** — Run `cm context "<task>"` before complex work; run `cm reflect --days 1` after sessions. Leave `// [cass: helpful b-xyz]` feedback inline.

---

Remember: Specs are truth. Changes are proposals. Keep them in sync.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
