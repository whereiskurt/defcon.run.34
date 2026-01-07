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
