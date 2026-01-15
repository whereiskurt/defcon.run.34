# OpenSpec: Spec-Driven Development

This project uses OpenSpec for managing specifications and change proposals.

## Integration with Project Tooling

OpenSpec works alongside other tools in this project:

| Tool | Purpose | When to Use |
|------|---------|-------------|
| **OpenSpec** | Spec-driven proposals | New features, breaking changes, architecture shifts |
| **bd/beads** | Issue tracking | Track implementation tasks, dependencies |
| **bv** | Triage & visualization | Find ready work, analyze blocking issues |
| **cm/CASS** | Context retrieval | Get rules and anti-patterns before complex work |

**Typical workflow:**
1. `cm context "<feature>"` — Get relevant rules before planning
2. Create OpenSpec proposal — Define what changes
3. `bd create` tasks from `tasks.md` — Track implementation
4. `bv --robot-triage` — Find unblocked work to tackle
5. Implement, then `bd close` + `bd sync`
6. `openspec archive` after deployment

## TL;DR Quick Checklist

- Get context first: `cm context "<task>"` for rules and anti-patterns
- Search existing work: `openspec list`, `openspec list --specs`, `bd ready`
- Decide scope: new capability vs modify existing capability
- Pick a unique `change-id`: kebab-case, verb-led (`add-`, `update-`, `remove-`, `refactor-`)
- Scaffold: `proposal.md`, `tasks.md`, `design.md` (only if needed), and delta specs
- Write deltas: use `## ADDED|MODIFIED|REMOVED|RENAMED Requirements`
- Include at least one `#### Scenario:` per requirement
- Validate: `openspec validate [change-id] --strict`
- Request approval before implementation

## Three-Stage Workflow

### Stage 1: Creating Changes

**Create proposal when you need to:**
- Add features or functionality
- Make breaking changes (API, schema)
- Change architecture or patterns
- Optimize performance (changes behavior)
- Update security patterns

**Skip proposal for:**
- Bug fixes (restore intended behavior)
- Typos, formatting, comments
- Dependency updates (non-breaking)
- Configuration changes
- Tests for existing behavior

**Workflow:**
1. Review `openspec/project.md`, `openspec list`, and `openspec list --specs`
2. Choose a unique verb-led `change-id` and scaffold files under `openspec/changes/<id>/`
3. Draft spec deltas with at least one scenario per requirement
4. Run `openspec validate <id> --strict` before sharing

### Stage 2: Implementing Changes

1. **Approval gate** - Do not start until proposal is approved
2. **Read proposal.md** - Understand what's being built
3. **Read design.md** (if exists) - Review technical decisions
4. **Read tasks.md** - Get implementation checklist
5. **Track with beads** - Use `bd create` to track tasks from `tasks.md` (optional for complex work)
6. **Create feature branch** - `git checkout -b <branch-name>` (never commit to main)
7. **Implement tasks sequentially** - Complete in order, use `bv --robot-triage` to find ready work
8. **Confirm completion** - Ensure every item in `tasks.md` is finished
9. **Update checklist** - Set every task to `- [x]`, close beads with `bd close`
10. **Sync and commit** - `bd sync --from-main`, then `git add <files> && git commit`
11. **Create PR** - `git push -u origin <branch> && gh pr create`
12. **Wait for approval** - Do NOT merge until user explicitly approves

### Stage 3: Archiving Changes

After deployment:
- Move `changes/[name]/` → `changes/archive/YYYY-MM-DD-[name]/`
- Update `specs/` if capabilities changed
- Use `openspec archive <change-id> --skip-specs --yes` for tooling-only changes
- Run `openspec validate --strict` to confirm

## Before Any Task

**Context Checklist:**
- [ ] Run `cm context "<task>"` to get relevant rules and anti-patterns
- [ ] Read relevant specs in `specs/[capability]/spec.md`
- [ ] Check pending changes in `changes/` for conflicts
- [ ] Read `openspec/project.md` for conventions
- [ ] Run `openspec list` to see active changes
- [ ] Run `openspec list --specs` to see existing capabilities
- [ ] Run `bd ready` to see available tracked work

## Proposal Structure

### 1. Create directory
`changes/[change-id]/` (kebab-case, verb-led, unique)

### 2. Write proposal.md
```markdown
# Change: [Brief description of change]

## Why
[1-2 sentences on problem/opportunity]

## What Changes
- [Bullet list of changes]
- [Mark breaking changes with **BREAKING**]

## Impact
- Affected specs: [list capabilities]
- Affected code: [key files/systems]
```

### 3. Create spec deltas
`specs/[capability]/spec.md`:
```markdown
## ADDED Requirements
### Requirement: New Feature
The system SHALL provide...

#### Scenario: Success case
- **WHEN** user performs action
- **THEN** expected result

## MODIFIED Requirements
### Requirement: Existing Feature
[Complete modified requirement]

## REMOVED Requirements
### Requirement: Old Feature
**Reason**: [Why removing]
**Migration**: [How to handle]
```

### 4. Create tasks.md
```markdown
## 1. Implementation
- [ ] 1.1 Create database schema
- [ ] 1.2 Implement API endpoint
- [ ] 1.3 Add frontend component
- [ ] 1.4 Write tests
```

## Spec File Format

**CORRECT scenario format** (use #### headers):
```markdown
#### Scenario: User login success
- **WHEN** valid credentials provided
- **THEN** return JWT token
```

**WRONG** (don't use bullets or bold for headers):
```markdown
- **Scenario: User login**  ❌
**Scenario**: User login     ❌
### Scenario: User login      ❌
```

Every requirement MUST have at least one scenario.

## Delta Operations

- `## ADDED Requirements` - New capabilities
- `## MODIFIED Requirements` - Changed behavior (paste full requirement)
- `## REMOVED Requirements` - Deprecated features
- `## RENAMED Requirements` - Name changes

## Troubleshooting

**"Change must have at least one delta"**
- Check `changes/[name]/specs/` exists with .md files
- Verify files have operation prefixes (## ADDED Requirements)

**"Requirement must have at least one scenario"**
- Check scenarios use `#### Scenario:` format (4 hashtags)
- Don't use bullet points or bold for scenario headers

**Validation Tips:**
```bash
openspec validate [change] --strict
openspec show [change] --json | jq '.deltas'
```
