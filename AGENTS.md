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
├── run.mqtt/       # MQTT broker + meshtk + meshmap
├── local/          # Local-only development tooling
│   ├── configui/   # Infrastructure config UI (Go binary)
│   ├── dynamodb/   # Local DynamoDB (Docker)
│   └── s3/         # Local S3/MinIO (Docker)
├── build.sh        # Build and push Docker image to ECR
├── deploy.sh       # Deploy to ECS via Terragrunt
└── release-all.sh  # Multi-region parallel release

infra/terraform/
├── live/site/   # Terragrunt live configuration
│   ├── services/{auth,cms,run-human}/  # Service definitions
│   └── region/{us-east-1,ca-central-1}/  # Regional resources
└── modules/     # Terraform modules

.planning/    # GSD planning — milestones, phases, and todos
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

# Release: builds + pushes images and opens the Release PR (NO deploy).
# The deploy runs in GitHub Actions — see "Releases & Deploys" below.
./apps/release-all.sh --apps run.human --pr

# Deploy (GitHub Actions only — never local terragrunt apply):
gh workflow run deploy.yml -f region=us-east-1 -f pr_number=latest -f invalidate_cache=true

# Infrastructure (plan/inspect only — do NOT apply to deploy)
cd infra/terraform/live/site && terragrunt plan --all

# Planning & work tracking (GSD — run as Claude Code slash commands)
/gsd:progress            # Check progress and route to the next action
/gsd:plan-phase          # Plan the next phase before building
/gsd:execute-phase       # Execute the planned work

# E2E Tests (requires AWS credentials for S3 email retrieval)
cd apps/run.auth/e2e && npm install && npx playwright install chromium
npm test                 # Run all auth e2e tests
npm run test:headed      # Run with browser visible
```

## Local Development (Dev Container)

A VS Code **Dev Container** (`.devcontainer/`) is a supported way to do local dev —
editing, installing deps, and running the dev servers. It is **not** a deploy path:
deploys still go through GitHub Actions (Essential Rule 4).

- Builds from `.devcontainer/Dockerfile` (ARM64 / Apple-silicon) with docker-in-docker,
  `aws-cli`, `gh`, and Terraform/Terragrunt/SOPS baked in.
- `post-create.sh` npm-installs all four webapps and builds the gpx-studio frontend.
- Forwards the four dev-server ports — 3001 run.human, 3002 run.auth, 3003 run.gpx,
  1337 run.cms — so `PORT=<n> npm run dev` in each app is reachable on the host.
- Bind-mounts your `~/.aws` and `~/.claude`; container env defaults to
  `AWS_PROFILE=application`, `AWS_REGION=us-east-1`. Fine for local reads/dev; it does
  **not** change the deploy rule — shipping is always the `deploy.yml` workflow.

## Detailed Documentation

Read these files for in-depth information:

| Topic | File | When to read |
|-------|------|--------------|
| **Architecture** | [.claude/architecture.md](.claude/architecture.md) | Multi-region patterns, containers, secrets |
| **Commands** | [.claude/commands.md](.claude/commands.md) | Full command reference |
| **Best Practices** | [.claude/best-practices.md](.claude/best-practices.md) | Code style, naming, session protocol |

## Essential Rules

1. **GSD for planning** — Track multi-step work as phases under `.planning/`. Use `/gsd:progress` to route to the next action and `/gsd:plan-phase` before building. New features get a planned phase; bug fixes and typos can skip planning.

2. **Branch workflow** — Always work in a feature branch, never commit directly to main. Create a PR for review. **Wait for explicit user approval before merging.** Never auto-merge PRs unless explicitly told.

3. **Simplicity first** — <100 lines, single-file until proven insufficient, boring patterns preferred.

4. **Deploy ONLY via GitHub Actions** — Never run `terragrunt apply` locally to deploy, and never pass `--with-terragrunt` to a release. The ECS/CloudFront deploy ALWAYS goes through the `deploy.yml` ("🚀 Deploy: Release") workflow. Local tooling only builds and pushes images to ECR; CI does the apply. See **Releases & Deploys** below.

## Releases & Deploys

**The deploy always runs in GitHub Actions — not on your machine.** The split is:
local tooling **builds + pushes images to ECR**; the `deploy.yml` workflow
**merges the Release PR, applies ECS via Terragrunt, and invalidates CloudFront**.
Never `terragrunt apply` by hand and never use `release-all.sh --with-terragrunt`.

**Standard release flow (from a worktree):**

```bash
# 0. PREREQUISITE (worktree landmine — do this FIRST, see below)
cp <main-checkout>/env.local.sh <worktree-root>/env.local.sh   # gitignored

# 1. Build + push images and open the Release PR (version-bump PR). NO deploy.
./apps/release-all.sh --apps run.human --pr        # both regions auto-probed;
                                                    # regions w/o ECR repos skip

# 2. Deploy via CI — this MERGES the Release PR, applies ECS, invalidates CF.
gh workflow run deploy.yml \
  -f region=us-east-1 \
  -f pr_number=<ReleasePR#> \        # or "latest"; "skip" = deploy w/o merge
  -f invalidate_cache=true

# 3. Watch it, then verify the live version actually rolled.
gh run watch <run-id>
```

**`env.local.sh` worktree landmine (causes a partial/failed release):**
`build.sh` reads `TF_VAR_profile_prefix` from the repo-root `env.local.sh` to form
the AWS profile (`dc34-application`). This file is **gitignored**, so a fresh
worktree doesn't have it — the profile silently collapses to a bare `application`
that doesn't exist, and the build dies at the **post-build S3 static-asset sync
with exit 255** *after* images/build already succeeded. Copy `env.local.sh` from
the main checkout (or any release-capable worktree) into the worktree root before
releasing. Recovery if it bit you mid-run: `AWS_PROFILE=dc34-application` for
direct calls isn't enough (the S3 step uses an `aws_cmd` helper that hard-sets the
profile); fix `env.local.sh`, then re-run just
`AWS_REGION=us-east-1 ./apps/build.sh webapp <app>` to finish the app-image push.

**Immutable ECR:** repos are immutable — a build fails loudly if the tag already
exists. That means the Release PR's VERSION bump must be the source of a *new* tag;
never `--skip-bump` onto an already-released version.

**Verify after deploy** — CI going green is not proof the new task is serving.
ECS does a rolling replace (old task drains while new one health-checks), so check:
```bash
curl -s https://run.defcon.run/use1/ | grep -oE 'v0\.0\.[0-9]+'   # live app version
# an authed /admin/* route returns 404 to UNAUTHENTICATED probes by design
# (non-disclosure gate) — a 404 from curl is NOT evidence the route is missing.
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **Capture remaining work** - Record follow-ups as GSD todos (`/gsd:add-todo`)
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update planning status** - Mark finished phases done, note in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
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
