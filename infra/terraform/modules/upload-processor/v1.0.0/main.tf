data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # Filter processors for current region only
  region_processors = [
    for processor in var.upload_processors :
    processor if contains(processor.regions, var.region.full)
  ]

  # Resolve bucket and table references from dependency outputs
  resolved_processors = [
    for processor in local.region_processors :
    merge(processor, {
      # Look up bucket details from user_uploads_buckets by user_upload_name
      bucket_id  = var.user_uploads_buckets[processor.user_upload_name].name
      bucket_arn = var.user_uploads_buckets[processor.user_upload_name].arn

      # Look up table details from dynamodb_tables by dynamodb_table_ref
      dynamodb_table_name = var.dynamodb_tables[processor.dynamodb_table_ref].table_name
      dynamodb_table_arn  = var.dynamodb_tables[processor.dynamodb_table_ref].table_arn
      dynamodb_stream_arn = var.dynamodb_tables[processor.dynamodb_table_ref].stream_arn
    })
  ]

  # Create a map of processors by name for this region
  processors_map = {
    for processor in local.resolved_processors :
    processor.name => processor
  }
}

# SNS Topic for S3 upload notifications
resource "aws_sns_topic" "upload_notifications" {
  for_each = local.processors_map

  name = "uploads-${var.site.label}-${each.key}-${var.region.label}"

  tags = {
    Name    = "uploads-${var.site.label}-${each.key}-${var.region.label}"
    Service = each.value.service_name
    Region  = var.region.label
    Site    = var.site.label
  }
}

# SNS Topic Policy to allow S3 to publish
resource "aws_sns_topic_policy" "upload_notifications" {
  for_each = local.processors_map

  arn = aws_sns_topic.upload_notifications[each.key].arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowS3Publish"
        Effect = "Allow"
        Principal = {
          Service = "s3.amazonaws.com"
        }
        Action   = "sns:Publish"
        Resource = aws_sns_topic.upload_notifications[each.key].arn
        Condition = {
          ArnLike = {
            "aws:SourceArn" = each.value.bucket_arn
          }
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })
}

# S3 Bucket Notification to SNS
resource "aws_s3_bucket_notification" "upload_notifications" {
  for_each = local.processors_map

  bucket = each.value.bucket_id

  topic {
    topic_arn     = aws_sns_topic.upload_notifications[each.key].arn
    events        = ["s3:ObjectCreated:*"]
    filter_prefix = "uploads/"
  }

  depends_on = [aws_sns_topic_policy.upload_notifications]
}
