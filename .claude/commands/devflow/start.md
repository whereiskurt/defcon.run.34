---
name: "Devflow: Start"
description: Start a development session with worktree isolation for parallel Claude instances.
category: Devflow
tags: [devflow, workflow, session, start, worktree]
---
<!-- DEVFLOW:START -->
**Purpose**
Begin a development session with proper context gathering and worktree isolation. This enables multiple Claude instances to work in parallel on the same feature branch, each in their own worktree.

**Worktree Structure**
```
~/working/worktrees/<repo-name>/
├── <feature-name>/                 # Feature branch worktree (merge target)
├── <feature-name>-wt-<timestamp>/  # Claude 1's work worktree
└── <feature-name>-wt-<timestamp>/  # Claude 2's work worktree
```

**Guardrails**
- Never work directly on main or the feature branch - always use a work worktree
- Never start coding before gathering context
- Check for existing tracked work before creating new items
- Prompt user to confirm/customize worktree branch name

**Steps**

### 1. Detect Current State

```bash
# Get repo info
REPO_NAME=$(basename $(git rev-parse --show-toplevel))
REPO_ROOT=$(git rev-parse --show-toplevel)
CURRENT_BRANCH=$(git branch --show-current)
WORKTREE_BASE=~/working/worktrees/$REPO_NAME

# Check if in a worktree
GIT_COMMON=$(git rev-parse --git-common-dir)
GIT_DIR=$(git rev-parse --git-dir)
if [ "$GIT_COMMON" != "$GIT_DIR" ]; then
  IN_WORKTREE=true
  # Get the main repo path
  MAIN_REPO=$(dirname $(dirname $GIT_COMMON))
else
  IN_WORKTREE=false
  MAIN_REPO=$REPO_ROOT
fi

# List existing worktrees
git worktree list
```

### 2. Get Memory Context (for non-trivial tasks)

```bash
cm context "<task description>"
```

### 3. Check Existing Work

```bash
bd ready --json          # Find unblocked tracked work
openspec list            # Check active change proposals
openspec list --specs    # Review existing capabilities
```

### 4. Create Worktree Based on State

**State A: On main branch (not in worktree)**
```bash
# Prompt user for feature branch name
# Suggest: feature/<task-name> or fix/<task-name>
FEATURE_BRANCH="feature/<name>"

# Create feature branch (without checking it out)
git branch $FEATURE_BRANCH main

# Create worktree directory
mkdir -p $WORKTREE_BASE

# Create feature worktree (for merging later)
git worktree add $WORKTREE_BASE/$FEATURE_BRANCH $FEATURE_BRANCH

# Generate work branch name
WT_ID=$(date +%s)
WORK_BRANCH="${FEATURE_BRANCH}-wt-${WT_ID}"

# Prompt: "Work branch will be: $WORK_BRANCH - customize? [Enter to accept]"

# Create work worktree
git worktree add -b $WORK_BRANCH $WORKTREE_BASE/$WORK_BRANCH $FEATURE_BRANCH

# Inform user to cd into worktree
echo "cd $WORKTREE_BASE/$WORK_BRANCH"
```

**State B: On feature branch (not in worktree)**
```bash
FEATURE_BRANCH=$CURRENT_BRANCH

# Ensure feature worktree exists
if [ ! -d "$WORKTREE_BASE/$FEATURE_BRANCH" ]; then
  # Can't create - branch is checked out here. Need to handle this.
  echo "Feature branch checked out in main repo. Creating work worktree from here."
fi

# Generate work branch name
WT_ID=$(date +%s)
WORK_BRANCH="${FEATURE_BRANCH}-wt-${WT_ID}"

# Prompt for customization

# Create work worktree
git worktree add -b $WORK_BRANCH $WORKTREE_BASE/$WORK_BRANCH $FEATURE_BRANCH

echo "cd $WORKTREE_BASE/$WORK_BRANCH"
```

**State C: Already in a work worktree (-wt- in branch name)**
```bash
# Already set up - just work
echo "Already in work worktree. Ready to work."
git branch --show-current
```

**State D: In feature worktree (no -wt- in branch name, but in worktree)**
```bash
FEATURE_BRANCH=$CURRENT_BRANCH

# Generate work branch name
WT_ID=$(date +%s)
WORK_BRANCH="${FEATURE_BRANCH}-wt-${WT_ID}"

# Prompt for customization

# Create work worktree from here
git worktree add -b $WORK_BRANCH $WORKTREE_BASE/$WORK_BRANCH $FEATURE_BRANCH

echo "cd $WORKTREE_BASE/$WORK_BRANCH"
```

### 5. Track with Beads (if needed)

```bash
bd create --title="<task>" --type=task|bug|feature --priority=2
bd update <id> --status=in_progress
```

**Decision Tree**
```
Where am I?
├─ Main branch (main repo)
│   → Create feature branch + feature worktree + work worktree
│   → cd to work worktree
│
├─ Feature branch (main repo)
│   → Create work worktree
│   → cd to work worktree
│
├─ Feature worktree (no -wt-)
│   → Create work worktree
│   → cd to work worktree
│
└─ Work worktree (has -wt-)
    → Already set up, just work
```

**Output**
After running this skill, you should:
- Have context from cm (rules, anti-patterns)
- Be working in an isolated work worktree
- Know the feature branch this will merge into
- Have beads tracking if appropriate

**Quick Reference**
```bash
# See all worktrees
git worktree list

# See worktrees for current feature
git worktree list | grep "<feature-name>"

# Get back to main repo
cd $REPO_ROOT
```

**Reference**
- `.claude/cass.md` - Memory system
- `.claude/beads.md` - Issue tracking
- `.claude/openspec.md` - Proposal guidelines
- `git worktree --help` - Git worktree documentation
<!-- DEVFLOW:END -->
