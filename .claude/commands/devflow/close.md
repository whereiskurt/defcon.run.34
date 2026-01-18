---
name: "Devflow: Close"
description: Close a worktree session - merge back to feature branch and check for PR readiness.
category: Devflow
tags: [devflow, workflow, session, close, worktree, merge]
---
<!-- DEVFLOW:START -->
**Purpose**
Complete a work worktree session by merging changes back to the feature branch. Only prompt for PR creation when ALL worktrees for the feature have been merged.

**Guardrails**
- NEVER skip the merge-back step
- NEVER delete work branches (keep for history)
- NEVER create PR until all worktrees are merged
- ALWAYS push work branch before merging
- Auto-merge conflicts where possible; prompt user if manual resolution needed

**Session Close Protocol**

### 1. Verify You're in a Work Worktree

```bash
CURRENT_BRANCH=$(git branch --show-current)
REPO_NAME=$(basename $(git rev-parse --show-toplevel))
WORKTREE_BASE=~/working/worktrees/$REPO_NAME

# Must have -wt- in branch name
if [[ ! "$CURRENT_BRANCH" == *"-wt-"* ]]; then
  echo "ERROR: Not in a work worktree. Current branch: $CURRENT_BRANCH"
  echo "Run /devflow:start to create a work worktree first."
  exit 1
fi

# Extract feature branch name (everything before -wt-)
FEATURE_BRANCH="${CURRENT_BRANCH%-wt-*}"
WORK_BRANCH="$CURRENT_BRANCH"
WORK_WORKTREE_PATH=$(pwd)
FEATURE_WORKTREE_PATH="$WORKTREE_BASE/$FEATURE_BRANCH"

echo "Work branch: $WORK_BRANCH"
echo "Feature branch: $FEATURE_BRANCH"
```

### 2. Commit Changes in Work Worktree

```bash
# Check status
git status

# Stage changes (exclude .beads/)
git add -A
git reset HEAD .beads/ 2>/dev/null || true

# Commit
git commit -m "$(cat <<'EOF'
<descriptive message>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

### 3. Sync Beads

```bash
bd sync --from-main
```

### 4. Push Work Branch to Remote

```bash
git push -u origin $WORK_BRANCH
```

### 5. Merge into Feature Branch

```bash
# Go to feature worktree
cd $FEATURE_WORKTREE_PATH

# Verify we're on the feature branch
if [ "$(git branch --show-current)" != "$FEATURE_BRANCH" ]; then
  echo "ERROR: Feature worktree not on expected branch"
  exit 1
fi

# Pull latest (other Claudes may have merged)
git fetch origin
git pull origin $FEATURE_BRANCH 2>/dev/null || true

# Merge work branch (no-ff to preserve history)
git merge $WORK_BRANCH --no-ff -m "Merge $WORK_BRANCH into $FEATURE_BRANCH"

# If merge conflicts, inform user
if [ $? -ne 0 ]; then
  echo "MERGE CONFLICT: Manual resolution required"
  echo "Resolve conflicts, then run:"
  echo "  git add -A && git commit"
  echo "  git push origin $FEATURE_BRANCH"
  exit 1
fi

# Push feature branch
git push origin $FEATURE_BRANCH
```

### 6. Remove Work Worktree (Keep Branch)

```bash
# Go back to main repo (or anywhere outside the worktree)
cd $(git worktree list | head -1 | awk '{print $1}')

# Remove the worktree (keeps the branch)
git worktree remove $WORK_WORKTREE_PATH

# Do NOT delete the branch - keep for history
# git branch -d $WORK_BRANCH  # SKIP THIS
```

### 7. Final Beads Sync

```bash
bd sync
```

### 8. Check for Remaining Worktrees

```bash
# List all worktrees for this feature
REMAINING=$(git worktree list | grep "${FEATURE_BRANCH}-wt-" | wc -l)

if [ "$REMAINING" -gt 0 ]; then
  echo "=========================================="
  echo "OTHER CLAUDES STILL WORKING"
  echo "=========================================="
  echo "Remaining worktrees for $FEATURE_BRANCH:"
  git worktree list | grep "${FEATURE_BRANCH}-wt-"
  echo ""
  echo "Feature branch updated. PR will be created when all worktrees are merged."
  echo "=========================================="
else
  echo "=========================================="
  echo "ALL WORKTREES MERGED - READY FOR PR"
  echo "=========================================="
  echo "All work has been merged into: $FEATURE_BRANCH"
  echo ""
  echo "Create PR now:"
  echo "  cd $FEATURE_WORKTREE_PATH"
  echo "  gh pr create --base main --head $FEATURE_BRANCH"
  echo ""
  echo "Or from main repo:"
  echo "  gh pr create --base main --head $FEATURE_BRANCH"
  echo "=========================================="
fi
```

### 9. Create PR (Only When All Merged)

Only run this step when Step 8 shows "READY FOR PR":

```bash
cd $FEATURE_WORKTREE_PATH

gh pr create --base main --head $FEATURE_BRANCH --title "<title>" --body "$(cat <<'EOF'
## Summary
- <bullet points of all changes>

## Test plan
- [ ] <testing checklist>

## Worktrees merged
- <list of work branches that were merged>

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**STOP**: Wait for user review and approval before merging PR.

### 10. Memory Reflection (Optional)

```bash
cm reflect --days 1
```

**Complete Workflow Summary**

```
Work Worktree                    Feature Worktree
     │                                  │
     ├── git add/commit                 │
     ├── bd sync                        │
     ├── git push                       │
     │                                  │
     └──────── merge ──────────────────►├── git pull
                                        ├── git merge <work-branch>
                                        ├── git push
                                        │
     ◄─────── remove ──────────────────┤
     (worktree removed,                 │
      branch kept)                      │
                                        │
                              Check remaining worktrees
                                        │
                              ├── More exist? → Wait
                              └── None left? → Create PR
```

**Reference**
- `.claude/best-practices.md` - Branch workflow
- `.claude/beads.md` - Sync protocol
- `.claude/cass.md` - Reflection process
- `git worktree --help` - Git worktree documentation
<!-- DEVFLOW:END -->
