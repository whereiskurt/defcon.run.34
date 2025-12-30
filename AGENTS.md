<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until you have a PR ready for review.

### Branch Naming Convention

Create a branch named after the bead you're working on:
```bash
git checkout -b <bead-id>  # e.g., git checkout -b beads-abc123
```

### MANDATORY WORKFLOW:

1. **Create/switch to feature branch** (if not already on one):
   ```bash
   # If starting fresh from main
   git checkout main
   git pull
   git checkout -b <bead-id>

   # If already on a feature branch, continue there
   ```

2. **File issues for remaining work** - Create beads for anything that needs follow-up

3. **Run quality gates** (if code changed) - Tests, linters, builds

4. **Update issue status** - Close finished work, update in-progress items

5. **Commit and push to feature branch**:
   ```bash
   git add <files>
   bd sync                    # Commit beads changes
   git commit -m "descriptive message"
   bd sync                    # Commit any new beads changes from closing
   git push -u origin <bead-id>
   ```

6. **Create PR** (if ready for review):
   Use the MCP GitHub tools to create a pull request with:
   - Title: Brief description of the change
   - Body: Summary of changes, related bead ID, and test plan

   Or if work continues next session, note the branch in handoff.

7. **Verify**:
   ```bash
   git status        # Clean working tree
   gh pr view        # PR exists (if created)
   bd show <bead-id> # Issue status updated
   ```

8. **Hand off** - Provide context for next session including:
   - Branch name
   - PR link (if created)
   - What remains to be done

### CRITICAL RULES:
- **NEVER commit directly to main** - main is protected, use feature branches
- Work is NOT complete until pushed to remote (feature branch)
- Branch names should match the bead ID for traceability
- If PR is not ready, still push the branch and note status in handoff
- NEVER say "ready to push when you are" - YOU must push

