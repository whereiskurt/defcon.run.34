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

## Merging PRs

Branch protection requires admin privileges to merge:

```bash
# Merge with admin flag (required due to branch protection)
gh pr merge <number> --squash --admin

# If you get "already checked out" error for main branch:
# The beads worktree uses main, so you can't switch to it directly.
# Instead, update your current branch to match origin/main:
git fetch origin main && git reset --hard origin/main
```

**Beads worktree note:** The beads system maintains a worktree on the main branch at `.git/beads-worktrees/main`. This means `git checkout main` will fail with "already checked out" error. Use the `git fetch && git reset` pattern above to sync with main instead.

## Adding New AWS Regions

The infrastructure supports multi-region deployment. Adding a new region (e.g., `ap-southeast-1` / `apse1`) requires updates in several places.

### Region Label Convention

| Region | Label | Length |
|--------|-------|--------|
| us-east-1 | use1 | 4 |
| ca-central-1 | cac1 | 4 |
| ap-southeast-1 | apse1 | 5 |

**Note:** Labels can be 4-5 characters. The codebase handles variable-length labels correctly.

### Terraform Provider Limitation

**Terraform cannot dynamically select providers.** This is valid:
```hcl
provider = aws.use1  # Static reference - OK
```

This is **invalid**:
```hcl
provider = aws[each.key]  # Computed reference - NOT ALLOWED
```

Therefore, each region requires explicit provider aliases and resources. This is a repeatable pattern, not a limitation to work around.

### Checklist for Adding a New Region

#### 1. Provider Aliases
Add provider alias in `infra/terraform/providers/global.hcl`:
```hcl
provider "aws" {
  alias  = "apse1"
  region = "ap-southeast-1"
  ${local.application_profile_line}
}
```

#### 2. CloudFront Module Resources
Add region-specific S3 bucket policy resources in `infra/terraform/modules/cloudfront/v1.0.0/main.tf`:
- `aws_s3_bucket_policy.cf_oac_access_<label>`
- `aws_s3_bucket_policy.cms_media_oac_access_<label>`

Copy existing `use1` or `cac1` resources and update:
- Resource name suffix
- Provider reference
- Region label in conditions

#### 3. Region Directory
Create `infra/terraform/live/site/region/<full-region-name>/`:
```
<region>/
├── region.hcl           # label and full name
├── ecr/terragrunt.hcl
├── ecs-cluster/terragrunt.hcl
├── ecs-services/terragrunt.hcl
├── ecs-tasks/terragrunt.hcl
├── email/
│   ├── email.hcl
│   ├── lambdas/email-forwarder/
│   └── terragrunt.hcl
├── network/terragrunt.hcl
├── s3-uploads/terragrunt.hcl
├── secrets/terragrunt.hcl
└── ssm/terragrunt.hcl
```

Copy from `us-east-1/` and update `region.hcl`:
```hcl
locals {
  region = {
    label = "apse1"
    full  = "ap-southeast-1"
  }
}
```

#### 4. Site Configuration
Update `infra/terraform/live/site/site.hcl`:
- Add to `email.replica_regions[]`
- Remove from `site.skip_regions` when ready to deploy

#### 5. Service DynamoDB Replication
Update each service's `service.hcl` to add the region to `dynamodb.tables[].replica_regions[]`:
- `services/run.auth/service.hcl`
- `services/run.human/service.hcl`
- `services/run.gpx/service.hcl`
- `services/run.cms/service.hcl`

#### 6. State Backend
Add to `env.sh`:
```bash
export TG_BUCKET_APSE1="tf-dc34-apse1-${SGUID}"
export TG_TABLE_APSE1="tf-dc34-apse1-${SGUID}"
```

#### 7. SOPS KMS Key
Create KMS key with alias `sops` in the new region, then update `.sops.yaml`:
```yaml
kms: "...,arn:aws:kms:ap-southeast-1:<account>:alias/sops"
```

#### 8. Secrets
Run SOPS to re-encrypt secrets with the new KMS key so they can be decrypted in the new region.

### Deployment Order (Pre-work)

1. Create KMS key in new region (manual or separate terraform)
2. Update SOPS config and re-encrypt secrets
3. Add provider aliases and CloudFront module resources
4. Create region directory structure
5. Add to DynamoDB replica_regions in service files
6. Add state backend env vars to env.sh
7. Keep region in `skip_regions` and **exclude from S3 replication** until bootstrap

### Bootstrap Sequence (Enabling the Region)

S3 replication requires destination buckets to exist before configuring replication rules. Follow this sequence:

**Step 1: Create state backend (manual)**
```bash
# Create S3 bucket for Terraform state
aws s3 mb s3://tf-dc34-apse1-80a6b349 --region ap-southeast-1 --profile terraform

# Enable versioning (required for state)
aws s3api put-bucket-versioning \
  --bucket tf-dc34-apse1-80a6b349 \
  --versioning-configuration Status=Enabled \
  --region ap-southeast-1 \
  --profile terraform

# Create DynamoDB table for state locking
aws dynamodb create-table \
  --table-name tf-dc34-apse1-80a6b349 \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-southeast-1 \
  --profile terraform
```

**Step 2: Verify prerequisites**
```bash
source env.sh && source env.local.sh
echo $TG_BUCKET_APSE1  # Verify state bucket var is set
```

**Step 3: Enable region (without replication)**
```bash
# Edit site.hcl - remove region from skip_regions
skip_regions = []

# IMPORTANT: Keep the new region OUT of S3 replica_regions for now:
# - site.hcl email.replica_regions
# - services/run.cms/service.hcl cms-media replication.replica_regions
```

**Step 4: Deploy infrastructure**
```bash
cd infra/terraform/live/site
terragrunt run-all apply --non-interactive -- -auto-approve
```

**Step 5: Add region to S3 replication**
```bash
# Edit site.hcl - add to email.replica_regions:
{ label = "apse1", full = "ap-southeast-1" }

# Edit services/run.cms/service.hcl - add to cms-media replica_regions:
{ label = "apse1", full = "ap-southeast-1" }
```

**Step 6: Apply replication**
```bash
terragrunt run-all apply --non-interactive -- -auto-approve
```

**Step 7: Deploy applications**
```bash
# Build and push images to new region's ECR
./apps/build.sh run-auth apse1
./apps/build.sh run-human apse1
./apps/build.sh run-gpx apse1
./apps/build.sh run-cms apse1

# Deploy services
./apps/deploy.sh run-auth apse1
./apps/deploy.sh run-human apse1
./apps/deploy.sh run-gpx apse1
./apps/deploy.sh run-cms apse1
```

**Step 8: Verify**
- Check CloudFront origins include new region
- Test regional endpoints (e.g., `https://auth.defcon.run/apse1/`)
- Verify S3 replication is working
