data "aws_caller_identity" "current" {}

locals {
  bucket_suffix = var.site.random_suffix

  # Filter uploads for current region that have replication enabled
  region_uploads = {
    for upload in var.user_uploads :
    upload.name => upload
    if contains(upload.regions, var.region.full) && upload.replication.enabled && var.site.random_suffix != ""
  }

  # Replication configuration per upload (skip if source bucket not yet available, e.g. mock outputs)
  replication_config = {
    for name, upload in local.region_uploads :
    name => {
      source_bucket_id  = var.source_buckets[name].name
      source_bucket_arn = var.source_buckets[name].arn
      service_name      = upload.service_name
      destinations = [
        for region in upload.replication.replica_regions :
        region if region.full != var.region.full && !contains(var.site.skip_regions, region.full)
      ]
      replica_bucket_arns = {
        for region in upload.replication.replica_regions :
        region.label => "arn:aws:s3:::uploads-${var.site.label}-${name}-${region.label}-${local.bucket_suffix}"
        if region.full != var.region.full && !contains(var.site.skip_regions, region.full)
      }
    }
    if contains(keys(var.source_buckets), name)
  }

  # Only include configs with actual destinations
  active_replication = {
    for name, config in local.replication_config :
    name => config if length(config.destinations) > 0
  }
}

# IAM role for S3 replication
resource "aws_iam_role" "replication" {
  for_each = local.active_replication

  name = substr("s3-repl-${var.site.label}-${each.key}-${var.region.label}", 0, 64)

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
            "aws:SourceArn" = each.value.source_bucket_arn
          }
        }
      }
    ]
  })

  tags = {
    Name        = "S3 Replication Role - ${each.key}"
    Description = "Allows S3 to replicate ${each.key} uploads from ${var.region.full}"
    Service     = each.value.service_name
    Site        = var.site.label
  }
}

# IAM policy for replication role
resource "aws_iam_role_policy" "replication" {
  for_each = local.active_replication

  role = aws_iam_role.replication[each.key].id
  name = "s3-replication-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket"
        ]
        Resource = each.value.source_bucket_arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging"
        ]
        Resource = "${each.value.source_bucket_arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags"
        ]
        Resource = [
          for region_label, bucket_arn in each.value.replica_bucket_arns :
          "${bucket_arn}/*"
        ]
      }
    ]
  })
}

# S3 bucket replication configuration
resource "aws_s3_bucket_replication_configuration" "uploads" {
  for_each = local.active_replication

  bucket = each.value.source_bucket_id
  role   = aws_iam_role.replication[each.key].arn

  dynamic "rule" {
    for_each = each.value.replica_bucket_arns
    content {
      id       = "replicate-to-${rule.key}"
      priority = index(keys(each.value.replica_bucket_arns), rule.key)
      status   = "Enabled"

      filter {}

      destination {
        bucket        = rule.value
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
