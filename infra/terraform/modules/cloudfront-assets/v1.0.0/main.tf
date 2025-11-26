data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "random_id" "rnd" {
  byte_length = 8
}

# Local to create a set of domains for for_each loops
locals {
  domain_set = toset(var.cloudfront.domains)
}

# S3 bucket for CloudFront assets - one per domain
resource "aws_s3_bucket" "cf_assets" {
  for_each = local.domain_set

  bucket        = "cf-assets-${each.key}-${var.region.label}-${replace(var.dns.zonename, ".", "-")}-${random_id.rnd.hex}"
  force_destroy = var.force_destroy

  tags = merge(
    var.tags,
    {
      Name        = "${each.key}-${var.region.label}-cf-assets"
      Region      = var.region.full
      Purpose     = "CloudFront Assets"
      Environment = var.site.label
      Domain      = "${each.key}.${var.dns.zonename}"
    }
  )
}

# Enable versioning for the assets bucket
resource "aws_s3_bucket_versioning" "cf_assets_versioning" {
  for_each = local.domain_set

  bucket = aws_s3_bucket.cf_assets[each.key].id
  versioning_configuration {
    status = var.enable_versioning ? "Enabled" : "Suspended"
  }
}

# Server-side encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "cf_assets_encryption" {
  for_each = local.domain_set

  bucket = aws_s3_bucket.cf_assets[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Block public access
resource "aws_s3_bucket_public_access_block" "cf_assets_public_access_block" {
  for_each = local.domain_set

  bucket = aws_s3_bucket.cf_assets[each.key].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CORS configuration for CloudFront
resource "aws_s3_bucket_cors_configuration" "cf_assets_cors" {
  for_each = local.domain_set

  bucket = aws_s3_bucket.cf_assets[each.key].id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = var.cors_allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# Lifecycle rules for asset management
resource "aws_s3_bucket_lifecycle_configuration" "cf_assets_lifecycle" {
  for_each = var.enable_lifecycle_rules ? local.domain_set : toset([])

  bucket = aws_s3_bucket.cf_assets[each.key].id

  rule {
    id     = "delete-old-versions"
    status = "Enabled"

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Note: S3 bucket policies for CloudFront OAC access are created in the
# global/cloudfront module using regional provider aliases (aws.use1, aws.cac1)
# since bucket policy API calls must be made to the correct regional endpoint.
