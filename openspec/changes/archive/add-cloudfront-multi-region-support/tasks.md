# Tasks: Add CloudFront Multi-Region Support

## Overview

Add support for 7 additional AWS regions (total 9) to the CloudFront module.

## Tasks

### Phase 1: Provider Configuration

- [ ] **1.1** Add regional provider aliases to `providers/global.hcl`
  - Add: `use2`, `usw1`, `usw2`, `euw1`, `euc1`, `apse1`, `apse2`
  - Follow existing pattern from `use1` and `cac1`

### Phase 2: CloudFront Module Updates

- [ ] **2.1** Add bucket policy resources for `use2` (us-east-2)
  - Add `aws_s3_bucket_policy.cf_oac_access_use2`
  - Add `aws_s3_bucket_policy.cms_media_oac_access_use2`
  - Use `provider = aws.use2`

- [ ] **2.2** Add bucket policy resources for `usw1` (us-west-1)
  - Add `aws_s3_bucket_policy.cf_oac_access_usw1`
  - Add `aws_s3_bucket_policy.cms_media_oac_access_usw1`
  - Use `provider = aws.usw1`

- [ ] **2.3** Add bucket policy resources for `usw2` (us-west-2)
  - Add `aws_s3_bucket_policy.cf_oac_access_usw2`
  - Add `aws_s3_bucket_policy.cms_media_oac_access_usw2`
  - Use `provider = aws.usw2`

- [ ] **2.4** Add bucket policy resources for `euw1` (eu-west-1)
  - Add `aws_s3_bucket_policy.cf_oac_access_euw1`
  - Add `aws_s3_bucket_policy.cms_media_oac_access_euw1`
  - Use `provider = aws.euw1`

- [ ] **2.5** Add bucket policy resources for `euc1` (eu-central-1)
  - Add `aws_s3_bucket_policy.cf_oac_access_euc1`
  - Add `aws_s3_bucket_policy.cms_media_oac_access_euc1`
  - Use `provider = aws.euc1`

- [ ] **2.6** Add bucket policy resources for `apse1` (ap-southeast-1)
  - Add `aws_s3_bucket_policy.cf_oac_access_apse1`
  - Add `aws_s3_bucket_policy.cms_media_oac_access_apse1`
  - Use `provider = aws.apse1`

- [ ] **2.7** Add bucket policy resources for `apse2` (ap-southeast-2)
  - Add `aws_s3_bucket_policy.cf_oac_access_apse2`
  - Add `aws_s3_bucket_policy.cms_media_oac_access_apse2`
  - Use `provider = aws.apse2`

### Phase 3: Validation

- [ ] **3.1** Run `terraform fmt` on modified files
- [ ] **3.2** Run `terraform validate` to confirm syntax
- [ ] **3.3** Run `terragrunt run-all plan` to confirm no changes to existing infrastructure
  - Existing use1/cac1 should show no drift
  - New regions should not create resources (not in cloudfront.regions)

## Notes

- Tasks 2.1-2.7 are parallelizable
- Terragrunt dependencies for new regions can be added later when a region is actually needed
- The `skip_regions` mechanism ensures unused regions don't cause errors
