data "aws_caller_identity" "current" {}

# Cross-region replication configuration
locals {
  # Use site-level random suffix if provided, otherwise use per-region random
  # Site-level suffix allows deterministic bucket names across regions (single-apply replication)
  bucket_suffix = var.site.random_suffix != "" ? var.site.random_suffix : random_id.rnd.hex

  # Filter out the current region AND skipped regions from replica_regions
  replication_destinations = [
    for region in var.email.replica_regions :
    region if region.full != var.region.full && !contains(var.site.skip_regions, region.full)
  ]

  # Convert to map for for_each
  replication_destinations_map = {
    for region in local.replication_destinations :
    region.label => region
  }

  # Check if replication is enabled (has other regions to replicate to)
  replication_enabled = length(local.replication_destinations) > 0

  # Compute replica bucket ARNs deterministically when using site-level random suffix
  # This allows replication to work in a single apply without needing external data sources
  replica_bucket_arns = var.site.random_suffix != "" ? {
    for region_label, region_data in local.replication_destinations_map :
    region_label => "arn:aws:s3:::ses-inbox-${var.site.label}-${region_label}-${local.bucket_suffix}"
  } : {}

  # Replication is enabled immediately if we have deterministic bucket names
  can_configure_replication = local.replication_enabled && var.site.random_suffix != ""
}

# S3 bucket for storing received emails
resource "aws_s3_bucket" "received_emails" {
  bucket        = substr("ses-inbox-${var.site.label}-${var.region.label}-${local.bucket_suffix}", 0, 63)
  force_destroy = true
}

# Enable versioning for the bucket
resource "aws_s3_bucket_versioning" "received_emails" {
  bucket = aws_s3_bucket.received_emails.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Block public access
resource "aws_s3_bucket_public_access_block" "received_emails" {
  bucket                  = aws_s3_bucket.received_emails.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle policy for 90-day retention
resource "aws_s3_bucket_lifecycle_configuration" "received_emails" {
  bucket = aws_s3_bucket.received_emails.id
  rule {
    id     = "delete-after-90-days"
    status = "Enabled"

    expiration {
      days = 90
    }

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

# Server-side encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "received_emails" {
  bucket = aws_s3_bucket.received_emails.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Bucket policy to allow SES to write emails and replication from other regions
resource "aws_s3_bucket_policy" "received_emails" {
  bucket = aws_s3_bucket.received_emails.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Sid    = "AllowSESPuts"
        Effect = "Allow"
        Principal = {
          Service = "ses.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.received_emails.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceAccount" = data.aws_caller_identity.current.account_id
          }
          StringLike = {
            "AWS:SourceArn" = "arn:aws:ses:${var.region.full}:${data.aws_caller_identity.current.account_id}:receipt-rule-set/*"
          }
        }
      }
      ],
      # Add statements to allow replication from other regions (if replication is enabled)
      # This allows OTHER regions' replication roles to write replicated objects to this bucket
      local.replication_enabled ? [
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
          Resource = "${aws_s3_bucket.received_emails.arn}/*"
          Condition = {
            StringLike = {
              "aws:userid" = "AIDAI*:*" # IAM role sessions
            }
          }
        }
      ] : []
    )
  })
}

# S3 replication (IAM role, policy, and configuration) has been moved to the
# email-s3-replication module to allow cross-region dependency ordering.
# The email-s3-replication Terragrunt unit depends on all regional email units,
# ensuring destination buckets exist before configuring replication.
