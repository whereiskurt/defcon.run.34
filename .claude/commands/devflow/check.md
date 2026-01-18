---
name: "Devflow: Check"
description: Mid-session workflow and worktree compliance check.
category: Devflow
tags: [devflow, workflow, check, compliance, worktree]
---
<!-- DEVFLOW:START -->
**Purpose**
Perform a mid-session audit to ensure you're following the worktree-based development process. Run this when unsure if you're on track, or before any significant milestone.

**Guardrails**
- Be honest about compliance gaps
- Don't skip steps to "catch up"
- Fix issues before continuing

**Checklist - Run All**

### 1. Worktree State Check

```bash
CURRENT_BRANCH=$(git branch --show-current)
REPO_NAME=$(basename $(git rev-parse --show-toplevel))
WORKTREE_BASE=~/working/worktrees/$REPO_NAME

# Check if in a worktree
GIT_COMMON=$(git rev-parse --git-common-dir)
GIT_DIR=$(git rev-parse --git-dir)

if [ "$GIT_COMMON" != "$GIT_DIR" ]; then
  IN_WORKTREE=true
else
  IN_WORKTREE=false
fi

echo "Current branch: $CURRENT_BRANCH"
echo "In worktree: $IN_WORKTREE"

# Check if it's a work worktree (has -wt-)
if [[ "$CURRENT_BRANCH" == *"-wt-"* ]]; then
  echo "Type: Work worktree ✓"
  FEATURE_BRANCH="${CURRENT_BRANCH%-wt-*}"
  echo "Feature branch: $FEATURE_BRANCH"
elif [ "$CURRENT_BRANCH" == "main" ]; then
  echo "Type: Main branch ⚠️"
  echo "WARNING: Should be in a work worktree. Run /devflow:start"
else
  echo "Type: Feature branch (not work worktree) ⚠️"
  echo "WARNING: Should be in a work worktree. Run /devflow:start"
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
# If in work worktree, check if feature branch exists and is accessible
if [[ "$CURRENT_BRANCH" == *"-wt-"* ]]; then
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
Type: [Work Worktree ✓ | Feature Branch ⚠️ | Main ⚠️]
Feature: <feature-branch> (if applicable)

Worktrees:
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
| On main branch | `/devflow:start` to create worktrees |
| On feature branch directly | `/devflow:start` to create work worktree |
| Feature worktree missing | Recreate with `git worktree add` |
| .beads/ staged | `git reset HEAD .beads/` |
| Beads out of sync | `bd sync` |
| No memory context | `cm context "<task>"` |

**Reference**
- `/devflow:start` - Create proper worktree setup
- `/devflow:close` - Merge and close workflow
- `/devflow:status` - Detailed worktree overview
- `.claude/beads.md` - Sync protocol
<!-- DEVFLOW:END -->
