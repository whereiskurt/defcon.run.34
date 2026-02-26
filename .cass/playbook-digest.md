# Playbook Digest
> Auto-generated summary of 1,925 CASS playbook rules. See .cass/playbook.yaml for raw data.
> Generated: 2026-02-26

---

## Monorepo Structure & Orientation

- Map service boundaries before diving into code: `apps/run.auth` (OIDC), `apps/run.cms` (Strapi), `apps/run.human` (Next.js frontend); trace data flow across these first.
- Check `docker-compose.yaml`, `build.sh`, `deploy.sh`, and `release-all.sh` together to understand the containerized deployment pipeline.
- Expect `apps/local/` for infrastructure services (DynamoDB, MinIO) while applications live in `apps/run.*/webapp/` — distinguish these early for accurate task configuration.
- Identify the full stack with versions upfront: Next.js 16, React 19, Auth.js v5, Strapi 5.6, DynamoDB/ElectroDB, Terraform/Terragrunt — version specifics drive compatibility decisions throughout.
- For AWS multi-region setups, identify primary/secondary region pairs (`us-east-1` + `ca-central-1`) and confirm active-active vs. active-passive before analyzing infrastructure.

---

## Terraform & Terragrunt

- Check both `/infra/terraform/live/` (environment configs) and `/infra/terraform/modules/` (reusable modules) before modifying any infrastructure.
- Terraform cannot use dynamic provider aliases — hardcode regional providers (`use1`, `usw1`, `usw2`, `cac1`, `euw1`) for resources requiring different regional API endpoints.
- Use `skip.hcl` in regional directories to exclude regions from `terragrunt run-all`; when `mock_outputs_merge_strategy_with_state = 'shallow'` returns stale state instead of mocks, this causes `NoSuchBucket` errors — verify mock behavior explicitly.
- For `for_each` loops, use only static configuration values as keys — apply-time attributes (e.g., `stream_arn`) cause "keys derived from resource attributes" plan errors.
- Add `contains(keys(var.source_buckets), name)` guards in modules consuming dependency outputs to handle mock outputs during destroy/plan phases.
- Use `site.hcl` as single source of truth with derived locals (`site_domain_slug`, `tf_state_prefix`, `delegate_role_name`) — enables consistent naming across 40+ files without hardcoding.
- Expect `terraform validate` to fail on Terragrunt modules run outside Terragrunt context — this is normal behavior, not a module defect.

---

## GitHub Actions & CI/CD

- For GitHub OIDC cross-account role assumption with external IDs, implement two-step auth: `aws-actions/configure-aws-credentials` for same-account OIDC, then explicit `aws sts assume-role --external-id` for cross-account roles.
- Perform local `terragrunt apply` on `github-oidc` module before GitHub Actions can manage its own permissions — this bootstrap dependency requires manual intervention.
- Use separate Release and Deploy workflows to allow building without deploying and targeting specific regions independently.
- For Terraform state lock errors from terminated CI runners (`ConditionalCheckFailedException`), clear manually with `terraform force-unlock` rather than automated cleanup.
- Add permissions incrementally based on actual IAM failure messages rather than guessing upfront.
- Use `prevent_destroy` lifecycle rules on bootstrap IAM resources (GitHub OIDC providers, roles) to protect against accidental `terragrunt run-all destroy`.

---

## ECS, Docker & Container Builds

- Configure `FARGATE_SPOT` as primary capacity provider (70–80% weight) with `FARGATE` as fallback for cost optimization.
- For multi-architecture Docker builds, use `ARG TARGETARCH` with conditional shell logic to map `arm64`/`amd64` to vendor-specific binary naming conventions — Terragrunt, Terraform, and SOPS each differ.
- ARM Macs running x86_64 containers through Rosetta cause significant slowdowns and `node_modules` native binding incompatibility — use architecture-aware builds or named Docker volumes to isolate `node_modules`.
- Docker `.dockerignore` with `node_modules/` silently affects all nested `node_modules` — verify local provider module installation inside containers with `docker exec -it container ls -la /app/node_modules/<module>`.

---

## Strapi CMS

- Never run `npm audit fix --force` on Strapi v5 — it downgrades to v4, causing cascading breaking changes. Accept Strapi ecosystem vulnerabilities that require framework-level fixes.
- Strapi 5.x requires `react@^17.0.0 || ^18.0.0` — downgrade React to 18.x before upgrading Strapi to avoid `ERESOLVE` errors; do not use `--legacy-peer-deps`.
- Ensure all `@strapi/*` dependencies share the same major version — mixed v4/v5 packages cause cascading failures.
- For custom Strapi email providers, use `@aws-sdk/client-ses` v3 (not deprecated `node-ses`) and structure as a `file:` dependency in `package.json`; run `npm install` after to create proper symlinks.
- Note the SQLite + Litestream pattern for lightweight CMS with streaming replication; check `providers/` for custom provider implementations.

---

## ElectroDB & DynamoDB

- Use composite keys with prefixed patterns (`PK '$run#userid_{userId}'`, `SK '$entity_1#id_{id}'`) and GSI indexes with `gsi1pk-gsi1sk-index` naming convention.
- Export both full and create types: `export type Item = EntityItem<typeof Entity>` and `export type CreateInput = CreateEntityItem<typeof Entity>`.
- For GSI composite keys, use sentinel values like `'ROOT'` instead of `undefined`/`null` — ElectroDB throws "Incomplete composite attributes" for undefined GSI keys.
- Avoid default empty arrays on DynamoDB set attributes — DynamoDB throws "Pass a non-empty set"; omit the field entirely or use `convertEmptyValues: true`.
- For queries on non-primary key fields, use scan with `FilterExpression` — query only works with primary/sort key attributes.
- After ElectroDB schema changes in Next.js API routes, restart the dev server — schema modifications may not reflect due to internal route caching.
- For local DynamoDB queries: `aws dynamodb scan --table-name T --region us-east-1 --endpoint-url http://localhost:8888`.

---

## S3 & File Storage

- Use user-ID prefixes in S3 object keys (`uploads/{userId}/type/{fileId}`) for data isolation without complex bucket policies.
- Implement suffix-based versioning (`.v{N}`) with a `MAX_VERSIONS` constant; maintain the current file at the original key for backward compatibility.
- For versioned uploads: PUT generates a presigned URL for the versioned key; POST uses `CopyObjectCommand` to copy to the current key after upload completes.
- Use `HeadObjectCommand` instead of `GetObjectCommand` for existence checks; use `Promise.all` for parallel existence checks across versions.
- Use `s3ClientForPresign` (with `requestChecksumCalculation: 'WHEN_REQUIRED'`) for browser-facing presigned URLs to avoid checksum header conflicts.
- Hardcode `ContentType` in `PutObjectCommand` and set 3600s expiration on presigned URLs to prevent content-type injection attacks.

---

## Authentication & Authorization

- For service-level access control, check `user.services` array for required service names (e.g., `gpxstudio`) in addition to basic auth.
- For internal service-to-service APIs, use `X-Internal-Secret` header authentication; create dedicated `/internal/` endpoints separate from user-facing APIs. When diagnosing `401 INVALID_INTERNAL_SECRET` errors, compare `AUTH_INTERNAL_SECRET` values across all service `.env` files — missing variables default to empty strings.
- `DEFAULT_SERVICES` in `auth-profile.ts` only applies during initial profile creation — existing users never receive new services unless manually migrated.
- For OIDC redirect URI mismatches, trace the full construction path: `NODE_ENV` → `isDev` logic → nginx rewrite rules → `OIDC_REDIRECT_URI` overrides. Wrap localhost URIs in environment conditionals to prevent production registration.
- For Auth.js v5, use client-side `signIn()` instead of direct GET requests to signin endpoints, and wrap components using `useSession()` with `SessionProvider`.
- For session middleware behind TLS-terminating proxies (CloudFront/ALB), set `secure: false` at the top level of session config — nested `cookie: { secure: false }` may not override correctly.
- Reduce session `maxAge` from 15 days to 1 day to minimize compromised session exposure window.

---

## Quota Systems

- Design quota systems with three tiers: `zero` (restricted), `upload` (default), `admin` (unlimited); store `quotaTier` on the user profile entity for OIDC claims integration.
- Implement countdown semantics using `remaining` field (not `consumed`) — simplifies quota checking (`remaining > 0`) and enables atomic DynamoDB decrements with conditional expressions.
- Use auto-initialization on first access (`getOrInitQuota`) with tier-based defaults to avoid manual user setup.
- Create separate `quota-client.ts` files per consuming service rather than shared libraries to maintain service independence.
- For `0/0` quota display, verify all three locations: quota definitions in auth service, `QuotaId` type inclusion, and `PROFILE_QUOTA_IDS` array in the API route. Restart the dev server after modifying `PROFILE_QUOTA_IDS` — array changes may not hot-reload.

---

## AWS Data Pipeline (SES, Firehose, Athena)

- Kinesis Firehose processor order for CloudWatch logs must be: Decompression → CloudWatchLogProcessing → MetadataExtraction — wrong order sends all records to the error prefix.
- Use specific JSON subscription filters (`{ $.campaign = "*" }`) instead of empty strings to avoid forwarding plain-text logs to Firehose.
- For Athena queries on ISO timestamp strings stored as `varchar`, wrap with `from_iso8601_timestamp()` before using date functions.
- After adding Hive-style S3 partitions, run `MSCK REPAIR TABLE table_name` before querying — Athena does not auto-discover existing partitions.

---

## Next.js & SvelteKit Frontend Patterns

- For Next.js API routes, validate session first, check service permissions, then implement business logic — follow existing route patterns for consistency.
- Use optional chaining (`session?.user?.email`) throughout React pages accessing session data to prevent runtime errors during auth state transitions.
- For SvelteKit applications served from subdirectories (e.g., `/gpx-studio`), set `BASE_PATH` during build — without it, `/_app/immutable/chunks/*.js` assets will 404.
- For Svelte 5, avoid `$state()` runes with `bind:` across component boundaries — use writable stores from `svelte/store` instead.
- Configure Vite proxy in `vite.config.ts` (e.g., `'/api': 'http://localhost:3003'`) for API integration during development to avoid rebuilding frontend for every API change.
- For auto-save functionality, use djb2 hash-based content change detection before triggering saves — prevents unnecessary version increment spam.

---

## UI/UX Conventions

- Use Lucide icons consistently: Globe (public), Lock (private), Users (sharing), History (versions), Copy/Check (clipboard), Trash2 (delete).
- Implement copy-to-clipboard with visual feedback: show checkmark for 2 seconds after `navigator.clipboard.writeText()`, then restore the copy icon.
- For form default value indicators, use "dimmed value + pill badge" pattern (`.is-default` with `opacity: 0.6`, `font-style: italic`) — placeholder text is mistaken for actual values.
- For disabled buttons that must preserve layout space, combine `opacity: 0.35`, `cursor: not-allowed`, and `disabled: true`; use `visibility: hidden` + `pointer-events: none` instead of `display: none`.
- For operation buttons during long-running processes, show operation-specific messages ("Scanning…", "In progress") rather than generic "Loading".
- For CSS grid containers with variable-height children, use `align-items: start` to prevent shorter elements from stretching to match the tallest sibling.

---

## VS Code & Dev Environment

- Use VS Code tasks with `runOn: folderOpen` instead of `devcontainer postStartCommand` — tasks give each service a dedicated terminal (`panel: dedicated`) with `isBackground: true` and support manual restart via Command Palette.
- Assign specific `PORT` environment variables per service (e.g., 3001 frontend, 3002 auth, 1337 CMS) to avoid conflicts and enable predictable service discovery.
- Set `customizations.vscode.settings.task.allowAutomaticTasks: on` in `devcontainer.json` to suppress prompts when tasks auto-run on container open.
- Group related tasks by function (`local-infra` for DynamoDB/S3, `local-apps` for web services) using the `group` property to organize the terminal panel.
- Use `options.cwd` in VS Code task definitions instead of `cd directory &&` in command strings — tasks run in separate shell processes so environment variables do not carry over.

---

## Git, Branching & Security

- Never commit directly to `main` — always create a feature branch, push, open a PR, and include an explicit `STOP: Wait for user approval before merging` gate.
- Session close checklist: `git checkout -b feature-branch` → `git add .` → `bd sync` → `git commit` → `git push origin feature-branch` → `gh pr create` → STOP for approval.
- For branch renaming: `git branch -m old-name new-name` locally, then `git push origin new-name` + `git push origin --delete old-name` to maintain remote consistency.
- When API keys are accidentally exposed in chat, immediately warn the user to rotate them and provide specific rotation instructions — treat any chat-visible key as compromised.
- For file upload security, implement magic byte detection for 14+ binary formats, control character scanning, and file extension validation as layered defenses.

---

## Project Tooling (Beads, CASS, OpenSpec)

- Use `bd ready --json`, `bd list --json`, `bd show <id> --json` for AI-parseable output; never add `--json` to mutation commands.
- Beads uses numeric priorities (0–4, higher = higher priority) — never reference "high/medium/low" in beads documentation.
- OpenSpec pattern: `openspec/specs/` holds current truth, `openspec/changes/` holds proposals — new features require a spec proposal; bug fixes can skip this step.
- Set CASS daily budget to $10+ in `~/.cass-memory/config.json` to prevent mid-reflection interruptions; use `cm reflect --days 90 --workspace /full/path` for project-specific sessions.
- In multi-agent projects, check session diaries and existing file structures before starting assigned tasks — completed applications typically have 15–20+ files; verify before declaring a task incomplete.