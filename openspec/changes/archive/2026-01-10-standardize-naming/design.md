# Design: Naming Standardization

## Architecture Overview

The naming inconsistency spans multiple layers. Since the AWS account is fresh (no existing resources), all changes can be made atomically before first deployment.

```
┌─────────────────────────────────────────────────────────────┐
│                    NAMING LAYERS                            │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Source Code                                       │
│  ├── apps/docker-compose.yaml                              │
│  ├── apps/local/dynamodb/init-local-db.sh                  │
│  └── apps/*/webapp/package.json                            │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Build Scripts                                     │
│  ├── apps/build.sh (REPO_PREFIX)                           │
│  └── apps/release-all.sh (get_tf_service mapping)          │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Infrastructure Config                             │
│  ├── infra/terraform/live/site/services/{name}/            │
│  └── service.hcl files (container names, task families)    │
└─────────────────────────────────────────────────────────────┘
```

## Approach: Fresh Account Rename

Since there are no existing AWS resources to migrate, we can rename everything in one atomic change:

1. Update all local dev files
2. Update all build scripts
3. Rename terraform directories
4. Update service.hcl files
5. First deploy creates resources with correct names

No migration, no state manipulation, no data sync needed.

## Naming Convention Summary

| Context | Site Prefix | Pattern | Example |
|---------|-------------|---------|---------|
| Source directories | No | `run.{service}` | `run.auth` |
| Local Docker | No | `run-{service}-localhost` | `run-auth-localhost` |
| package.json | No | `run-{service}` | `run-auth` |
| ECR repos | Yes | `dc34-run-{service}-{component}` | `dc34-run-auth-app` |
| ECS task/service | No | `run-{service}` | `run-auth` |
| S3 buckets | Yes | `dc34-run-{service}-{purpose}-*` | `dc34-run-cms-media-*` |
| Terraform dirs | No | `run-{service}` | `services/run-auth/` |

## Detailed Inconsistency Inventory

### 1. Docker Compose (apps/docker-compose.yaml)

| Current | Target | Line |
|---------|--------|------|
| `human-run-localhost` | `run-human-localhost` | 6 |
| `human-auth-localhost` | `run-auth-localhost` | 54 |

### 2. DynamoDB Init Script (apps/local/dynamodb/init-local-db.sh)

| Current | Target | Line |
|---------|--------|------|
| Comment: "human.run" | "run-auth" | 170 |
| TTL table: `human.run` | `run-auth` | 207 |
| Comment: "human.auth" | "run-auth" | 210 |

### 3. Package.json Names

| File | Current | Target |
|------|---------|--------|
| run.auth/webapp/package.json | `"name": "auth"` | `"name": "run-auth"` |
| run.human/webapp/package.json | `"name": "run"` | `"name": "run-human"` |

### 4. Build Scripts

| File | Current | Target | Line |
|------|---------|--------|------|
| build.sh | `REPO_PREFIX="dc34-auth"` | `dc34-run-auth` | 48 |
| build.sh | `REPO_PREFIX="dc34-cms"` | `dc34-run-cms` | 58 |
| release-all.sh | `"auth"` | `"run-auth"` | 108 |
| release-all.sh | `"cms"` | `"run-cms"` | 110 |

### 5. Terraform Service Directories

| Current | Target |
|---------|--------|
| `services/auth/` | `services/run-auth/` |
| `services/cms/` | `services/run-cms/` |
| `services/run-human/` | (already correct) |

### 6. ECR Repository Names (in service.hcl)

| Service | Current | Target |
|---------|---------|--------|
| auth | `auth-nginx`, `auth-app` | `run-auth-nginx`, `run-auth-app` |
| cms | `cms-nginx`, `cms-app` | `run-cms-nginx`, `run-cms-app` |

Note: ECR repos use site prefix via terraform variables, so these become `dc34-run-auth-nginx`, etc.

### 7. ECS Resources (in service.hcl)

| Service | Current | Target |
|---------|---------|--------|
| auth | family: `auth`, service: `auth` | `run-auth` |
| cms | family: `cms-master/worker` | `run-cms-master/worker` |

### 8. S3 Bucket Base Names (in service.hcl)

| Current | Target |
|---------|--------|
| `cms-litestream` | `dc34-run-cms-litestream` |
| `cms-media` | `dc34-run-cms-media` |

Note: Full bucket names include region suffixes via terraform (e.g., `dc34-run-cms-media-use1-*`).

## Validation

After all changes:

1. `docker compose up` - local dev works
2. `npm install` in all apps - no package issues
3. `terragrunt hclfmt` - HCL formatting valid
4. `terragrunt run-all validate` - terraform config valid
5. First deploy creates all resources with correct names
