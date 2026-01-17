# Issue Tracking with bd/beads

This project uses **bd (beads)** for issue tracking with first-class dependency support.

Run `bd prime` for workflow context, or install hooks (`bd hooks install`) for auto-injection.

## Quick Reference

### Finding Work

```bash
bd ready --json                        # Find unblocked work
bd list --status=open --json           # List open issues
bd list --status=in_progress --json    # Your active work
bd show <id> --json                    # View issue details
bd blocked --json                      # Show blocked issues
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
bd stats --json                 # Project statistics
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
bd ready --json                       # Find available work
bd show <id> --json                   # Review issue details
bd update <id> --status=in_progress   # Claim it
```

### Completing Work

```bash
bd close <id1> <id2> ...              # Close all completed issues
git checkout -b <branch>              # Create feature branch (if not already on one)
git add <files>                       # Stage code changes (NOT .beads/)
bd sync --from-main                   # Pull beads updates from main
git commit -m "..."                   # Commit code
git push -u origin <branch>           # Push branch to remote
gh pr create                          # Create PR for review
# ^^^ STOP - wait for user review/approval before merging
```

## Issue Visualization (bv)

**bv** is a graph-aware triage engine for Beads projects. Instead of parsing beads.jsonl or hallucinating graph traversal, use robot flags for deterministic, dependency-aware outputs with precomputed metrics (PageRank, betweenness, critical path, cycles, HITS, eigenvector, k-core).

**Scope boundary:** bv handles *what to work on* (triage, priority, planning). For agent-to-agent coordination (messaging, work claiming, file reservations), use [MCP Agent Mail](https://github.com/Dicklesworthstone/mcp_agent_mail).

> **Source:** [github.com/Dicklesworthstone/beads_viewer](https://github.com/Dicklesworthstone/beads_viewer)

### Critical Rule

**Use ONLY `--robot-*` flags. Bare `bv` launches an interactive TUI that blocks your session.**

### The Workflow: Start With Triage

**`bv --robot-triage` is your single entry point.** It returns everything you need in one call:
- `quick_ref`: at-a-glance counts + top 3 picks
- `recommendations`: ranked actionable items with scores, reasons, unblock info
- `quick_wins`: low-effort high-impact items
- `blockers_to_clear`: items that unblock the most downstream work
- `project_health`: status/type/priority distributions, graph metrics
- `commands`: copy-paste shell commands for next steps

```bash
bv --robot-triage        # THE MEGA-COMMAND: start here
bv --robot-next          # Minimal: just the single top pick + claim command
```

### Command Reference

#### Planning

| Command | Returns |
|---------|---------|
| `--robot-plan` | Parallel execution tracks with `unblocks` lists |
| `--robot-priority` | Priority misalignment detection with confidence |

#### Graph Analysis

| Command | Returns |
|---------|---------|
| `--robot-insights` | Full metrics: PageRank, betweenness, HITS (hubs/authorities), eigenvector, critical path, cycles, k-core, articulation points, slack |
| `--robot-label-health` | Per-label health: `health_level` (healthy\|warning\|critical), `velocity_score`, `staleness`, `blocked_count` |
| `--robot-label-flow` | Cross-label dependency: `flow_matrix`, `dependencies`, `bottleneck_labels` |
| `--robot-label-attention [--attention-limit=N]` | Attention-ranked labels by: (pagerank × staleness × block_impact) / velocity |

#### History & Change Tracking

| Command | Returns |
|---------|---------|
| `--robot-history` | Bead-to-commit correlations: `stats`, `histories` (per-bead events/commits/milestones), `commit_index` |
| `--robot-diff --diff-since <ref>` | Changes since ref: new/closed/modified issues, cycles introduced/resolved |

#### Other Commands

| Command | Returns |
|---------|---------|
| `--robot-burndown <sprint>` | Sprint burndown, scope changes, at-risk items |
| `--robot-forecast <id\|all>` | ETA predictions with dependency-aware scheduling |
| `--robot-alerts` | Stale issues, blocking cascades, priority mismatches |
| `--robot-suggest` | Hygiene: duplicates, missing deps, label suggestions, cycle breaks |
| `--robot-graph [--graph-format=json\|dot\|mermaid]` | Dependency graph export |
| `--export-graph <file.html>` | Self-contained interactive HTML visualization |
| `--search "query"` | Semantic search |

### Scoping & Filtering

```bash
bv --robot-plan --label backend              # Scope to label's subgraph
bv --robot-insights --as-of HEAD~30          # Historical point-in-time
bv --recipe actionable --robot-plan          # Pre-filter: ready to work (no blockers)
bv --recipe high-impact --robot-triage       # Pre-filter: top PageRank scores
bv --robot-triage --robot-triage-by-track    # Group by parallel work streams
bv --robot-triage --robot-triage-by-label    # Group by domain
```

### Understanding Robot Output

**All robot JSON includes:**
- `data_hash` — Fingerprint of source beads.jsonl (verify consistency across calls)
- `status` — Per-metric state: `computed|approx|timeout|skipped` + elapsed ms
- `as_of` / `as_of_commit` — Present when using `--as-of`; contains ref and resolved SHA

**Two-phase analysis:**
- **Phase 1 (instant):** degree, topo sort, density — always available immediately
- **Phase 2 (async, 500ms timeout):** PageRank, betweenness, HITS, eigenvector, cycles — check `status` flags

**For large graphs (>500 nodes):** Some metrics may be approximated or skipped. Always check `status`.

### jq Quick Reference

```bash
bv --robot-triage | jq '.quick_ref'                        # At-a-glance summary
bv --robot-triage | jq '.recommendations[0]'               # Top recommendation
bv --robot-plan | jq '.plan.summary.highest_impact'        # Best unblock target
bv --robot-insights | jq '.status'                         # Check metric readiness
bv --robot-insights | jq '.Cycles'                         # Circular deps (must fix!)
bv --robot-label-health | jq '.results.labels[] | select(.health_level == "critical")'
```

### Performance Notes

- Phase 1 instant, Phase 2 async (500ms timeout)
- Prefer `--robot-plan` over `--robot-insights` when speed matters
- Results cached by data hash

**Use bv instead of parsing beads.jsonl** — it computes PageRank, critical paths, cycles, and parallel tracks deterministically.
