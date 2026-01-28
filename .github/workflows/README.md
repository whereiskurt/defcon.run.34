# GitHub Actions Workflows

## Workflow Overview

| Workflow | Purpose | When to use |
|----------|---------|-------------|
| **Build+Pub** | Build images, push to ECR, sync assets | New code ready to deploy |
| **Deploy** | Run terragrunt to update ECS | After release, or redeploy current |
| **Rollback** | Revert to a previous version | Something went wrong |
| **EC2 Runner** | Manage self-hosted runners | Fast builds, work sessions |

### Typical Flow

```
Code merged to main
        │
        ▼
┌─────────────────┐
│   Build+Pub    │  Build images, push to ECR
│  (no deploy)    │  Creates PR, merges
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    Deploy       │  Terragrunt apply → ECS blue/green
│   us-east-1     │
└────────┬────────┘
         │
         ▼ (verify, then)
┌─────────────────┐
│    Deploy       │  Same for second region
│  ca-central-1   │
└─────────────────┘
```

---

## Build+Pub Workflow (`buildpub.yml`)

Automated build and publish pipeline that builds Docker images, pushes to ECR, syncs assets to S3, and creates PRs.

### Quick Start

1. Go to **Actions** → **Build & Publish** → **Run workflow**
2. Select options:
   - **Apps**: Which apps to build (default: all)
   - **Regions**: `use1`, `cac1`, or both
   - **Runner**: `github-hosted` (simple) or `self-hosted-ec2` (fast)
3. Click **Run workflow**

### Runner Options

| Runner | Speed | Cost | Best For |
|--------|-------|------|----------|
| **GitHub-hosted** | ~15-25 min | Free (public) / $0.008/min (private) | Daily releases, simple setup |
| **EC2 ephemeral** | ~5-8 min | ~$0.15-0.30 per build | One-off releases |
| **EC2 start-and-keep** | ~5-8 min first, ~3-5 min reuse | ~$0.77/hr (c6i.4xlarge) | Work sessions with multiple releases |
| **EC2 reuse-existing** | ~3-5 min | Uses already-running instance | Fast iteration during work session |

### Setup Requirements

#### For GitHub-hosted runner (minimal setup)

1. **Repository Variables** (Settings → Secrets and variables → Actions → Variables):
   ```
   AWS_ACCOUNT_ID = 427284555693  # Your AWS account ID
   ```

2. **Deploy the IAM role**:
   ```bash
   cd infra/terraform/live/site/global/github-oidc
   terragrunt apply
   ```
   This creates `dc34-github-release` role with ECR, S3, and CloudFront permissions.

#### For self-hosted EC2 runner (additional setup)

1. **Additional Repository Variables**:
   ```
   RUNNER_SUBNET_ID = subnet-xxx        # Public subnet in us-east-1
   RUNNER_SG_ID = sg-xxx                # Security group allowing outbound
   ```
   Note: IAM role name is hardcoded to `dc34-github-runner` in the workflows.

2. **Repository Secret**:
   ```
   GH_RUNNER_TOKEN = ghp_xxx            # Personal access token with repo scope
   ```

   Create at: https://github.com/settings/tokens
   Required scopes: `repo` (Full control of private repositories)

3. **IAM Role for SSM Access**:
   The runner needs an IAM role with SSM permissions so you can SSH in for debugging.
   The ec2-github-runner action handles instance profile creation internally.

   Create an IAM role with:
   - Trust policy: EC2 service
   - Attached policy: `AmazonSSMManagedInstanceCore`

   Then create an instance profile and add the role to it:
   ```bash
   aws iam create-role --role-name dc34-github-runner \
     --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

   aws iam attach-role-policy --role-name dc34-github-runner \
     --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore

   aws iam create-instance-profile --instance-profile-name dc34-github-runner
   aws iam add-role-to-instance-profile --instance-profile-name dc34-github-runner --role-name dc34-github-runner
   ```

   To SSM into the runner:
   ```bash
   aws ssm start-session --target <instance-id>
   ```

4. **EC2 Runner Infrastructure** (optional - use existing VPC):
   The runner uses your existing VPC. Ensure the subnet has:
   - Internet access (NAT gateway or public subnet)
   - Outbound access to GitHub, AWS ECR, and AWS S3
   - SSM endpoints (or NAT for internet access to SSM)

### Workflow Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `apps` | Comma-separated app list | `run.auth,run.human,run.cms,run.gpx` |
| `regions` | Target regions | `use1` |
| `runner` | Runner type (see below) | `github-hosted` |
| `ec2_instance_type` | EC2 instance type | `c6i.4xlarge` |
| `parallel` | Build apps in parallel | `true` |
| `skip_bump` | Skip version increment | `false` |
| `create_pr` | Create and auto-merge PR | `true` |
| `deploy` | Run terragrunt deploy | `false` |

**Runner types**:
- `github-hosted` - Standard GitHub runner (simple, no setup)
- `ec2-ephemeral` - Start EC2, build, terminate (one-shot)
- `ec2-start-and-keep` - Start EC2, build, keep running (for reuse)
- `ec2-reuse-existing` - Use already-running EC2 runner (fast)

**Instance types** (all prices are approximate spot pricing in us-east-1):

| Type | vCPU | Memory | Spot/hr | Best For |
|------|------|--------|---------|----------|
| **Compute Optimized** |
| `c6i.4xlarge` | 16 | 32 GB | ~$0.14 | Standard builds (default) |
| `c6i.8xlarge` | 32 | 64 GB | ~$0.27 | Parallel builds |
| `c6i.12xlarge` | 48 | 96 GB | ~$0.41 | Heavy parallel builds |
| `c7i.4xlarge` | 16 | 32 GB | ~$0.15 | Newer gen, ~15% faster |
| `c7i.8xlarge` | 32 | 64 GB | ~$0.30 | Newer gen, parallel |
| **General Purpose** |
| `m6i.4xlarge` | 16 | 64 GB | ~$0.15 | Balanced workloads |
| `m6i.8xlarge` | 32 | 128 GB | ~$0.31 | Large builds |
| `m7i.4xlarge` | 16 | 64 GB | ~$0.17 | Newer gen |
| **Memory Optimized** |
| `r6i.4xlarge` | 16 | 128 GB | ~$0.20 | Memory-heavy builds |
| `r6i.8xlarge` | 32 | 256 GB | ~$0.40 | Very large builds |

**Tip**: Use spot instances for 60-90% savings. For a 3-4 hour work session:
- `c6i.8xlarge` spot: ~$1.08 (vs ~$5.44 on-demand)
- `c7i.8xlarge` spot: ~$1.20 (faster builds)

### What It Does

1. **Version Bump**: Increments VERSION files for selected apps
2. **Build**: Builds Docker images for nginx and webapp/app components
3. **Push**: Pushes images to ECR in selected regions
4. **Assets**: Syncs static assets to S3 (CloudFront origin)
5. **PR**: Creates and auto-merges release PR
6. **Deploy** (optional): Runs terragrunt to update ECS services

### Timing Estimates

| Scenario | GitHub-hosted | EC2 (c6i.4xlarge) |
|----------|--------------|-------------------|
| Single app, single region | ~8 min | ~3 min |
| All apps, single region | ~20 min | ~6 min |
| All apps, both regions | ~25 min | ~8 min |

### EC2 Runner Lifecycle

For extended work sessions, use the runner lifecycle management:

1. **Start a persistent runner**:
   - Run **Build+Pub** workflow with runner: `ec2-start-and-keep`
   - Or run **EC2 Runner** workflow with action: `start`

2. **Reuse for subsequent releases**:
   - Run **Build+Pub** workflow with runner: `ec2-reuse-existing`
   - The runner stays warm, builds are fast (~3-5 min)

3. **When done for the day**:
   - Run **EC2 Runner** workflow with action: `stop`
   - This terminates the instance and cleans up GitHub runners

4. **Check runner status**:
   - Run **EC2 Runner** workflow with action: `status`
   - Shows running EC2 instances and registered GitHub runners

**Cost tip**: A c6i.4xlarge costs ~$0.68/hr. For a 4-hour session with 5 releases:
- Ephemeral: 5 × ~$0.20 = ~$1.00 (includes startup overhead each time)
- Persistent: 4 × $0.68 = ~$2.72 (but faster iteration, SSM access)

### Troubleshooting

**Build fails with "no space left on device"**
- GitHub-hosted runners have ~14GB. Large Next.js builds can exceed this.
- Solution: Use EC2 runner or add cleanup step.

**ECR push fails with "no basic auth credentials"**
- The workflow pre-authenticates to ECR before builds.
- Check that `dc34-github-release` role has ECR permissions.

**PR merge fails with "branch protection"**
- The release script uses `--admin` flag for merge.
- Ensure the GitHub token has admin access to the repo.

**EC2 runner doesn't start**
- Check `GH_RUNNER_TOKEN` secret is valid and has `repo` scope.
- Verify subnet has internet access.
- Check IAM role has EC2 permissions.

---

## Deploy Workflow (`deploy.yml`)

Runs terragrunt to deploy what's currently in ECR to ECS. Triggers blue/green deployment.

### Usage

1. Go to **Actions** → **Deploy** → **Run workflow**
2. Select region (`us-east-1` or `ca-central-1`)
3. Optionally filter to specific apps
4. Click **Run workflow**

### Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `region` | Target AWS region | `us-east-1` |
| `apps` | Comma-separated apps (empty = all) | `` |
| `invalidate_cache` | Invalidate CloudFront after deploy | `true` |

### What It Does

1. Reads VERSION files to determine which image tags to deploy
2. Runs `terragrunt apply` on ecs-task and ecs-service modules
3. ECS performs blue/green deployment
4. Invalidates CloudFront cache (optional)

### CLI Usage

```bash
# Deploy all apps to us-east-1
gh workflow run deploy.yml -f region=us-east-1

# Deploy specific app
gh workflow run deploy.yml -f region=us-east-1 -f apps=run.auth
```

---

## Rollback Workflow (`rollback.yml`)

Reverts an app to a previous version by querying ECR for available images.

### Usage

**Step 1: List available versions**
1. Go to **Actions** → **Rollback** → **Run workflow**
2. Set action: `list`
3. Select region
4. Click **Run workflow**
5. Check the workflow summary for available versions

**Step 2: Perform rollback**
1. Run workflow again
2. Set action: `rollback`
3. Select the app and region
4. Enter the target version (from step 1)
5. Click **Run workflow**

### Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `action` | `list` or `rollback` | `list` |
| `region` | Target AWS region | `us-east-1` |
| `app` | App to rollback | `run.auth` |
| `target_version` | Version to rollback to | `` |

### What It Does

**List action:**
- Queries ECR for available image tags
- Shows last 10 versions per app with push dates
- Shows current deployed version
- Displays git history for VERSION files

**Rollback action:**
- Validates version exists in ECR
- Updates VERSION files
- Commits change to main
- Runs terragrunt apply
- Invalidates CloudFront cache

### CLI Usage

```bash
# List available versions
gh workflow run rollback.yml -f action=list -f region=us-east-1

# Rollback to specific version
gh workflow run rollback.yml \
  -f action=rollback \
  -f region=us-east-1 \
  -f app=run.auth \
  -f target_version=v0.1.5
```

### Version Discovery

The rollback workflow finds versions from:

1. **ECR image tags** - Actual images available to deploy
2. **Git history** - VERSION file changes (for context)

This is more reliable than just decrementing version numbers since:
- Versions might skip numbers (v0.1.5 → v0.2.0)
- Some versions might have been deleted from ECR
- You can see exactly when each version was pushed
