---
name: "Devflow: Status"
description: Show detailed worktree status across all features and Claude instances.
category: Devflow
tags: [devflow, workflow, status, worktree, overview]
---
<!-- DEVFLOW:START -->
**Purpose**
Get a comprehensive view of all worktrees, feature branches, and their merge status. Use this to understand what work is in progress across multiple Claude instances.

**Steps**

### 1. Repository Info

```bash
REPO_NAME=$(basename $(git rev-parse --show-toplevel))
REPO_ROOT=$(git rev-parse --show-toplevel)
WORKTREE_BASE=~/working/worktrees/$REPO_NAME
CURRENT_BRANCH=$(git branch --show-current)

echo "Repository: $REPO_NAME"
echo "Main repo: $REPO_ROOT"
echo "Worktree base: $WORKTREE_BASE"
echo "Current branch: $CURRENT_BRANCH"
echo ""
```

### 2. All Worktrees

```bash
echo "=========================================="
echo "ALL WORKTREES"
echo "=========================================="
git worktree list
echo ""
```

### 3. Feature Branches Analysis

```bash
echo "=========================================="
echo "FEATURE BRANCHES"
echo "=========================================="

# Find all feature branches (local and remote)
echo "Local feature branches:"
git branch | grep -E "feature/|fix/" | sed 's/^../  /'

echo ""
echo "Remote feature branches:"
git branch -r | grep -E "feature/|fix/" | sed 's/^../  /'
echo ""
```

### 4. Work Worktrees by Feature

```bash
echo "=========================================="
echo "WORK WORKTREES BY FEATURE"
echo "=========================================="

# Get unique feature branches from worktrees
FEATURES=$(git worktree list | grep -oE "(feature|fix)/[^-]+-wt-" | sed 's/-wt-$//' | sort -u)

if [ -z "$FEATURES" ]; then
  echo "No active work worktrees found."
else
  for FEATURE in $FEATURES; do
    echo ""
    echo "Feature: $FEATURE"
    echo "  Work worktrees:"
    git worktree list | grep "${FEATURE}-wt-" | while read line; do
      PATH_PART=$(echo "$line" | awk '{print $1}')
      BRANCH_PART=$(echo "$line" | awk '{print $2}')
      echo "    - $BRANCH_PART"
      echo "      Path: $PATH_PART"
    done

    # Check if feature worktree exists
    if git worktree list | grep -q " ${FEATURE} \["; then
      echo "  Feature worktree: ✓ exists"
    else
      echo "  Feature worktree: ⚠️ missing"
    fi

    # Count work worktrees
    COUNT=$(git worktree list | grep "${FEATURE}-wt-" | wc -l | tr -d ' ')
    echo "  Active workers: $COUNT"
  done
fi
echo ""
```

### 5. PR Status

```bash
echo "=========================================="
echo "PULL REQUEST STATUS"
echo "=========================================="

# Check for open PRs for feature branches
gh pr list --state open --json number,title,headRefName,author 2>/dev/null | \
  jq -r '.[] | "PR #\(.number): \(.title)\n  Branch: \(.headRefName)\n  Author: \(.author.login)"' || \
  echo "Unable to fetch PR status (gh not configured or no PRs)"
echo ""
```

### 6. Merge Readiness

```bash
echo "=========================================="
echo "MERGE READINESS"
echo "=========================================="

# For each feature, check if all worktrees are merged
FEATURES=$(git worktree list | grep -oE "(feature|fix)/[^-]+-wt-" | sed 's/-wt-$//' | sort -u)

if [ -z "$FEATURES" ]; then
  echo "No features with active work worktrees."

  # Check for feature branches without worktrees (might be ready for PR)
  echo ""
  echo "Feature branches without work worktrees (may be ready for PR):"
  git branch | grep -E "feature/|fix/" | while read branch; do
    BRANCH=$(echo "$branch" | sed 's/^..//')
    if ! git worktree list | grep -q "${BRANCH}-wt-"; then
      # Check if PR exists
      PR_EXISTS=$(gh pr list --head "$BRANCH" --state open --json number 2>/dev/null | jq length)
      if [ "$PR_EXISTS" == "0" ]; then
        echo "  $BRANCH - No PR yet"
      else
        echo "  $BRANCH - PR exists"
      fi
    fi
  done
else
  for FEATURE in $FEATURES; do
    WORK_COUNT=$(git worktree list | grep "${FEATURE}-wt-" | wc -l | tr -d ' ')
    if [ "$WORK_COUNT" -eq 0 ]; then
      echo "$FEATURE: ✓ Ready for PR (all worktrees merged)"
    else
      echo "$FEATURE: ⏳ $WORK_COUNT work worktree(s) still active"
    fi
  done
fi
echo ""
```

### 7. Quick Actions

```bash
echo "=========================================="
echo "QUICK ACTIONS"
echo "=========================================="
echo "Start new work:        /devflow:start"
echo "Check compliance:      /devflow:check"
echo "Close current work:    /devflow:close"
echo "View this status:      /devflow:status"
echo ""
echo "Manual commands:"
echo "  List worktrees:      git worktree list"
echo "  Remove worktree:     git worktree remove <path>"
echo "  Create PR:           gh pr create --base main --head <feature>"
echo "=========================================="
```

**Output Format**

```
Repository: defcon.run.34
Main repo: /Users/khundeck/working/defcon.run.34
Worktree base: ~/working/worktrees/defcon.run.34
Current branch: feature/add-auth-wt-1737200000

==========================================
ALL WORKTREES
==========================================
/Users/khundeck/working/defcon.run.34          abc1234 [main]
~/working/worktrees/.../feature/add-auth       def5678 [feature/add-auth]
~/working/worktrees/.../feature/add-auth-wt-1  ghi9012 [feature/add-auth-wt-1737200000]
~/working/worktrees/.../feature/add-auth-wt-2  jkl3456 [feature/add-auth-wt-1737200001]

==========================================
WORK WORKTREES BY FEATURE
==========================================

Feature: feature/add-auth
  Work worktrees:
    - [feature/add-auth-wt-1737200000]
      Path: ~/working/worktrees/.../feature/add-auth-wt-1737200000
    - [feature/add-auth-wt-1737200001]
      Path: ~/working/worktrees/.../feature/add-auth-wt-1737200001
  Feature worktree: ✓ exists
  Active workers: 2

==========================================
MERGE READINESS
==========================================
feature/add-auth: ⏳ 2 work worktree(s) still active
```

**Reference**
- `/devflow:start` - Create new worktree
- `/devflow:close` - Merge and close worktree
- `/devflow:check` - Compliance check
- `git worktree --help` - Git documentation
<!-- DEVFLOW:END -->
