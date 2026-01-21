---
name: "Devflow: Check"
description: Mid-session workflow compliance check for branch or worktree development.
category: Devflow
tags: [devflow, workflow, check, compliance, worktree]
---
<!-- DEVFLOW:START -->
**Purpose**
Perform a mid-session audit to ensure you're following the development workflow. Run this when unsure if you're on track, or before any significant milestone. Works for both simple branch and worktree workflows.

**Guardrails**
- Be honest about compliance gaps
- Don't skip steps to "catch up"
- Fix issues before continuing

**Checklist - Run All**

### 1. Session State Check

```bash
CURRENT_BRANCH=$(git branch --show-current)
REPO_NAME=$(basename $(git rev-parse --show-toplevel))
REPO_ROOT=$(git rev-parse --show-toplevel)
WORKTREE_BASE=~/working/wt

# Check if in a worktree
GIT_COMMON=$(git rev-parse --git-common-dir)
GIT_DIR=$(git rev-parse --git-dir)

if [ "$GIT_COMMON" != "$GIT_DIR" ]; then
  IN_WORKTREE=true
  MAIN_REPO=$(dirname $(dirname $GIT_COMMON))
else
  IN_WORKTREE=false
  MAIN_REPO=$REPO_ROOT
fi

echo "Current branch: $CURRENT_BRANCH"
echo "In worktree: $IN_WORKTREE"

# Determine session type
if [[ "$CURRENT_BRANCH" == *"-wt-"* ]]; then
  echo "Type: Work worktree ✓"
  FEATURE_BRANCH="${CURRENT_BRANCH%-wt-*}"
  echo "Feature branch: $FEATURE_BRANCH"
  SESSION_TYPE="worktree"
elif [ "$CURRENT_BRANCH" == "main" ]; then
  echo "Type: Main branch ⚠️"
  echo "WARNING: Should be on a feature branch. Run /devflow:start"
  SESSION_TYPE="main"
else
  echo "Type: Feature branch ✓"
  echo "Session: Simple branch workflow (no worktree isolation)"
  SESSION_TYPE="branch"
fi
```

### 2. List All Worktrees

```bash
echo "All worktrees for this repo:"
git worktree list

echo ""
echo "Work worktrees (containing -wt-):"
git worktree list | grep "\-wt-" || echo "  (none)"
```

### 3. Changes Check

```bash
git status
git diff --stat
```

- Review what's changed
- Ensure `.beads/` is NOT staged with code changes

### 4. Feature Branch Sync Status

```bash
# Check sync status based on session type
if [ "$SESSION_TYPE" == "worktree" ]; then
  FEATURE_BRANCH="${CURRENT_BRANCH%-wt-*}"
  FEATURE_WORKTREE="$WORKTREE_BASE/$FEATURE_BRANCH"

  if [ -d "$FEATURE_WORKTREE" ]; then
    echo "Feature worktree exists: $FEATURE_WORKTREE ✓"

    # Check if feature branch has remote
    cd $FEATURE_WORKTREE
    git fetch origin 2>/dev/null
    LOCAL=$(git rev-parse $FEATURE_BRANCH 2>/dev/null)
    REMOTE=$(git rev-parse origin/$FEATURE_BRANCH 2>/dev/null)

    if [ "$LOCAL" == "$REMOTE" ]; then
      echo "Feature branch in sync with remote ✓"
    else
      echo "Feature branch diverged from remote ⚠️"
    fi
    cd - > /dev/null
  else
    echo "Feature worktree missing: $FEATURE_WORKTREE ⚠️"
    echo "May need to recreate before merge"
  fi
elif [ "$SESSION_TYPE" == "branch" ]; then
  # Simple branch - check remote sync
  git fetch origin 2>/dev/null
  LOCAL=$(git rev-parse $CURRENT_BRANCH 2>/dev/null)
  REMOTE=$(git rev-parse origin/$CURRENT_BRANCH 2>/dev/null)

  if [ -z "$REMOTE" ]; then
    echo "Branch not pushed to remote yet ⚠️"
  elif [ "$LOCAL" == "$REMOTE" ]; then
    echo "Branch in sync with remote ✓"
  else
    echo "Branch diverged from remote ⚠️"
  fi
fi
```

### 5. Beads Sync Status

```bash
bd sync --status
bd list --status=in_progress --json
```

### 6. OpenSpec Compliance (if applicable)

```bash
# Check if working on an openspec change
openspec list 2>/dev/null

# If working on a change, validate
# openspec validate <change-id> --strict
```

### 7. Memory Context Check

- Are you using rules from `cm context`?
- Have you left `// [cass: helpful|problematic <id>]` comments?

**Compliance Report Format**

```
DEVFLOW CHECK REPORT
====================
Location: <worktree path or main repo>
Branch: <branch-name>
Session Type: [Work Worktree | Simple Branch | Main ⚠️]
Feature: <feature-branch> (if worktree session)

Worktrees: (if any)
- <list all worktrees>

Changes: <N files changed>
Beads: [SYNCED | NEEDS SYNC]
OpenSpec: [N/A | VALID | INVALID]
Memory: [USING RULES | NO CONTEXT]

Issues to Fix:
- <list any issues>

Next Steps:
- <recommendations>
```

**Common Issues & Fixes**

| Issue | Fix |
|-------|-----|
| On main branch | `/devflow:start` to create branch or worktree |
| Feature worktree missing (worktree flow) | Recreate with `git worktree add` |
| .beads/ staged | `git reset HEAD .beads/` |
| Beads out of sync | `bd sync` |
| Branch not pushed | `git push -u origin <branch>` |
| No memory context | `cm context "<task>"` |

**Reference**
- `/devflow:start` - Create proper worktree setup
- `/devflow:close` - Merge and close workflow
- `/devflow:status` - Detailed worktree overview
- `.claude/beads.md` - Sync protocol
<!-- DEVFLOW:END -->
