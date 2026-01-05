# Common Commands

Quick reference for development and deployment commands.

## Application Development

```bash
# Run webapp in development mode (from apps/run.auth/webapp or apps/run.human/webapp)

POST=1337 npm run dev #CMS
POST=3001 npm run dev #run.human
POST=3002 npm run dev #run.auth

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
