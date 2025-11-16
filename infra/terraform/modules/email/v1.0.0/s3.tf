data "aws_caller_identity" "current" {}

# Cross-region replication configuration
locals {
  # Use site-level random suffix if provided, otherwise use per-region random
  # Site-level suffix allows deterministic bucket names across regions (single-apply replication)
  bucket_suffix = var.site.random_suffix != "" ? var.site.random_suffix : random_id.rnd.hex

  # Filter out the current region from replica_regions to get only OTHER regions to replicate to
  replication_destinations = [
    for region in var.email.replica_regions :
    region if region.full != var.region.full
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

# IAM role for S3 replication
# Single role that has permissions to replicate to all destination regions
resource "aws_iam_role" "replication" {
  count = local.can_configure_replication ? 1 : 0
  name  = "s3-replication-${var.site.label}-${var.region.label}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "s3.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name        = "S3 Replication Role - ${var.region.label}"
    Description = "Allows S3 to replicate objects from ${var.region.full} to other regions"
  }
}

# IAM policy for replication role
resource "aws_iam_role_policy" "replication" {
  count = local.can_configure_replication ? 1 : 0
  role  = aws_iam_role.replication[0].id
  name  = "s3-replication-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.received_emails.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging"
        ]
        Resource = "${aws_s3_bucket.received_emails.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags"
        ]
        Resource = [
          for region_label, region_data in local.replication_destinations_map :
          "${local.replica_bucket_arns[region_label]}/*"
        ]
      }
    ]
  })
}

# S3 bucket replication configuration
resource "aws_s3_bucket_replication_configuration" "received_emails" {
  count = local.can_configure_replication ? 1 : 0

  # Replication requires versioning to be enabled
  depends_on = [aws_s3_bucket_versioning.received_emails]

  bucket = aws_s3_bucket.received_emails.id
  role   = aws_iam_role.replication[0].arn

  dynamic "rule" {
    for_each = local.replication_destinations_map
    content {
      id     = "replicate-to-${rule.value.label}"
      status = "Enabled"

      # Replicate all objects
      filter {}

      destination {
        bucket        = local.replica_bucket_arns[rule.key]
        storage_class = "STANDARD"

        # Enable replica modification sync for bidirectional replication
        replication_time {
          status = "Enabled"
          time {
            minutes = 15
          }
        }

        metrics {
          status = "Enabled"
          event_threshold {
            minutes = 15
          }
        }
      }

      # Delete marker replication
      delete_marker_replication {
        status = "Enabled"
      }
    }
  }
}
