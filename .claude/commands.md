# Commands

Quick reference for development, build, deploy, and tooling.

## Development

### Local Services

```bash
# Start local infrastructure first
cd apps/local/dynamodb && docker compose up   # DynamoDB on :8000
cd apps/local/s3 && docker compose up         # MinIO (S3) on :9000

# Start app dev servers
cd apps/run.human/webapp && PORT=3001 npm run dev     # run.human
cd apps/run.auth/webapp  && PORT=3002 npm run dev     # run.auth
cd apps/run.gpx/webapp   && PORT=3003 npm run dev     # run.gpx
cd apps/run.cms/app      && PORT=1337 npm run develop # run.cms (Strapi)
```

### run.gpx Prerequisites

Build the gpx-studio SvelteKit frontend before starting the dev server:

```bash
cd apps/run.gpx && ./build-frontend.sh
```

Re-run after pulling changes that update the gpx-studio submodule.

## Build & Release

```bash
# Build and push Docker image to ECR
./apps/build.sh nginx run.auth
./apps/build.sh webapp run.auth

# Bump version (modifies VERSION file in service dir)
./apps/version.sh nginx run.auth
./apps/version.sh webapp run.auth

# Deploy to ECS via Terragrunt
./apps/deploy.sh run.auth use1

# Multi-region parallel release (all apps, all regions)
./apps/release-all.sh --parallel
```

### release-all.sh Options

| Flag | Description |
|------|-------------|
| `--apps <list>` | Comma-separated apps (default: run.auth,run.human,run.cms,run.gpx) |
| `--regions <list>` | Comma-separated regions (default: use1) |
| `--parallel` | Run regional builds in parallel |
| `--pr` | Create PR after pushing (implies --push, auto-merge by default) |
| `--no-merge` | Don't auto-merge PR (use with --pr) |
| `--push` | Push the release branch after committing |
| `--no-branch` | Don't create release branch |
| `--with-terragrunt` | Run terragrunt apply after build |
| `--skip-bump` | Skip version bumping |
| `--skip-build` | Skip building images |
| `--skip-nginx` | Skip nginx container builds |

### Release Flow with --pr

```
release-all.sh --pr
  1. Create release branch (release/YYYY-MM-DD-HHMMSS)
  2. Bump VERSION files (app + terraform)
  3. Commit all VERSION files
  4. Push branch, create PR
  5. Build images, push to ECR
  6. Auto-merge PR (squash, delete branch)
```

## Infrastructure

```bash
# ConfigUI (Go web UI for infrastructure config)
cd apps/local/configui && go build -o configui . && ./configui

# Terragrunt — plan all modules
cd infra/terraform/live/site && terragrunt run-all plan

# Terragrunt — apply all modules
cd infra/terraform/live/site && terragrunt run-all apply --non-interactive -- -auto-approve

# Single module
cd infra/terraform/live/site/region/us-east-1/ecs-service
terragrunt plan
terragrunt apply --non-interactive -- -auto-approve
```

State management: S3 bucket + DynamoDB locking table per region.

## E2E Testing

```bash
cd apps/run.auth/e2e
npm install
npx playwright install chromium
npm test              # All tests
npm run test:headed   # With browser visible
```

Requires AWS credentials for S3 email retrieval during auth flow tests.

## Planning (GSD)

GSD planning runs as Claude Code slash commands; phase state lives under `.planning/`.

```
/gsd:progress        # Check progress and route to the next action
/gsd:plan-phase      # Plan the next phase before building
/gsd:execute-phase   # Execute the planned work
/gsd:add-todo        # Capture a follow-up task
```
