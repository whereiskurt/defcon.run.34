# Proposal: Add CloudFront Multi-Region Support

## Summary

Extend the CloudFront Terraform module to support additional AWS regions beyond the current `use1` (us-east-1) and `cac1` (ca-central-1). This enables future multi-region expansion without code changes.

## Problem

The CloudFront module has hardcoded region-specific resources:

1. **Provider aliases** in `providers/global.hcl` only define `use1` and `cac1`
2. **S3 bucket policies** in `modules/cloudfront/v1.0.0/main.tf` have separate resources for each region (`cf_oac_access_use1`, `cf_oac_access_cac1`, etc.)

This means adding a new region (e.g., `usw2` for us-west-2) requires manual code changes to both files.

## Constraints

- **Terraform limitation**: Provider aliases cannot be dynamically generated - they must be statically declared
- **S3 bucket policies**: Must be applied via the correct regional API endpoint (requires region-specific provider)
- **Terragrunt dependencies**: Each region needs corresponding dependency blocks in `global/cloudfront/terragrunt.hcl`

## Solution

Add pre-defined provider aliases and bucket policy resources for commonly-used AWS regions:

| Label | Region | Use Case |
|-------|--------|----------|
| `use1` | us-east-1 | Primary (existing) |
| `use2` | us-east-2 | Ohio failover |
| `usw1` | us-west-1 | N. California |
| `usw2` | us-west-2 | Oregon |
| `cac1` | ca-central-1 | Canada (existing) |
| `euw1` | eu-west-1 | Ireland |
| `euc1` | eu-central-1 | Frankfurt |
| `apse1` | ap-southeast-1 | Singapore |
| `apse2` | ap-southeast-2 | Sydney |

Regions are activated by:
1. Adding to `cloudfront.regions` in `site.hcl`
2. Creating the regional directory under `live/site/region/`
3. Adding Terragrunt dependencies in `global/cloudfront/terragrunt.hcl`

Unused regions are automatically skipped via the existing `skip_regions` mechanism.

## Impact

- **No breaking changes** - existing use1/cac1 configuration unchanged
- **Zero cost for unused regions** - resources only created for active regions
- **Enables future expansion** - add new regions without module changes

## Specs Affected

No existing specs affected. This is an infrastructure-only change.

## Related

- Recent fix: Added `skip_regions` check to bucket policy resources (prevents errors when region excluded)
