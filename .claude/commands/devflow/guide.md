---
name: "Devflow: Guide"
description: Expert developer guide for AGENTS.md workflow with parallel worktree support.
category: Devflow
tags: [devflow, workflow, guide, agents, worktree]
---
<!-- DEVFLOW:START -->
**Purpose**
This is your expert guide for following the AGENTS.md development workflow with support for multiple parallel Claude instances using git worktrees.

**The Devflow Skills**

| Skill | When to Use | What It Does |
|-------|-------------|--------------|
| `/devflow:start` | Beginning a task | Context gathering, worktree creation |
| `/devflow:check` | Mid-session | Workflow and worktree compliance audit |
| `/devflow:close` | Finishing work | Merge worktree to feature branch |
| `/devflow:status` | Anytime | Overview of all worktrees and features |

**Worktree Architecture**

```
Main Repo (stays on main)
│
└── ~/working/worktrees/<repo>/
    ├── feature/add-auth/              # Feature worktree (merge target)
    ├── feature/add-auth-wt-1234567/   # Claude 1's work worktree
    └── feature/add-auth-wt-8901234/   # Claude 2's work worktree
```

**Branch Hierarchy**
```
main
└── feature/add-auth                   # Shared feature branch
    ├── feature/add-auth-wt-1234567    # Claude 1's work (merges back)
    └── feature/add-auth-wt-8901234    # Claude 2's work (merges back)
```

**The Multi-Claude Lifecycle**

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLAUDE 1                           CLAUDE 2                        │
│  /devflow:start                     /devflow:start                  │
│      │                                  │                           │
│      ▼                                  ▼                           │
│  Creates feature branch             Detects feature exists          │
│  Creates feature worktree           Creates work worktree           │
│  Creates work worktree                  │                           │
│      │                                  │                           │
│      ▼                                  ▼                           │
│  ┌─────────────────┐              ┌─────────────────┐               │
│  │ Work in         │              │ Work in         │               │
│  │ wt-1234567      │              │ wt-8901234      │               │
│  └────────┬────────┘              └────────┬────────┘               │
│           │                                │                        │
│           ▼                                ▼                        │
│  /devflow:close                    /devflow:close                   │
│      │                                  │                           │
│      ▼                                  ▼                           │
│  Merge to feature/add-auth         Merge to feature/add-auth        │
│  "Other Claudes working"           "All merged - ready for PR"      │
│      │                                  │                           │
│      X (done)                           ▼                           │
│                                    Create PR                        │
│                                    Wait for approval                │
└─────────────────────────────────────────────────────────────────────┘
```

**Start Flow Decision Tree**

```
Where am I?
│
├─ Main branch (main repo)
│   └─ Prompt for feature name
│   └─ git branch feature/<name> main
│   └─ git worktree add ~/working/worktrees/<repo>/feature/<name>
│   └─ git worktree add -b feature/<name>-wt-<ts> ~/working/worktrees/<repo>/feature/<name>-wt-<ts>
│   └─ cd to work worktree
│
├─ Feature branch exists (another Claude started it)
│   └─ git worktree add -b feature/<name>-wt-<ts> ~/working/worktrees/<repo>/feature/<name>-wt-<ts>
│   └─ cd to work worktree
│
├─ In feature worktree (not -wt-)
│   └─ Create work worktree from here
│   └─ cd to work worktree
│
└─ In work worktree (has -wt-)
    └─ Already set up, just work
```

**Close Flow**

```
1. Commit in work worktree
2. Push work branch
3. cd to feature worktree
4. git pull (get other merged work)
5. git merge <work-branch> --no-ff
6. git push feature branch
7. git worktree remove <work-worktree>
8. Check remaining worktrees:
   ├─ More exist → "Others still working"
   └─ None left → "Ready for PR"
```

**Tool Integration**

| Tool | Purpose | When |
|------|---------|------|
| **cm/CASS** | Memory & context | Before complex work |
| **bd/beads** | Issue tracking | Track multi-session work |
| **bv** | Triage | Find ready work |
| **openspec** | Change proposals | New features, breaking changes |
| **git worktree** | Isolation | Always (parallel Claudes) |

**Essential Rules**

1. **Always use work worktrees** - Never work on main or feature branch directly
2. **One work worktree per Claude** - Each instance gets isolated space
3. **Merge via feature worktree** - All work flows through the feature branch
4. **PR only when all merged** - Wait for all worktrees to close
5. **Keep work branches** - Don't delete them (history)
6. **Never auto-merge PRs** - Wait for explicit user approval

**Quick Reference Commands**

```bash
# Session management
/devflow:start       # Begin with proper setup
/devflow:check       # Verify compliance
/devflow:close       # Merge and finish
/devflow:status      # See all worktrees

# Git worktree
git worktree list                    # See all worktrees
git worktree add <path> <branch>     # Create worktree
git worktree remove <path>           # Remove worktree

# Context
cm context "<task>"                  # Get rules before work
cm reflect --days 1                  # Extract learnings after

# Issue tracking
bd ready --json                      # Find available work
bd create --title="..." --type=task  # Create issue
bd close <id>                        # Complete issue
bd sync                              # Sync with remote

# OpenSpec
openspec list                        # Active changes
openspec validate <id> --strict      # Validate proposal
```

**Workflow Summary**

| Phase | First Claude | Subsequent Claudes |
|-------|--------------|-------------------|
| Start | Create feature + worktrees | Join existing feature |
| Work | In isolated worktree | In isolated worktree |
| Close | Merge to feature | Merge to feature |
| PR | If last one, create PR | If last one, create PR |

**Reference**
- `AGENTS.md` - Master reference
- `.claude/openspec.md` - Proposal workflow
- `.claude/beads.md` - Issue tracking
- `.claude/cass.md` - Memory system
- `.claude/best-practices.md` - Code standards
- `git worktree --help` - Git documentation
<!-- DEVFLOW:END -->
