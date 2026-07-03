# strava-sync-scheduler (v1.7 Phase 33) — EventBridge Scheduler → invoker Lambda that
# POSTs the run.gpx internal Strava-sync endpoint on a cron. Modeled on
# bib-reconcile-lambda. DRAFT: authored without `terragrunt plan` in-sandbox — validate
# before apply.

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  function_name = "strava-sync-${var.region.label}"
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

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      # run.gpx internal endpoint that does the actual Strava pull.
      SYNC_URL = var.sync_url
      # SSM path of the shared internal secret (x-internal-secret header).
      INTERNAL_SYNC_SECRET_SSM_PATH = var.internal_sync_secret_ssm_path
    }
  }

  tags = {
    Name    = local.function_name
    Service = "run-gpx"
    Region  = var.region.label
    Site    = var.site.label
    Phase   = "33"
  }

  depends_on = [
    aws_iam_role_policy.sync,
    aws_cloudwatch_log_group.sync,
  ]
}

# EventBridge Scheduler cron → invoke the Lambda. First scheduler in this repo.
resource "aws_scheduler_schedule" "sync" {
  name = local.function_name

  flexible_time_window {
    mode = "OFF"
  }

  # e.g. "rate(6 hours)" or "cron(0 */6 * * ? *)".
  schedule_expression          = var.schedule_expression
  schedule_expression_timezone = "UTC"
  state                        = var.schedule_enabled ? "ENABLED" : "DISABLED"

  target {
    arn      = aws_lambda_function.sync.arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts = 2
    }
  }
}
