# GitHub Actions Workflows

## Release Workflow (`release.yml`)

Automated release pipeline that builds Docker images, pushes to ECR, syncs assets to S3, and creates PRs.

### Quick Start

1. Go to **Actions** → **Release** → **Run workflow**
2. Select options:
   - **Apps**: Which apps to release (default: all)
   - **Regions**: `use1`, `cac1`, or both
   - **Runner**: `github-hosted` (simple) or `self-hosted-ec2` (fast)
3. Click **Run workflow**

### Runner Options

| Runner | Speed | Cost | Best For |
|--------|-------|------|----------|
| **GitHub-hosted** | ~15-25 min | Free (public) / $0.008/min (private) | Daily releases, simple setup |
| **Self-hosted EC2** | ~5-8 min | ~$0.15-0.30 per build (spot) | Urgent releases, large changes |

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
   RUNNER_INSTANCE_PROFILE = xxx        # IAM instance profile for runner
   ```

2. **Repository Secret**:
   ```
   GH_RUNNER_TOKEN = ghp_xxx            # Personal access token with repo scope
   ```

   Create at: https://github.com/settings/tokens
   Required scopes: `repo` (Full control of private repositories)

3. **EC2 Runner Infrastructure** (optional - use existing VPC):
   The runner uses your existing VPC. Ensure the subnet has:
   - Internet access (NAT gateway or public subnet)
   - Outbound access to GitHub, AWS ECR, and AWS S3

### Workflow Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `apps` | Comma-separated app list | `run.auth,run.human,run.cms,run.gpx` |
| `regions` | Target regions | `use1` |
| `runner` | Runner type | `github-hosted` |
| `parallel` | Build apps in parallel | `true` |
| `skip_bump` | Skip version increment | `false` |
| `create_pr` | Create and auto-merge PR | `true` |
| `deploy` | Run terragrunt deploy | `false` |

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
