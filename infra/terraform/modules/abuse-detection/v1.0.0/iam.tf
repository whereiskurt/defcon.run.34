# =============================================================================
# abuse-detection — detector Lambda execution role (T-41-05: least privilege)
#
# One execution role + one inline policy, Sid-per-concern (crib: bib-reconcile),
# EVERY statement ARN-scoped — no account-wide wildcards except the two that AWS
# requires (X-Ray telemetry, which does not support resource scoping).
#
#   - Logs   : write to the detector's own log group only.
#   - X-Ray  : telemetry for Active tracing (resource-scoping unsupported by AWS).
#   - Athena : run/read queries in the dcr-abuse-analysis workgroup only.
#   - Glue   : catalog reads Athena needs — catalog + the one db + the one table.
#   - S3 (r) : read the ALB-log bucket at the exact access prefix (read-only).
#   - S3 (rw): read/write the dual-role results bucket (query-results/ + abuse/).
#   - SNS    : publish ONLY to the reused Phase 40 topic ARN (not "*").
#
# Resource attributes are referenced where they exist (workgroup/db/table/bucket
# ARNs) instead of re-composing strings.
# data.aws_caller_identity.current / data.aws_region.current live in athena.tf.
# =============================================================================

resource "aws_iam_role" "detector" {
  name = substr("${local.function_name}-role", 0, 64)

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      },
    ]
  })

  tags = merge(var.tags, {
    Name      = "${local.function_name}-role"
    Site      = var.site.label
    Region    = var.region.label
    Purpose   = "abuse-detection"
    ManagedBy = "Terragrunt"
  })
}

resource "aws_iam_role_policy" "detector" {
  name = "${local.function_name}-policy"
  role = aws_iam_role.detector.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # CloudWatch Logs — write to the detector's own log group only.
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${aws_cloudwatch_log_group.detector.arn}:*"
      },

      # X-Ray — required for tracing_config { mode = "Active" }. AWS does not
      # support resource-level scoping for these actions.
      {
        Sid    = "XRayTracing"
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
        ]
        Resource = "*"
      },

      # Athena — run/read/stop queries in the capped workgroup only.
      {
        Sid    = "AthenaWorkgroupQueries"
        Effect = "Allow"
        Action = [
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:StopQueryExecution",
        ]
        Resource = aws_athena_workgroup.abuse.arn
      },

      # Glue — catalog reads Athena needs to plan the scan: the account catalog,
      # the one abuse database, and the one alb_access_logs table.
      {
        Sid    = "GlueCatalogRead"
        Effect = "Allow"
        Action = [
          "glue:GetTable",
          "glue:GetDatabase",
          "glue:GetPartitions",
        ]
        Resource = [
          "arn:aws:glue:${data.aws_region.current.id}:${data.aws_caller_identity.current.account_id}:catalog",
          aws_glue_catalog_database.abuse.arn,
          aws_glue_catalog_table.alb_access_logs.arn,
        ]
      },

      # S3 read — the REAL ALB-log bucket, read-only, scoped to the access prefix.
      {
        Sid    = "AlbLogsRead"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket",
        ]
        Resource = [
          "arn:aws:s3:::${var.alb_logs_bucket_name}",
          "arn:aws:s3:::${var.alb_logs_bucket_name}/${var.alb_logs_prefix}/*",
        ]
      },

      # S3 read/write — the dual-role results bucket: Athena writes query-results/,
      # the handler writes abuse/ findings + digest + state dedup markers.
      {
        Sid    = "ResultsBucketReadWrite"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket",
        ]
        Resource = [
          aws_s3_bucket.results.arn,
          "${aws_s3_bucket.results.arn}/*",
        ]
      },

      # SNS — publish ONLY to the reused Phase 40 topic (composed from
      # var.sns_topic_name); never a wildcard. Mirrors local.sns_topic_arn.
      {
        Sid      = "PublishToReusedTopic"
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = "arn:aws:sns:${data.aws_region.current.id}:${data.aws_caller_identity.current.account_id}:${var.sns_topic_name}"
      },
    ]
  })
}
