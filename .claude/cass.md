# Memory System with CASS

This project uses **CASS (cass-memory)** to retrieve relevant context, rules, and anti-patterns before tackling complex work.

## Quick Reference

```bash
cm context "<task description>"   # Get context before starting work
```

## Protocol

The CASS workflow involves four steps:

1. **Retrieve context first** — Run `cm context "<task>"` to get rules, anti-patterns, history snippets, and suggested queries
2. **Reference rule IDs during work** — Note which rules apply as you implement
3. **Leave inline feedback** — Add comments about rule effectiveness
4. **Finish without manual reflection** — The system handles learning automatically

## Feedback Format

Use inline comments to indicate whether specific rules proved useful or problematic:

```javascript
// [cass: helpful b-xyz] - This rule helped with the implementation
// [cass: problematic b-xyz] - This rule didn't apply well here
```

## What You Get

Running `cm context` returns:

- **Rules** — Best practices and guidelines with IDs (e.g., `b-xyz`)
- **Anti-patterns** — Things to avoid
- **History snippets** — Relevant prior work
- **Suggested queries** — Follow-up searches if needed

## Important Notes

- **No manual reflection** — Don't run reflection commands manually
- **No manual feedback marking** — Just use inline comments
- **No playbook management** — The system handles this automatically
- **Retrieve before complex work** — Skip for trivial tasks like typo fixes

## When to Use

| Task Type | Use CASS? |
|-----------|-----------|
| New feature implementation | Yes |
| Complex refactoring | Yes |
| Architecture decisions | Yes |
| Bug investigation | Yes |
| Simple typo fix | No |
| Minor config change | No |
