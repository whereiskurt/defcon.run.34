data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # Use site-level random suffix for deterministic bucket names across regions
  bucket_suffix = var.site.random_suffix

  # Filter uploads for current region only
  region_uploads = [
    for upload in var.user_uploads :
    upload if contains(upload.regions, var.region.full)
  ]

  # Create a map of uploads by name for this region
  uploads_map = {
    for upload in local.region_uploads :
    upload.name => merge(upload, {
      bucket_name = substr("uploads-${var.site.label}-${upload.name}-${var.region.label}-${local.bucket_suffix}", 0, 63)
    })
  }

  # Replication configuration per upload
  replication_config = {
    for name, upload in local.uploads_map :
    name => {
      enabled = upload.replication.enabled && var.site.random_suffix != ""
      destinations = [
        for region in upload.replication.replica_regions :
        region if region.full != var.region.full && !contains(var.site.skip_regions, region.full)
      ]
      # Compute deterministic replica bucket ARNs
      replica_bucket_arns = var.site.random_suffix != "" ? {
        for region in upload.replication.replica_regions :
        region.label => "arn:aws:s3:::uploads-${var.site.label}-${upload.name}-${region.label}-${local.bucket_suffix}"
        if region.full != var.region.full && !contains(var.site.skip_regions, region.full)
      } : {}
    }
  }
}

# S3 bucket for user uploads
resource "aws_s3_bucket" "uploads" {
  for_each = local.uploads_map

  bucket        = each.value.bucket_name
  force_destroy = true

  tags = {
    Name    = each.value.bucket_name
    Service = each.value.service_name
    Region  = var.region.label
    Site    = var.site.label
    Purpose = "user-uploads"
  }
}

# Enable versioning (conditional)
resource "aws_s3_bucket_versioning" "uploads" {
  for_each = local.uploads_map

  bucket = aws_s3_bucket.uploads[each.key].id

  versioning_configuration {
    status = each.value.lifecycle.enable_versioning ? "Enabled" : "Suspended"
  }
}

# Block all public access
resource "aws_s3_bucket_public_access_block" "uploads" {
  for_each = local.uploads_map

  bucket                  = aws_s3_bucket.uploads[each.key].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Server-side encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  for_each = local.uploads_map

  bucket = aws_s3_bucket.uploads[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Lifecycle configuration for uploads and processed folders
resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  for_each = local.uploads_map

  bucket = aws_s3_bucket.uploads[each.key].id

  # Rule for uploads/* prefix - auto-expire
  rule {
    id     = "expire-uploads"
    status = each.value.lifecycle.uploads_expire_days > 0 ? "Enabled" : "Disabled"

    filter {
      prefix = "uploads/"
    }

    expiration {
      days = each.value.lifecycle.uploads_expire_days > 0 ? each.value.lifecycle.uploads_expire_days : 1
    }

    noncurrent_version_expiration {
      noncurrent_days = each.value.lifecycle.uploads_expire_days > 0 ? each.value.lifecycle.uploads_expire_days : 1
    }
  }

  # Rule for processed/* prefix - optional expiration
  rule {
    id     = "expire-processed"
    status = each.value.lifecycle.processed_expire_days > 0 ? "Enabled" : "Disabled"

    filter {
      prefix = "processed/"
    }

    expiration {
      days = each.value.lifecycle.processed_expire_days > 0 ? each.value.lifecycle.processed_expire_days : 1
    }

    noncurrent_version_expiration {
      noncurrent_days = each.value.lifecycle.processed_expire_days > 0 ? each.value.lifecycle.processed_expire_days : 1
    }
  }

  # Clean up incomplete multipart uploads
  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {
      prefix = ""
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# CORS configuration for browser uploads
resource "aws_s3_bucket_cors_configuration" "uploads" {
  for_each = local.uploads_map

  bucket = aws_s3_bucket.uploads[each.key].id

  cors_rule {
    allowed_headers = try(each.value.cors.allowed_headers, ["*"])
    allowed_methods = try(each.value.cors.allowed_methods, ["GET", "PUT", "POST", "HEAD"])
    allowed_origins = try(each.value.cors.allowed_origins, ["*"])
    expose_headers  = try(each.value.cors.expose_headers, ["ETag"])
    max_age_seconds = try(each.value.cors.max_age_seconds, 3600)
  }
}

# Bucket policy to allow replication and deny non-HTTPS
# Skipped for cloudfront_access buckets — CloudFront module manages their full policy
resource "aws_s3_bucket_policy" "uploads" {
  for_each = {
    for name, upload in local.uploads_map :
    name => upload
    if !try(upload.cloudfront_access, false)
  }

  bucket = aws_s3_bucket.uploads[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      # Allow replication from other regions (if replication is enabled)
      local.replication_config[each.key].enabled && length(local.replication_config[each.key].destinations) > 0 ? [
        {
          Sid    = "AllowReplicationFromOtherRegions"
          Effect = "Allow"
          Principal = {
            AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
          }
          Action = [
            "s3:ReplicateObject",
            "s3:ReplicateDelete",
            "s3:ReplicateTags",
            "s3:GetObjectVersionTagging",
            "s3:ObjectOwnerOverrideToBucketOwner"
          ]
          Resource = "${aws_s3_bucket.uploads[each.key].arn}/*"
        }
      ] : [],
      # NOTE: CloudFront OAC bucket policies are managed by the CloudFront module
      # The cloudfront_access option in bucket configuration is a flag for documentation,
      # but the actual policy with AWS:SourceArn condition is applied by CloudFront module
      # This avoids circular dependency (s3-uploads doesn't know CF distribution ARN)
      # Deny non-HTTPS access
      [
        {
          Sid       = "DenyNonHTTPS"
          Effect    = "Deny"
          Principal = "*"
          Action    = "s3:*"
          Resource = [
            aws_s3_bucket.uploads[each.key].arn,
            "${aws_s3_bucket.uploads[each.key].arn}/*"
          ]
          Condition = {
            Bool = {
              "aws:SecureTransport" = "false"
            }
          }
        }
      ]
    )
  })
}

# S3 replication IAM roles and configuration are in a separate module
# (s3-uploads-replication) to ensure all destination buckets exist across
# all regions before replication is configured during apply-all.
