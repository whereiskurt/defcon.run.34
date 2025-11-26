# SSM Parameters for CloudFront Assets configuration
# Parameters are stored in a hierarchical structure for easy lookup

locals {
  ssm_prefixes = {
    for domain in var.cloudfront.domains :
    domain => "/${var.site.label}/cloudfront-assets/${var.region.label}/${domain}"
  }
}

# Bucket name for each domain
resource "aws_ssm_parameter" "bucket_name" {
  for_each = local.domain_set

  name        = "${local.ssm_prefixes[each.key]}/bucket_name"
  description = "S3 bucket name for CloudFront assets for ${each.key} in ${var.region.label}"
  type        = "String"
  value       = aws_s3_bucket.cf_assets[each.key].id

  tags = {
    Site   = var.site.label
    Region = var.region.label
    Domain = each.key
  }
}

# Bucket ARN for each domain
resource "aws_ssm_parameter" "bucket_arn" {
  for_each = local.domain_set

  name        = "${local.ssm_prefixes[each.key]}/bucket_arn"
  description = "S3 bucket ARN for CloudFront assets for ${each.key} in ${var.region.label}"
  type        = "String"
  value       = aws_s3_bucket.cf_assets[each.key].arn

  tags = {
    Site   = var.site.label
    Region = var.region.label
    Domain = each.key
  }
}

# Bucket regional domain name for each domain
resource "aws_ssm_parameter" "bucket_regional_domain_name" {
  for_each = local.domain_set

  name        = "${local.ssm_prefixes[each.key]}/bucket_regional_domain_name"
  description = "S3 bucket regional domain name for CloudFront assets for ${each.key} in ${var.region.label}"
  type        = "String"
  value       = aws_s3_bucket.cf_assets[each.key].bucket_regional_domain_name

  tags = {
    Site   = var.site.label
    Region = var.region.label
    Domain = each.key
  }
}

# Bucket domain name for each domain
resource "aws_ssm_parameter" "bucket_domain_name" {
  for_each = local.domain_set

  name        = "${local.ssm_prefixes[each.key]}/bucket_domain_name"
  description = "S3 bucket domain name for CloudFront assets for ${each.key} in ${var.region.label}"
  type        = "String"
  value       = aws_s3_bucket.cf_assets[each.key].bucket_domain_name

  tags = {
    Site   = var.site.label
    Region = var.region.label
    Domain = each.key
  }
}

# Region (full name) for each domain
resource "aws_ssm_parameter" "region" {
  for_each = local.domain_set

  name        = "${local.ssm_prefixes[each.key]}/region"
  description = "AWS region for CloudFront assets bucket for ${each.key}"
  type        = "String"
  value       = var.region.full

  tags = {
    Site   = var.site.label
    Region = var.region.label
    Domain = each.key
  }
}

# S3 URL for each domain (s3:// format)
resource "aws_ssm_parameter" "s3_url" {
  for_each = local.domain_set

  name        = "${local.ssm_prefixes[each.key]}/s3_url"
  description = "S3 URL for CloudFront assets bucket for ${each.key} in ${var.region.label}"
  type        = "String"
  value       = "s3://${aws_s3_bucket.cf_assets[each.key].id}"

  tags = {
    Site   = var.site.label
    Region = var.region.label
    Domain = each.key
  }
}
