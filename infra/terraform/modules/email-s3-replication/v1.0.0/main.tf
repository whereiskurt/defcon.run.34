data "aws_caller_identity" "current" {}

locals {
  bucket_suffix = var.site.random_suffix

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

  replication_enabled = length(local.replication_destinations) > 0

  # Compute replica bucket ARNs deterministically using site-level random suffix
  replica_bucket_arns = var.site.random_suffix != "" ? {
    for region_label, region_data in local.replication_destinations_map :
    region_label => "arn:aws:s3:::ses-inbox-${var.site.label}-${region_label}-${local.bucket_suffix}"
  } : {}

  can_configure_replication = local.replication_enabled && var.site.random_suffix != ""
}

# IAM role for S3 replication
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
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
          ArnLike = {
            "aws:SourceArn" = var.source_bucket.arn
          }
        }
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
        Resource = var.source_bucket.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging"
        ]
        Resource = "${var.source_bucket.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags"
        ]
        Resource = [
          for region_label, bucket_arn in local.replica_bucket_arns :
          "${bucket_arn}/*"
        ]
      }
    ]
  })
}

# S3 bucket replication configuration
resource "aws_s3_bucket_replication_configuration" "received_emails" {
  count = local.can_configure_replication ? 1 : 0

  bucket = var.source_bucket.name
  role   = aws_iam_role.replication[0].arn

  dynamic "rule" {
    for_each = local.replication_destinations_map
    content {
      id       = "replicate-to-${rule.value.label}"
      priority = index(keys(local.replication_destinations_map), rule.key)
      status   = "Enabled"

      filter {}

      destination {
        bucket        = local.replica_bucket_arns[rule.key]
        storage_class = "STANDARD"

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

      delete_marker_replication {
        status = "Enabled"
      }
    }
  }
}
