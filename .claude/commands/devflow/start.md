---
name: "Devflow: Start"
description: Start a development session with optional worktree isolation for parallel Claude instances.
category: Devflow
tags: [devflow, workflow, session, start, worktree]
---
<!-- DEVFLOW:START -->
**Purpose**
Begin a development session with proper context gathering. Optionally use worktree isolation to enable multiple Claude instances to work in parallel on the same feature branch.

**Worktree Structure** (when using worktrees)
```
~/working/wt/
├── <feature-name>/                 # Feature branch worktree (merge target)
├── <feature-name>-wt-<timestamp>/  # Claude 1's work worktree
└── <feature-name>-wt-<timestamp>/  # Claude 2's work worktree
```

**Guardrails**
- Never work directly on main branch
- Never start coding before gathering context
- Check for existing tracked work before creating new items
- Always prompt user to confirm/customize branch and worktree names

**Steps**

### 1. Detect Current State

```bash
# Get repo info
REPO_NAME=$(basename $(git rev-parse --show-toplevel))
REPO_ROOT=$(git rev-parse --show-toplevel)
CURRENT_BRANCH=$(git branch --show-current)
WORKTREE_BASE=~/working/wt

# Check if already in a worktree
GIT_COMMON=$(git rev-parse --git-common-dir)
GIT_DIR=$(git rev-parse --git-dir)
if [ "$GIT_COMMON" != "$GIT_DIR" ]; then
  IN_WORKTREE=true
  MAIN_REPO=$(dirname $(dirname $GIT_COMMON))
else
  IN_WORKTREE=false
  MAIN_REPO=$REPO_ROOT
fi

# List existing worktrees
git worktree list
```

### 2. Prompt: Use Worktree or Not?

Use `AskUserQuestion` to determine workflow:

**Question:** "Do you want to use worktree isolation for this session?"
- **Yes, use worktrees** - Enables parallel Claude instances, isolated environment
- **No, simple branch** - Just create/checkout a feature branch in main repo

### 3. Get Memory Context (for non-trivial tasks)

```bash
cm context "<task description>"
```

### 4. Check Existing Work

```bash
bd ready --json          # Find unblocked tracked work
openspec list            # Check active change proposals
openspec list --specs    # Review existing capabilities
```

---

## Flow A: Simple Branch (No Worktree)

### A1. Prompt for Branch Name

Generate a suggested branch name based on task:
- For features: `feature/<task-slug>`
- For fixes: `fix/<task-slug>`

Use `AskUserQuestion`:
**Question:** "Branch name?"
- **Suggested:** `feature/<suggested-name>` (Recommended)
- **Custom** - Let user provide their own

### A2. Create and Checkout Branch

```bash
FEATURE_BRANCH="<user-confirmed-name>"

# If on main, create new branch
if [ "$CURRENT_BRANCH" = "main" ]; then
  git checkout -b $FEATURE_BRANCH
else
  # Already on a feature branch, confirm or switch
  echo "Currently on: $CURRENT_BRANCH"
fi
```

### A3. Ready to Work

```bash
echo "Ready to work on branch: $(git branch --show-current)"
```

---

## Flow B: Worktree Isolation

### B1. Prompt for Branch and Worktree Names

Generate suggestions:
- **Feature branch:** `feature/<task-slug>`
- **Worktree name:** `<feature-slug>-wt-$(date +%s)`

Use `AskUserQuestion` for each:

**Question 1:** "Feature branch name?"
- **Suggested:** `feature/<suggested-name>` (Recommended)
- **Custom** - Let user provide their own

**Question 2:** "Work worktree name?"
- **Suggested:** `<feature>-wt-<timestamp>` (Recommended)
- **Custom** - Let user provide their own

### B2. Create Worktree Structure

**If on main branch:**
```bash
FEATURE_BRANCH="<user-confirmed-feature-branch>"
WORK_BRANCH="<user-confirmed-worktree-name>"

# Create feature branch (without checking it out)
git branch $FEATURE_BRANCH main 2>/dev/null || echo "Branch exists"

# Create worktree directory
mkdir -p $WORKTREE_BASE

# Create feature worktree (merge target)
git worktree add $WORKTREE_BASE/$FEATURE_BRANCH $FEATURE_BRANCH 2>/dev/null || echo "Feature worktree exists"

# Create work worktree
git worktree add -b $WORK_BRANCH $WORKTREE_BASE/$WORK_BRANCH $FEATURE_BRANCH
```

**If on feature branch (not in worktree):**
```bash
FEATURE_BRANCH=$CURRENT_BRANCH
WORK_BRANCH="<user-confirmed-worktree-name>"

# Create work worktree from current feature branch
git worktree add -b $WORK_BRANCH $WORKTREE_BASE/$WORK_BRANCH $FEATURE_BRANCH
```

**If already in worktree with -wt- in name:**
```bash
echo "Already in work worktree. Ready to work."
git branch --show-current
# Skip to step B4
```

### B3. Copy Environment Files

Copy .env files from main repo to the new worktree:

```bash
WORKTREE_PATH="$WORKTREE_BASE/$WORK_BRANCH"

# run.auth webapp .env files
cp "$MAIN_REPO/apps/run.auth/webapp/.env" "$WORKTREE_PATH/apps/run.auth/webapp/.env" 2>/dev/null || true
cp "$MAIN_REPO/apps/run.auth/webapp/.env.local" "$WORKTREE_PATH/apps/run.auth/webapp/.env.local" 2>/dev/null || true

# run.human webapp .env
cp "$MAIN_REPO/apps/run.human/webapp/.env" "$WORKTREE_PATH/apps/run.human/webapp/.env" 2>/dev/null || true

# run.gpx webapp .env
cp "$MAIN_REPO/apps/run.gpx/webapp/.env" "$WORKTREE_PATH/apps/run.gpx/webapp/.env" 2>/dev/null || true

# run.cms app .env
cp "$MAIN_REPO/apps/run.cms/app/.env" "$WORKTREE_PATH/apps/run.cms/app/.env" 2>/dev/null || true

echo "Copied .env files to worktree"
```

### B4. Change to Worktree

```bash
echo "cd $WORKTREE_BASE/$WORK_BRANCH"
```

---

### 5. Track with Beads (if needed)

```bash
bd create --title="<task>" --type=task|bug|feature --priority=2
bd update <id> --status=in_progress
```

**Decision Tree**
```
Start Session
│
├─ Use worktree? → NO
│   └─ Prompt for branch name (with suggestion)
│       └─ Create/checkout branch
│           └─ Ready to work
│
└─ Use worktree? → YES
    ├─ Already in -wt- worktree?
    │   └─ Ready to work
    │
    └─ Not in work worktree
        └─ Prompt for feature branch name (with suggestion)
            └─ Prompt for worktree name (with suggestion)
                └─ Create worktree structure
                    └─ Copy .env files
                        └─ cd to worktree
```

**Output**
After running this skill, you should:
- Have context from cm (rules, anti-patterns)
- Be working in either a feature branch or isolated work worktree
- Know what branch/worktree you're on
- Have .env files copied (if using worktree)
- Have beads tracking if appropriate

**Quick Reference**
```bash
# See all worktrees
git worktree list

# See worktrees for current feature
git worktree list | grep "<feature-name>"

# Get back to main repo
cd $MAIN_REPO
```

**Reference**
- `.claude/cass.md` - Memory system
- `.claude/beads.md` - Issue tracking
- `.claude/openspec.md` - Proposal guidelines
- `git worktree --help` - Git worktree documentation
<!-- DEVFLOW:END -->
