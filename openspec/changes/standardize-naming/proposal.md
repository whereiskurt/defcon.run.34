# Standardize Naming Convention

## Summary
Standardize all service and component naming throughout the codebase to consistently use `run.auth`, `run.human`, and `run.cms` patterns (or `run-auth`, `run-human`, `run-cms` in hyphenated contexts).

## Problem
The codebase has evolved with inconsistent naming patterns:
- Docker Compose uses `human-run`, `human-auth` (reversed order)
- Terraform service directories use `auth`, `cms` (missing `run-` prefix) vs `run-human` (correct)
- ECR repositories use `dc34-auth`, `dc34-cms` (missing `run-`) vs `dc34-run-human`
- ECS services/tasks follow the same inconsistent pattern
- S3 buckets for CMS lack the `run-` prefix
- DynamoDB init script has stale comments referencing `human.run`, `human.auth`

## Canonical Naming Convention

| Context | Site Prefix | Pattern | Example |
|---------|-------------|---------|---------|
| Source directories | No | `run.{service}` | `run.auth` |
| Local Docker | No | `run-{service}-localhost` | `run-auth-localhost` |
| package.json | No | `run-{service}` | `run-auth` |
| ECR repos | Yes | `dc34-run-{service}-{component}` | `dc34-run-auth-app` |
| ECS task/service | No | `run-{service}` | `run-auth` |
| S3 buckets | Yes | `{purpose}-dc34-run-{service}-*` | `uploads-dc34-run-cms-media-*` |
| Terraform dirs | No | `run-{service}` | `services/run-auth/` |

## Approach

Since the AWS account is fresh with no existing resources, all changes can be made atomically in a single update before first deployment:

1. Update local development files (docker-compose, init scripts, package.json)
2. Update build scripts (build.sh, release-all.sh)
3. Rename terraform service directories
4. Update service.hcl files with correct names
5. First deploy creates all AWS resources with correct names

No migration, no state manipulation, no data sync needed.

## Decision
Proceed with atomic rename across all layers. See tasks.md for detailed implementation checklist.

## Related
- Beads issue: dcr34-9t0
