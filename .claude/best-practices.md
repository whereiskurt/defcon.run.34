# Best Practices

Guidelines for working in the defcon.run 34 codebase.

## Simplicity First

- Default to <100 lines of new code
- Single-file implementations until proven insufficient
- Avoid frameworks without clear justification
- Choose boring, proven patterns

## Complexity Triggers

Only add complexity with:
- Performance data showing current solution too slow
- Concrete scale requirements (>1000 users, >100MB data)
- Multiple proven use cases requiring abstraction

## Clear References

- Use `file.ts:42` format for code locations
- Reference specs as `specs/auth/spec.md`
- Link related changes and PRs

## Capability Naming

- Use verb-noun: `user-auth`, `payment-capture`
- Single purpose per capability
- 10-minute understandability rule
- Split if description needs "AND"

## Change ID Naming

- Use kebab-case, short and descriptive: `add-two-factor-auth`
- Prefer verb-led prefixes: `add-`, `update-`, `remove-`, `refactor-`
- Ensure uniqueness; if taken, append `-2`, `-3`, etc.

## Tool Selection Guide

| Task | Tool | Why |
|------|------|-----|
| Find files by pattern | Glob | Fast pattern matching |
| Search code content | Grep | Optimized regex search |
| Read specific files | Read | Direct file access |
| Explore unknown scope | Task | Multi-step investigation |

## Branch Workflow

**Never commit directly to main.** Always work in a feature branch and create a PR.

Before saying "done" or "complete", run this checklist:

```
[ ] 1. git status                      (check what changed)
[ ] 2. git checkout -b <branch-name>   (create feature branch if not already on one)
[ ] 3. git add <files>                 (stage code changes - NOT .beads/)
[ ] 4. git commit -m "..."             (commit code)
[ ] 5. git push -u origin <branch>     (push branch to remote)
[ ] 6. gh pr create                    (create PR for review)
[ ] 7. bd sync                         (sync beads changes to beads-sync branch)
```

**Important:**
- Never push directly to main
- Never auto-merge PRs unless the user explicitly requests it
- PRs require user review and approval before merging
- Work is not done until PR is created and ready for review
