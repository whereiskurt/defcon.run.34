# CloudFront Infrastructure

Multi-region CloudFront distribution configuration for defcon.run services.

## ADDED Requirements

### Requirement: Multi-Region S3 Bucket Policy Support

The CloudFront module MUST support applying S3 bucket policies across multiple AWS regions without code changes when new regions are added to the configuration.

#### Scenario: Active region bucket policies created

Given the cloudfront.regions list includes a region
And the region is not in site.skip_regions
When terragrunt apply runs
Then S3 bucket policies are created for that region's CloudFront assets buckets
And S3 bucket policies are created for that region's CMS media buckets (if CMS enabled)

#### Scenario: Skipped region bucket policies not created

Given a region label is defined in the module
But the region is in site.skip_regions
When terragrunt apply runs
Then no S3 bucket policies are attempted for that region
And no errors occur from missing buckets

#### Scenario: Unconfigured region has no effect

Given a region provider is defined (e.g., usw2)
But the region is not in cloudfront.regions
When terragrunt apply runs
Then no resources are created for that region
And no Terragrunt dependency errors occur

### Requirement: Empty Origin Filtering

CloudFront distributions MUST filter out origins where the domain name is empty. This occurs when a region is skipped but dependency outputs still include placeholder entries.

#### Scenario: S3 origins filter empty domain names

Given a domain is in cloudfront.domains
And a region is in skip_regions
When CloudFront distribution is created
Then S3 origins for that region are NOT created
And no "domain_name must not be empty" error occurs

#### Scenario: ALB origins filter empty domain names

Given a domain is in cloudfront.domains
And a region has no ALB deployed
When CloudFront distribution is created
Then ALB origins for that region are NOT created
And default origin falls back to available ALB/S3

#### Scenario: Cache behaviors match available origins

Given a CloudFront distribution has filtered origins
When cache behaviors are created
Then cache behaviors only reference existing origins
And no "target_origin_id not found" errors occur

### Requirement: Terragrunt Dependency Graceful Fallbacks

Terragrunt dependencies for skipped regions MUST use `try()` wrappers to provide empty fallback values.

#### Scenario: Skipped region dependency outputs

Given a regional module (e.g., cloudfront-assets) is skipped
When the global CloudFront module reads dependency outputs
Then `try(dependency.outputs.value, "")` returns empty string
And no "Invalid index" errors occur

#### Implementation Pattern

```hcl
# In terragrunt.hcl - wrap skipped region lookups with try()
regional_origins_by_domain = {
  for domain in local.site_vars.locals.cloudfront.domains : domain => {
    use1 = {
      # Primary region - can use direct access
      s3_bucket_regional_domain_name = dependency.use1_cloudfront.outputs.bucket_regional_domain_names[domain]
    }
    cac1 = {
      # Secondary/skipped region - must use try() for graceful fallback
      s3_bucket_regional_domain_name = try(dependency.cac1_cloudfront.outputs.bucket_regional_domain_names[domain], "")
    }
  }
}
```

```hcl
# In Terraform module - filter dynamic blocks by non-empty values
dynamic "origin" {
  for_each = {
    for region_key, region_value in var.regional_origins_by_domain[each.key] :
    region_key => region_value
    if region_value.s3_bucket_regional_domain_name != ""  # Filter empty
  }
  content {
    domain_name = origin.value.s3_bucket_regional_domain_name
    origin_id   = "s3-${origin.key}"
  }
}
```
