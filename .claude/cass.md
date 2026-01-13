# Memory System with CASS

This project uses **cm** (cass-memory) + **cass** (session search) for persistent learning across sessions.

## Quick Reference

```bash
# Before starting work
cm context "<task description>"    # Get relevant rules and history

# After session (or periodically)
cm reflect --days 7                # Extract rules from recent sessions
```

## Session Workflow

### Starting Work (Feature or Bug)

1. **Get context first**:
   ```bash
   cm context "implement user authentication"
   ```
   Returns: relevant rules, anti-patterns, history snippets

2. **Reference rule IDs** as you work - note which apply

3. **Leave inline feedback** when rules help or hurt:
   ```javascript
   // [cass: helpful b-mkc3xgam-py5vt9] - userId pattern worked
   // [cass: problematic b-xyz] - didn't apply here
   ```

### Ending Session

1. **Run reflection** to capture learnings:
   ```bash
   cm reflect --days 1
   ```

2. **Check new rules**:
   ```bash
   cm ls | head -20
   ```

## When to Use

| Task Type | Get Context? | Reflect After? |
|-----------|--------------|----------------|
| New feature | Yes | Yes |
| Complex bug | Yes | Yes |
| Architecture decision | Yes | Yes |
| Simple typo fix | No | No |
| Config tweak | No | No |

## Detailed Reference

### Context Retrieval

```bash
cm context "<task>"              # Get rules for a task
cm context "<task>" --json       # JSON output for parsing
cm similar "<query>"             # Find similar bullets
```

**What you get:**
- `relevantBullets` - Rules that may help
- `antiPatterns` - Pitfalls to avoid
- `historySnippets` - Past sessions with similar work
- `suggestedCassQueries` - Deeper searches

### Reflection (Learning from Sessions)

```bash
# Process recent sessions
cm reflect --days 7

# Process specific workspace
cm reflect --days 30 --workspace /path/to/project

# Dry run to preview
cm reflect --days 7 --dry-run

# Process specific session
cm reflect --session /path/to/session.jsonl
```

**What reflection produces:**
- **Diary entries** - Per-session summaries in `~/.cass-memory/diary/`
- **Playbook rules** - Generalized patterns in `~/.cass-memory/playbook.yaml`

### Playbook Management

```bash
cm ls                            # List all rules
cm playbook get <id>             # View rule details
cm top 10                        # Most effective rules
cm stale                         # Rules without recent feedback
cm forget <id>                   # Deprecate a rule
cm add "Always use feature branches"  # Manual rule
```

### Session Search (cass)

```bash
cass health                      # Check index status
cass index                       # Refresh index
cass stats                       # Show conversation counts
cass search "terraform" --days 30  # Search past sessions
cass tui                         # Interactive search UI
```

## Storage Locations

| Data | Location | Shared? |
|------|----------|---------|
| Rules (playbook) | `~/.cass-memory/playbook.yaml` | No (user home) |
| Session diaries | `~/.cass-memory/diary/` | No |
| Config | `~/.cass-memory/config.json` | No |
| Session index | `~/Library/Application Support/.../agent_search.db` | No |
| Repo rules | `.cass/playbook.yaml` | Yes (git) |

### Sharing Rules with Team

```bash
# Export your rules to repo
cm playbook export > .cass/playbook.yaml
git add .cass/playbook.yaml
git commit -m "Update shared playbook rules"
```

## Configuration

Edit `~/.cass-memory/config.json`:

```json
{
  "budget": {
    "dailyLimit": 10,      // $ per day for reflection
    "monthlyLimit": 100    // $ per month
  },
  "sessionLookbackDays": 7,
  "maxBulletsInContext": 50
}
```

## Troubleshooting

```bash
cm doctor                        # Check system health
cass health                      # Check index health
cass index                       # Rebuild index

# If reflect finds 0 sessions
cass stats                       # Verify sessions exist
cm reflect --workspace /path     # Specify workspace explicitly
```
