# Design: CloudFront Multi-Region Support

## Architecture Decision

### Why Hardcoding is Necessary

Terraform has a fundamental limitation: provider configurations must be statically defined at the module level. You cannot dynamically generate provider aliases based on variable input. This means:

```hcl
# NOT POSSIBLE in Terraform
dynamic "provider" {
  for_each = var.regions
  content {
    alias  = provider.value.label
    region = provider.value.full
  }
}
```

### Alternatives Considered

1. **Move bucket policies to regional modules**
   - Each region's `cloudfront-assets` module applies its own bucket policy
   - Pros: Cleaner separation, fully dynamic
   - Cons: Requires architectural restructuring, policy applied before distribution exists
   - Decision: **Rejected** - too invasive for the benefit

2. **Use child module with passed provider**
   - Create sub-module, call once per region with explicit provider
   - Pros: Reduces duplication
   - Cons: Still requires hardcoded providers at root, complex provider passing
   - Decision: **Rejected** - complexity not justified

3. **Hardcode all common regions upfront** (CHOSEN)
   - Pre-define 9 common AWS regions
   - Use `for_each` with skip check to conditionally create resources
   - Pros: Simple, explicit, future-proof
   - Cons: Requires adding new regions manually if exotic region needed
   - Decision: **Selected** - simplest approach, covers 99% of use cases

## Implementation Pattern

### Provider Configuration

```hcl
# providers/global.hcl - Add regional providers
provider "aws" {
  alias  = "usw2"
  region = "us-west-2"
  ${local.application_profile_line}
}
```

### Bucket Policy Resources

Each region gets two resource blocks following this pattern:

```hcl
# CloudFront assets bucket policy
resource "aws_s3_bucket_policy" "cf_oac_access_{label}" {
  for_each = {
    for domain in var.cloudfront.domains : domain => var.regional_origins_by_domain[domain]["{label}"]
    if contains(keys(var.regional_origins_by_domain[domain]), "{label}") &&
    !contains(local.skipped_region_labels, "{label}")
  }
  # ... policy content
  provider = aws.{label}
}

# CMS media bucket policy
resource "aws_s3_bucket_policy" "cms_media_oac_access_{label}" {
  for_each = (
    !contains(local.skipped_region_labels, "{label}") &&
    contains(keys(var.cms_media_origins), "{label}") &&
    try(var.cms_media_origins["{label}"].s3_bucket_id, "") != "" &&
    !startswith(try(var.cms_media_origins["{label}"].s3_bucket_id, ""), "mock-")
  ) ? toset(["cms"]) : toset([])
  # ... policy content
  provider = aws.{label}
}
```

### Terragrunt Dependencies

For each new region, add to `global/cloudfront/terragrunt.hcl`:

```hcl
dependency "{label}_cloudfront" {
  config_path = "../../region/{region-full}/cloudfront"
  mock_outputs = { ... }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy", "apply"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}

dependency "{label}_network" {
  config_path = "../../region/{region-full}/network"
  mock_outputs = { ... }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy", "apply"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}

dependency "{label}_uploads" {
  config_path = "../../region/{region-full}/s3-uploads"
  mock_outputs = { ... }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy", "apply"]
  mock_outputs_merge_strategy_with_state  = "shallow"
}
```

And update the `inputs` block to include the new region in `regional_origins_by_domain` and `cms_media_origins`.

## Region Label Convention

| Label | Full Region Name |
|-------|------------------|
| `use1` | us-east-1 |
| `use2` | us-east-2 |
| `usw1` | us-west-1 |
| `usw2` | us-west-2 |
| `cac1` | ca-central-1 |
| `euw1` | eu-west-1 |
| `euc1` | eu-central-1 |
| `apse1` | ap-southeast-1 |
| `apse2` | ap-southeast-2 |

## Skip Behavior

When a region is not in use:
1. If region directory doesn't exist → Terragrunt skips dependency (uses mock outputs)
2. If region in `skip_regions` → `skipped_region_labels` local filters out the region
3. Bucket policy `for_each` evaluates to empty → resource not created

This ensures no errors when regions are configured but not deployed.
