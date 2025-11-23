# Skip Regions Feature

## Overview

The `skip_regions` feature allows you to selectively disable entire regions during deployment without commenting out code. This is useful for:
- Development/testing in a single region
- Cost optimization by temporarily disabling regions
- Phased rollouts (deploy to us-east-1 first, then expand)
- Quick region toggling

## Usage

### Enable Skip for a Region

In `/live/site/site.hcl`:

```hcl
locals {
  site = {
    label        = "dc34"
    random_suffix = get_env("SGUID", "80a6b349")
    skip_regions = ["ca-central-1"]  # Skip ca-central-1, deploy only to us-east-1
  }
}
```

### Deploy to All Regions

```hcl
locals {
  site = {
    label        = "dc34"
    random_suffix = get_env("SGUID", "80a6b349")
    skip_regions = []  # Deploy to all regions
  }
}
```

### Skip Multiple Regions

```hcl
locals {
  site = {
    skip_regions = ["ca-central-1", "us-west-2"]  # Only deploy to us-east-1
  }
}
```

## How It Works

### 1. Centralized Skip Logic

`/live/site/region/skip.hcl` contains the skip logic:

```hcl
locals {
  site_config   = read_terragrunt_config(find_in_parent_folders("site.hcl"))
  region_config = read_terragrunt_config(find_in_parent_folders("region.hcl"))

  should_skip = contains(
    local.site_config.locals.site.skip_regions,
    local.region_config.locals.region.full
  )
}

skip = local.should_skip
```

### 2. Regional Modules Include Skip Check

Each regional module's `terragrunt.hcl` includes:

```hcl
include "skip" {
  path   = "${find_in_parent_folders("region")}/skip.hcl"
  expose = true
}
```

When `skip = true`, Terragrunt will not execute the module.

### 3. Global Modules Never Skip

Global resources (site, cloudfront) do NOT include `skip.hcl` and are always deployed, even if their region is in `skip_regions`.

## Regional vs Global Resources

### Regional Resources (WILL be skipped)

These modules include `skip.hcl`:
- ✅ `region/*/network` - VPC, subnets, ALB/NLB
- ✅ `region/*/ecs-cluster` - ECS clusters and service discovery
- ✅ `region/*/ecs-task` - Task definitions
- ✅ `region/*/ecs-service` - ECS services
- ✅ `region/*/ecr` - Container image repositories
- ✅ `region/*/dynamodb` - Regional DynamoDB tables
- ✅ `region/*/certs` - ACM certificates
- ✅ `region/*/email` - SES configuration
- ✅ `region/*/ec2spot` - EC2 spot instances

### Global Resources (NEVER skipped)

These modules do NOT include `skip.hcl`:
- ❌ `site` - Route53 hosted zone (always us-east-1)
- ❌ `cloudfront` - CloudFront distribution (global)

Global resources are deployed to their default region regardless of `skip_regions` setting.

## Examples

### Example 1: Single Region Development

Deploy only to us-east-1 for development:

```hcl
# site.hcl
locals {
  site = {
    skip_regions = ["ca-central-1"]
  }
}
```

```bash
terragrunt run-all apply
```

**Result:**
- ✅ us-east-1: All resources deployed
- ❌ ca-central-1: All regional resources skipped
- ✅ Global: site, cloudfront deployed

### Example 2: Phased Rollout

1. **Phase 1 - Deploy to Primary Region**

```hcl
skip_regions = ["ca-central-1"]
```

```bash
terragrunt run-all apply
# Test in us-east-1
```

2. **Phase 2 - Expand to All Regions**

```hcl
skip_regions = []
```

```bash
terragrunt run-all apply
# ca-central-1 resources now deployed
```

### Example 3: Cost Optimization

Temporarily disable secondary region:

```hcl
skip_regions = ["ca-central-1"]
```

```bash
terragrunt run-all apply
# ca-central-1 resources will be destroyed
```

To re-enable:

```hcl
skip_regions = []
```

```bash
terragrunt run-all apply
# ca-central-1 resources recreated
```

## Verification

### Check Which Modules Will Run

```bash
cd /Users/khundeck/working/defcon.run.34/infra/terraform/live/site
terragrunt run-all plan --terragrunt-non-interactive
```

Look for modules marked as "skipped" in the output.

### Verify Skip Configuration

```bash
# Check us-east-1 (should NOT be skipped if skip_regions = ["ca-central-1"])
cd region/us-east-1/network
terragrunt plan

# Check ca-central-1 (should be skipped if skip_regions = ["ca-central-1"])
cd region/ca-central-1/network
terragrunt plan
# Should show: "This module is being skipped"
```

## Deployment Order with Skip

Terragrunt respects dependencies even with skipped regions:

```
Group 1: ECR (us-east-1 only, ca-central-1 skipped)
Group 2: Certs (us-east-1 only, ca-central-1 skipped)
Group 3: Network (us-east-1 only, ca-central-1 skipped)
Group 4: ECS Clusters (us-east-1 only, ca-central-1 skipped)
Group 5: ECS Tasks (us-east-1 only, ca-central-1 skipped)
Group 6: ECS Services (us-east-1 only, ca-central-1 skipped)
Global: site, cloudfront (always deployed)
```

## Troubleshooting

### Issue: Global resources are skipped

**Problem:** CloudFront or site module not deploying.

**Solution:** Ensure these modules do NOT have `include "skip"` in their `terragrunt.hcl`.

```bash
# Check for incorrect skip include
grep -r 'include "skip"' cloudfront/terragrunt.hcl terragrunt.hcl
# Should return nothing
```

### Issue: Region still deploying when it should be skipped

**Problem:** Regional module not respecting `skip_regions`.

**Solution:** Ensure the module includes skip.hcl:

```bash
# Check if skip include exists
head -10 region/ca-central-1/network/terragrunt.hcl
# Should show:
# include "skip" {
#   path = "${find_in_parent_folders("region")}/skip.hcl"
#   expose = true
# }
```

### Issue: Dependencies between skipped and active regions

**Problem:** us-east-1 module depends on ca-central-1 output.

**Solution:** Cross-region dependencies are not supported. Each region should be independent. If you need cross-region dependencies, don't use `skip_regions` for those regions.

## Best Practices

1. **Start with single region**: Set `skip_regions = ["ca-central-1"]` initially, test in us-east-1
2. **Expand gradually**: Remove regions from skip list one at a time
3. **Use for development**: Keep dev environments single-region to reduce costs
4. **Production multi-region**: Set `skip_regions = []` for production
5. **Document changes**: Comment why a region is skipped in site.hcl

## Performance Impact

Skipped modules are evaluated but not executed:
- **Plan time**: Minimal impact (skip check is fast)
- **Apply time**: Significant savings (no AWS API calls for skipped modules)
- **State size**: Skipped modules not in state

## Related Features

- **Multi-region resources** (ecr, dynamodb, etc.) automatically filter to active regions
- **Regions list pattern** (ecs_tasks, ecs_services, etc.) respect skip_regions
- **Global resources** always deploy regardless of skip_regions
