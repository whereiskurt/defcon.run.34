# Issue Tracking with bd/beads

This project uses **bd (beads)** for issue tracking with first-class dependency support.

Run `bd prime` for workflow context, or install hooks (`bd hooks install`) for auto-injection.

## Quick Reference

### Finding Work

```bash
bd ready                        # Find unblocked work
bd list --status=open           # List open issues
bd list --status=in_progress    # Your active work
bd show <id>                    # View issue details
bd blocked                      # Show blocked issues
```

### Creating & Updating

```bash
bd create --title="..." --type=task|bug|feature --priority=2
bd update <id> --status=in_progress   # Claim work
bd close <id>                   # Complete work
bd close <id1> <id2> ...        # Close multiple issues
```

### Dependencies

```bash
bd dep add <issue> <depends-on> # Add dependency
```

### Sync

```bash
bd sync                         # Sync with git (run at session end)
bd stats                        # Project statistics
```

## Priority Values

Use 0-4 or P0-P4:
- **0 (P0)** - Critical
- **1 (P1)** - High
- **2 (P2)** - Medium (default)
- **3 (P3)** - Low
- **4 (P4)** - Backlog

Do NOT use "high"/"medium"/"low" strings.

## Common Workflows

### Starting Work

```bash
bd ready                              # Find available work
bd show <id>                          # Review issue details
bd update <id> --status=in_progress   # Claim it
```

### Completing Work

```bash
bd close <id1> <id2> ...              # Close all completed issues
bd sync                               # Push to remote
```

## Issue Visualization (bv)

**bv** is a TUI viewer for the beads issue tracker with AI agent support.

```bash
bv                          # Launch interactive TUI
bv --robot-triage           # Output unified triage as JSON for AI agents
bv --robot-next             # Get top pick recommendation
bv --robot-plan             # Get dependency-respecting execution plan
bv --search "query"         # Semantic search
bv --export-graph .html     # Export interactive dependency graph
```
