---
name: "Devflow: Close"
description: Close a development session - handle branch or worktree cleanup and check for PR readiness.
category: Devflow
tags: [devflow, workflow, session, close, worktree, merge]
---
<!-- DEVFLOW:START -->
**Purpose**
Complete a development session by committing changes and preparing for PR. Handles both simple branch and worktree workflows.

**Guardrails**
- NEVER skip commit and push steps
- NEVER delete work branches (keep for history)
- For worktrees: NEVER create PR until all worktrees are merged
- ALWAYS push before merging or creating PR
- Auto-merge conflicts where possible; prompt user if manual resolution needed

**Session Close Protocol**

### 1. Detect Session Type

```bash
CURRENT_BRANCH=$(git branch --show-current)
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

# Check if this is a work worktree (has -wt- in branch name)
if [[ "$CURRENT_BRANCH" == *"-wt-"* ]]; then
  SESSION_TYPE="worktree"
  FEATURE_BRANCH="${CURRENT_BRANCH%-wt-*}"
  WORK_BRANCH="$CURRENT_BRANCH"
  WORK_WORKTREE_PATH=$(pwd)
  FEATURE_WORKTREE_PATH="$WORKTREE_BASE/$FEATURE_BRANCH"
  echo "Session type: WORKTREE"
  echo "Work branch: $WORK_BRANCH"
  echo "Feature branch: $FEATURE_BRANCH"
else
  SESSION_TYPE="branch"
  FEATURE_BRANCH="$CURRENT_BRANCH"
  echo "Session type: SIMPLE BRANCH"
  echo "Branch: $FEATURE_BRANCH"
fi
```

---

## Flow A: Simple Branch (No Worktree)

### A1. Commit Changes

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

### A2. Sync Beads

```bash
bd sync
```

### A3. Push Branch

```bash
git push -u origin $FEATURE_BRANCH
```

### A4. Create PR

```bash
gh pr create --base main --head $FEATURE_BRANCH --title "<title>" --body "$(cat <<'EOF'
## Summary
- <bullet points of changes>

## Test plan
- [ ] <testing checklist>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**STOP**: Wait for user review and approval before merging PR.

### A5. Index and Reflect (Optional)

Use `AskUserQuestion` to prompt:

**Question:** "Index and reflect on this session?"
- **Yes** - Update cass index and run reflection now
- **No, later** - Skip for now (can batch multiple sessions later)

If yes:
```bash
# Update session index first
cass index

# Then reflect (requires ANTHROPIC_API_KEY)
cm reflect --days 1
```

---

## Flow B: Worktree Session

### B1. Commit Changes in Work Worktree

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

### B2. Sync Beads

```bash
bd sync --from-main
```

### B3. Push Work Branch to Remote

```bash
git push -u origin $WORK_BRANCH
```

### B4. Merge into Feature Branch

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

### B5. Remove Work Worktree (Keep Branch)

```bash
# Go back to main repo (or anywhere outside the worktree)
cd $(git worktree list | head -1 | awk '{print $1}')

# Remove the worktree (keeps the branch)
git worktree remove $WORK_WORKTREE_PATH

# Do NOT delete the branch - keep for history
# git branch -d $WORK_BRANCH  # SKIP THIS
```

### B6. Final Beads Sync

```bash
bd sync
```

### B7. Check for Remaining Worktrees

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

### B8. Create PR (Only When All Merged)

Only run this step when Step B7 shows "READY FOR PR":

```bash
cd $FEATURE_WORKTREE_PATH

gh pr create --base main --head $FEATURE_BRANCH --title "<title>" --body "$(cat <<'EOF'
## Summary
- <bullet points of all changes>

## Test plan
- [ ] <testing checklist>

## Worktrees merged
- <list of work branches that were merged>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**STOP**: Wait for user review and approval before merging PR.

### B9. Index and Reflect (Optional)

Use `AskUserQuestion` to prompt:

**Question:** "Index and reflect on this session?"
- **Yes** - Update cass index and run reflection now
- **No, later** - Skip for now (can batch multiple sessions later)

If yes:
```bash
# Update session index first
cass index

# Then reflect (requires ANTHROPIC_API_KEY)
cm reflect --days 1
```

---

**Decision Tree**

```
Close Session
│
├─ Detect session type
│
├─ SIMPLE BRANCH (no -wt- in name)
│   └─ Commit → Sync beads → Push → Create PR
│       └─ Prompt: Index & reflect? (Yes/No, later)
│
└─ WORKTREE (has -wt- in name)
    └─ Commit → Sync beads → Push work branch
        └─ Merge into feature branch
            └─ Remove worktree (keep branch)
                └─ Check remaining worktrees
                    ├─ More exist? → Wait for others
                    └─ None left? → Create PR
                        └─ Prompt: Index & reflect? (Yes/No, later)
```

**Complete Worktree Workflow Summary**

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
