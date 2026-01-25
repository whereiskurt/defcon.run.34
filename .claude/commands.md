# Common Commands

Quick reference for development and deployment commands.

## Local Development

### VS Code Tasks (Auto-Start)

VS Code tasks in `.vscode/tasks.json` auto-start when the folder opens:

| Service | Port | Command | Notes |
|---------|------|---------|-------|
| **Local: DynamoDB** | 8000 | `cd apps/local/dynamodb && docker compose up` | Local infra |
| **Local: S3 (MinIO)** | 9000 | `cd apps/local/s3 && docker compose up` | Local infra |
| **run.human** | 3001 | `cd apps/run.human/webapp && PORT=3001 npm run dev` | Main app |
| **run.auth** | 3002 | `cd apps/run.auth/webapp && PORT=3002 npm run dev` | Auth service |
| **run.gpx** | 3003 | `cd apps/run.gpx/webapp && PORT=3003 npm run dev` | GPX editor |
| **run.cms** | 1337 | `cd apps/run.cms/app && PORT=1337 npm run develop` | Strapi CMS |

### run.gpx Prerequisites

**Important:** Before running the run.gpx dev server, you must build the gpx-studio frontend:

```bash
cd apps/run.gpx
./build-frontend.sh
```

This script:
1. Initializes the gpx-studio git submodule
2. Creates patched files (cloud-sync.ts, auth store)
3. Installs dependencies for both gpx library and website
4. Builds SvelteKit app with `BASE_PATH=/studio`
5. Copies output to `webapp/public/studio/`

Run this again after pulling changes that update the gpx-studio submodule.

### Manual Commands

```bash
# Run webapp in development mode

PORT=1337 npm run develop  # CMS (from apps/run.cms/app)
PORT=3001 npm run dev      # run.human (from apps/run.human/webapp)
PORT=3002 npm run dev      # run.auth (from apps/run.auth/webapp)
PORT=3003 npm run dev      # run.gpx (from apps/run.gpx/webapp)

npm run build

# Build Docker image and push to ECR
./apps/build.sh nginx run.auth     # or run.human
./apps/build.sh webapp run.auth    # or run.human

# Bump version (modifies VERSION file)
./apps/version.sh nginx run.auth
./apps/version.sh webapp run.auth

# Full release for single app (single region)
./apps/release.sh run.auth

# Multi-region release (both apps, both regions)
./apps/release-all.sh
./apps/release-all.sh --apps run.auth --regions use1
./apps/release-all.sh --parallel                       # Faster parallel builds
./apps/release-all.sh --skip-bump --skip-build         # Deploy only

# Release with PR and auto-merge (recommended)
./apps/release-all.sh --pr                    # Create PR, build, auto-merge
./apps/release-all.sh --pr --no-merge         # Create PR but don't auto-merge
./apps/release-all.sh --pr --with-terragrunt  # Full release with infra deploy
```

### release-all.sh Options

| Flag | Description |
|------|-------------|
| `--apps <list>` | Comma-separated apps (default: run.auth,run.human,run.cms,run.gpx) |
| `--regions <list>` | Comma-separated regions (default: use1) |
| `--pr` | Create PR after pushing (implies --push, auto-merge by default) |
| `--no-merge` | Don't auto-merge PR after builds (use with --pr) |
| `--push` | Push the release branch after committing |
| `--no-branch` | Don't create release branch (commit to current branch) |
| `--parallel` | Run regional builds in parallel |
| `--with-terragrunt` | Run terragrunt apply after build |
| `--skip-bump` | Skip version bumping |
| `--skip-build` | Skip building images |
| `--skip-nginx` | Skip nginx container builds |

### Release Flow with --pr

```
./release-all.sh --pr
    │
    ├─ 1. Create release branch (release/YYYY-MM-DD-HHMMSS)
    ├─ 2. Bump VERSION files (app + terraform)
    ├─ 3. Commit all VERSION files in single commit
    ├─ 4. Push branch, create PR
    ├─ 5. Build images → push to ECR
    ├─ 6. Auto-merge PR (squash, delete branch)
    │
    └─ If infra/ changed:
       ├─ 7. Terragrunt Apply workflow triggers
       ├─ 8. Approve in GitHub Actions (terraform-apply environment)
       └─ 9. terragrunt apply runs
```

## Infrastructure

```bash
# From infra/terraform/live/site/
terragrunt plan
terragrunt apply --all --non-interactive -- -auto-approve

# Single module
cd infra/terraform/live/site/region/us-east-1/ecs-service
terragrunt plan
terragrunt apply --non-interactive -- -auto-approve
```

## Issue Tracking (bd/beads)

```bash
# Finding work
bd ready                        # Find unblocked work
bd list --status=open           # List open issues
bd list --status=in_progress    # Your active work
bd show <id>                    # View issue details
bd blocked                      # Show blocked issues

# Creating & updating
bd create --title="..." --type=task|bug|feature --priority=2
bd update <id> --status=in_progress   # Claim work
bd close <id>                   # Complete work
bd close <id1> <id2> ...        # Close multiple issues

# Dependencies
bd dep add <issue> <depends-on> # Add dependency

# Sync
bd sync                         # Sync with git (run at session end)
bd stats                        # Project statistics
```

Priority values: 0-4 or P0-P4 (0=critical, 2=medium, 4=backlog). NOT "high"/"medium"/"low".

## Issue Visualization (bv)

```bash
bv                          # Launch interactive TUI
bv --robot-triage           # Output unified triage as JSON for AI agents
bv --robot-next             # Get top pick recommendation
bv --robot-plan             # Get dependency-respecting execution plan
bv --search "query"         # Semantic search
bv --export-graph .html     # Export interactive dependency graph
```

## OpenSpec

```bash
# Essential commands
openspec list                  # List active changes
openspec list --specs          # List specifications
openspec show [item]           # Display change or spec
openspec validate [item]       # Validate changes or specs
openspec archive <change-id> [--yes|-y]   # Archive after deployment

# Project management
openspec init [path]           # Initialize OpenSpec
openspec update [path]         # Update instruction files

# Debugging
openspec show [change] --json --deltas-only
openspec validate [change] --strict
```
