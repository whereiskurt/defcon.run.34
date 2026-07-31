# heatmap-scheduler v1.0.0 — EventBridge Scheduler → invoker Lambda that POSTs
# the run.gpx internal heat-map build endpoint on a cron. The build route
# rescans every con-day run, reassembles the DC34 heat-map artifact and writes
# it to S3; this module is only the clock that pokes it.
#
# DELIBERATE COPY, NOT A SHARED MODULE. This is a structural copy of
# strava-sync-scheduler v1.1.0 rather than a second live unit of it, because
# that module hardcodes `function_name = "strava-sync-${var.region.label}"`
# (v1.1.0/main.tf:15) — a second unit would collide on every resource name.
# The alternative (generalising strava-sync-scheduler behind a
# `function_basename` variable in a new v1.2.0) would make every future
# heat-map change re-plan a live, applied Strava Lambda. Copying has zero blast
# radius on that unit, which is the boring option AGENTS.md asks for.
#
# The Lambda optionally attaches to a VPC (vpc_subnet_ids / vpc_security_group_ids)
# because sync_url can point at a VPC-private address (AWS Cloud Map / ECS
# service-discovery private DNS namespace) that a no-VPC Lambda cannot resolve
# or reach.

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  function_name = "heatmap-build-${var.region.label}"

  # Substitute the {region_label} placeholder so callers can share a single
  # shape across regions without a per-region unit (mirrors
  # bib-reconcile-lambda's local.ssm_kms_key_alias).
  ssm_kms_key_alias = replace(
    var.ssm_kms_key_alias,
    "{region_label}",
    var.region.label,
  )
}

data "archive_file" "sync" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/.lambda-zips/${local.function_name}.zip"
}

resource "aws_cloudwatch_log_group" "sync" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "sync" {
  function_name = local.function_name
  role          = aws_iam_role.sync.arn
  handler       = "index.handler"
  runtime       = var.lambda_runtime

  filename         = data.archive_file.sync.output_path
  source_code_hash = data.archive_file.sync.output_base64sha256

  timeout     = var.lambda_timeout
  memory_size = var.lambda_memory_size

  # Hard backstop against overlapping builds. The PRIMARY fix is the disjoint
  # schedules in the live unit (the hourly fires at minute 0, the daily at
  # minute 20, so they can never coincide) — this is belt-and-braces, because
  # the builder holds no lock and no idempotency key, so two concurrent
  # invocations mean two full DynamoDB scans and two full S3 fan-outs writing
  # the same key. NOTE this does NOT eliminate stacked invocations after a
  # genuine failure: the schedule's retry_policy still fires, those retries just
  # queue behind the single reserved slot instead of running alongside.
  # Account headroom measured before setting this (us-east-1): limit 1000,
  # unreserved 970 (30 already reserved across 4 other functions) — AWS requires
  # at least 100 unreserved to remain, so reserving 1 more leaves 969.
  reserved_concurrent_executions = 1

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      # run.gpx internal endpoint that does the actual heat-map rebuild
      # (POST /{region}/api/gpx/internal/heatmap-build). The variable keeps the
      # SYNC_URL name because the invoker in lambda/index.mjs reads it.
      SYNC_URL = var.sync_url
      # SSM path of the shared internal secret (x-internal-secret header).
      INTERNAL_SYNC_SECRET_SSM_PATH = var.internal_sync_secret_ssm_path
    }
  }

  # Only attached when the caller supplies subnets — needed when sync_url is
  # a VPC-private service-discovery address (e.g. run-gpx's Cloud Map DNS name).
  dynamic "vpc_config" {
    for_each = length(var.vpc_subnet_ids) > 0 ? [1] : []
    content {
      subnet_ids         = var.vpc_subnet_ids
      security_group_ids = var.vpc_security_group_ids
    }
  }

  tags = {
    Name    = local.function_name
    Service = "run-gpx"
    Region  = var.region.label
    Site    = var.site.label
    Phase   = "71"
  }

  depends_on = [
    aws_iam_role_policy.sync,
    aws_cloudwatch_log_group.sync,
  ]
}

# EventBridge Scheduler crons → invoke the Lambda. One schedule per
# var.schedules entry, all sharing var.schedule_expression_timezone.
resource "aws_scheduler_schedule" "sync" {
  for_each = var.schedules

  name = "${local.function_name}-${each.key}"

  flexible_time_window {
    mode = "OFF"
  }

  # e.g. "rate(6 hours)" or "cron(0 10 * * ? *)".
  schedule_expression          = each.value
  schedule_expression_timezone = var.schedule_expression_timezone
  state                        = var.schedule_enabled ? "ENABLED" : "DISABLED"

  target {
    arn      = aws_lambda_function.sync.arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts = 2
    }
  }
}
