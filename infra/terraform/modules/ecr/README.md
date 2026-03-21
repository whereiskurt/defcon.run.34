# ECR Module

This module manages AWS Elastic Container Registry (ECR) repositories for storing Docker container images used by ECS tasks.

## Features

- **Regional Repositories**: Create ECR repositories in specific regions
- **Automatic Image Scanning**: Scan images on push for vulnerabilities
- **Lifecycle Policies**: Automatically expire old images
- **Encryption**: AES256 or KMS encryption support
- **Tag Mutability**: MUTABLE or IMMUTABLE tags
- **Repository Policies**: Pre-configured policies for ECS task pull access

## Configuration in site.hcl

```hcl
ecr = [
  {
    name                 = "webapp-nginx"
    regions              = ["us-east-1", "ca-central-1"]  # Deploy to multiple regions
    image_tag_mutability = "MUTABLE"    # or "IMMUTABLE"
    scan_on_push         = true
    encryption_type      = "AES256"     # or "KMS"

    lifecycle_policy = {
      max_image_count = 10   # Keep last 10 images
      expire_days     = 30   # Expire images older than 30 days
    }
  }
]
```

### Multi-Region Deployment

Simply list all regions where you want the repository created:

```hcl
ecr = [
  # Single region
  {
    name    = "run-mqtt-mosquitto"
    regions = ["us-east-1"]
    lifecycle_policy = { max_image_count = 10, expire_days = 30 }
  },

  # Multi-region (same repo in multiple regions)
  {
    name    = "webapp"
    regions = ["us-east-1", "ca-central-1"]
    lifecycle_policy = { max_image_count = 10, expire_days = 30 }
  }
]
```

The module will automatically create the repository in each specified region.

## Repository Naming

Repositories are automatically prefixed with the site label:
- Configuration: `name = "webapp-nginx"`
- Actual repo: `<site_label>-webapp-nginx`
- Full URL: `{account_id}.dkr.ecr.{region}.amazonaws.com/<site_label>-webapp-nginx`

## Lifecycle Policies

Two rules are created when lifecycle_policy is specified:
1. **Image Count**: Keep only the last N images
2. **Age**: Expire images older than N days

Both rules must be satisfied - an image will be removed if it exceeds EITHER limit.

## Outputs

The module provides several outputs for use in task definitions:

```hcl
# All repository details
repositories = {
  "webapp-nginx" = {
    repository_name = "<site_label>-webapp-nginx"
    repository_url  = "123456789012.dkr.ecr.us-east-1.amazonaws.com/<site_label>-webapp-nginx"
    arn            = "arn:aws:ecr:us-east-1:123456789012:repository/<site_label>-webapp-nginx"
    # ... more fields
  }
}

# Quick URL lookup
repository_urls = {
  "webapp-nginx" = "123456789012.dkr.ecr.us-east-1.amazonaws.com/<site_label>-webapp-nginx"
}

# URLs with :latest tag for easy copy-paste
repository_urls_with_latest = {
  "webapp-nginx" = "123456789012.dkr.ecr.us-east-1.amazonaws.com/<site_label>-webapp-nginx:latest"
}
```

## Using Repository URLs in Task Definitions

Reference repositories using the output:

```hcl
# In ecs-task terragrunt.hcl
dependency "ecr" {
  config_path = "../ecr"
}

# In task definition
containers = [
  {
    name  = "nginx"
    image = dependency.ecr.outputs.repository_urls["webapp-nginx"]
    # Or with tag:
    # image = "${dependency.ecr.outputs.repository_urls["webapp-nginx"]}:v1.0.0"
  }
]
```

## Pushing Images to ECR

### 1. Authenticate Docker to ECR

```bash
# Get ECR login password and authenticate
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  {account_id}.dkr.ecr.us-east-1.amazonaws.com
```

### 2. Build and Tag Image

```bash
# Build image
docker build -t webapp-nginx .

# Tag for ECR
docker tag webapp-nginx:latest \
  {account_id}.dkr.ecr.us-east-1.amazonaws.com/<site_label>-webapp-nginx:latest

# Or with version tag
docker tag webapp-nginx:latest \
  {account_id}.dkr.ecr.us-east-1.amazonaws.com/<site_label>-webapp-nginx:v1.0.0
```

### 3. Push to ECR

```bash
# Push latest
docker push {account_id}.dkr.ecr.us-east-1.amazonaws.com/<site_label>-webapp-nginx:latest

# Push version
docker push {account_id}.dkr.ecr.us-east-1.amazonaws.com/<site_label>-webapp-nginx:v1.0.0
```

### Script Example

```bash
#!/bin/bash
set -e

# Variables
AWS_REGION="us-east-1"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REPO_NAME="<site_label>-webapp-nginx"
IMAGE_TAG="${1:-latest}"

# Authenticate
echo "Authenticating to ECR..."
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Build
echo "Building image..."
docker build -t $REPO_NAME:$IMAGE_TAG .

# Tag
echo "Tagging image..."
docker tag $REPO_NAME:$IMAGE_TAG \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO_NAME:$IMAGE_TAG

# Push
echo "Pushing image..."
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPO_NAME:$IMAGE_TAG

echo "Successfully pushed $REPO_NAME:$IMAGE_TAG"
```

## Benefits of Regions List

Instead of duplicating repository definitions:

**Old approach (verbose):**
```hcl
ecr_repositories = [
  { name = "webapp", region = "us-east-1", lifecycle_policy = {...} },
  { name = "webapp", region = "ca-central-1", lifecycle_policy = {...} }
]
```

**New approach (concise):**
```hcl
ecr = [
  { name = "webapp", regions = ["us-east-1", "ca-central-1"], lifecycle_policy = {...} }
]
```

This approach:
- **Reduces duplication**: Define each repository once
- **Easier maintenance**: Change lifecycle policies in one place
- **Clear intent**: Immediately see which repos are multi-region
- **Scalable**: Add new regions by updating one list

## Deployment

```bash
# Create repositories in us-east-1
cd infra/terraform/live/site/region/us-east-1/ecr
terragrunt apply

# Create repositories in ca-central-1
cd infra/terraform/live/site/region/ca-central-1/ecr
terragrunt apply
```

## Security

### Repository Policies

Two policies are automatically created:
1. **AllowPullFromECS**: ECS tasks can pull images
2. **AllowPushPull**: Account root can push and pull

### Image Scanning

When `scan_on_push = true`, ECR automatically scans images for:
- OS vulnerabilities (CVEs)
- Package vulnerabilities
- Results available in AWS Console

### Encryption

- **AES256**: AWS-managed encryption (default)
- **KMS**: Customer-managed KMS key for additional control

## Repository URLs by App Type

Based on site.hcl configuration:

### WebApp (NextJS)
- `<site_label>-webapp-nginx:latest`
- `<site_label>-webapp:latest`

### MQTT
- `<site_label>-run-mqtt-mosquitto:latest`
- `<site_label>-run-mqtt-meshtk:latest`
- `<site_label>-run-mqtt-nginx:latest`
- `<site_label>-run-mqtt-ghosts:latest`

### Strapi
- `<site_label>-strapi-nginx:latest`
- `<site_label>-strapi:latest`

### Etherpad
- `<site_label>-etherpad-nginx:latest`
- `<site_label>-etherpad:latest`

## Cost Optimization

Lifecycle policies help control storage costs:
- Free: 500MB storage per month
- Cost: $0.10/GB-month after that

With `max_image_count = 10` and average 500MB per image:
- Storage: ~5GB = $0.45/month per repository
