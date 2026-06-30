# Best Practices

Coding conventions and patterns used in the defcon.run 34 codebase.

## Code Style

- TypeScript strict mode in all Next.js apps
- ElectroDB for DynamoDB — entities defined in `src/entities/`
- Auth.js v5 with JWT sessions and custom callbacks
- API routes return proper HTTP status codes (401, 403, 404, 429)
- Quota consumed before action (fail-fast pattern)
- Default to <100 lines of new code per file
- Single-file implementations until proven insufficient
- Boring, proven patterns preferred over clever abstractions

## Security Patterns

### API Endpoint Guard Order

1. Check session (401 if missing)
2. Check service claim (403 if unauthorized)
3. Proceed with business logic

### Server-to-Server Communication

- `X-Internal-Secret` header for service-to-service calls
- Internal service discovery URLs (not public endpoints)

### Client-Facing Security

- Presigned URLs for S3 uploads (never expose credentials to client)
- Cookie security: `httpOnly`, `secure` (prod), `sameSite=lax`

### GPX Validation

- Binary detection, control character rejection, XML structure check
- Applied before any file processing

## Infrastructure Patterns

### Terragrunt Module Structure

- `config.hcl` for inputs per module
- Versioned modules in `infra/terraform/modules/{name}/v1.0.0/`
- Service definitions in `infra/terraform/live/site/services/{name}/service.hcl`

### Regional Resources

- Auto-skip via `skip.hcl` and exclude blocks in `site.hcl`
- Template variables: `{{REGION}}`, `{{REGION_LABEL}}`, `{{SITE_DOMAIN}}`, `{{SITE_LABEL}}`

### State Management

- S3 bucket + DynamoDB locking table per region
- Backend config generated from `env.sh` variables

## Naming Conventions

### Services

- Pattern: `run.{purpose}` — e.g., `run.auth`, `run.human`, `run.gpx`, `run.cms`

### Regions

- Pattern: `{geo}{dir_abbrev}{num}` — e.g., `use1`, `cac1`, `apse1`
- Labels are 4-5 characters, codebase handles variable length

### DynamoDB Tables

- Pattern: `{site_label}-{service}-{purpose}` — e.g., `dc34-gpx`, `run-auth-electro`

### ECR Repositories

- Pattern: `{site_label}-run-{service}` — e.g., `dc34-run-auth`

### ECS Services

- Pattern: `run-{service}` — e.g., `run-auth`, `run-cms-master`

### Branch & Phase Names

- Kebab-case, verb-led: `add-two-factor-auth`, `update-gpx-validation`
- Prefixes: `add-`, `update-`, `remove-`, `refactor-`
- Append `-2`, `-3` if name taken

## Branch Workflow

Never commit directly to main. Always work in a feature branch and create a PR.

```
1. git checkout -b <branch-name>
2. git add <files>          # Stage specific files, not -A
3. git commit -m "..."
4. git push -u origin <branch>
5. gh pr create
```

- Never auto-merge PRs unless explicitly requested
- PRs require user review and approval before merging

### Merging (admin required)

```bash
gh pr merge <number> --squash --admin
```

If a worktree has `main` checked out, `git checkout main` will fail. Use:

```bash
git fetch origin main && git reset --hard origin/main
```

## Session Close Protocol

```
1. git status                    # Check what changed
2. git add <files>               # Stage changes
3. git commit -m "..."           # Commit
4. git push -u origin <branch>   # Push
```

## Tool Selection

| Task | Tool | Why |
|------|------|-----|
| Find files by pattern | Glob | Fast pattern matching |
| Search code content | Grep | Optimized regex search |
| Read specific files | Read | Direct file access |
| Explore unknown scope | Task | Multi-step investigation |
