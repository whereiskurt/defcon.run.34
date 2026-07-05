# =============================================================================
# abuse-detection — detector Lambda + EventBridge cron (AD-05, AD-06, AD-07)
#
# - aws_lambda_function `abuse-detector-{region}` packaged from ${path.module}/lambda
#   (Plan 04 lands index.mjs there; Plan 02 already put queries/ there).
# - Dedicated CloudWatch log group + Active X-Ray tracing.
# - EventBridge cron rule whose state derives from var.schedule_enabled, so
#   enabled=false in site.hcl ships the schedule DARK (AD-08 honored at the
#   schedule too) — only the named rule may invoke (aws_lambda_permission).
# - The FULL handler env-var contract Plan 04's index.mjs reads is set here.
#
# Storage discretion (design 3.3 / CONTEXT AD-06): NO new bucket, NO DynamoDB
# table. Findings (abuse/YYYY-MM-DD/findings.jsonl), the daily digest, and dedup
# markers (abuse/state/{ip}#{utc-date} JSON with the last-alerted count) all live
# under PREFIXES of the Plan 01 dual-role results bucket. S3-marker dedup is the
# lower-ceremony option that survives Lambda cold starts (a DynamoDB table would
# be more ceremony for a single scalar per offender/day).
#
# data.aws_caller_identity.current / data.aws_region.current are declared in
# athena.tf (module-global) — reused here, not redeclared.
# =============================================================================

locals {
  function_name = "abuse-detector-${var.region.label}"

  # Reused Phase 40 SNS topic ARN, composed from account + region + the fixed
  # name — the module MUST NOT create a second topic (see admin-reports alarms.tf).
  sns_topic_arn = "arn:aws:sns:${data.aws_region.current.id}:${data.aws_caller_identity.current.account_id}:${var.sns_topic_name}"
}

# Package the handler directory (Plan 04 code + Plan 02 queries/) into a zip.
data "archive_file" "detector" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/.lambda-zips/${local.function_name}.zip"
}

resource "aws_cloudwatch_log_group" "detector" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days

  tags = merge(var.tags, {
    Name      = "/aws/lambda/${local.function_name}"
    Site      = var.site.label
    Purpose   = "abuse-detection"
    ManagedBy = "Terragrunt"
  })
}

resource "aws_lambda_function" "detector" {
  function_name = local.function_name
  role          = aws_iam_role.detector.arn
  handler       = "index.handler"
  runtime       = var.lambda_runtime

  filename         = data.archive_file.detector.output_path
  source_code_hash = data.archive_file.detector.output_base64sha256

  timeout     = var.lambda_timeout
  memory_size = var.lambda_memory_size

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      # --- Athena / Glue substrate (Plan 01) ---
      ATHENA_WORKGROUP = aws_athena_workgroup.abuse.name
      GLUE_DATABASE    = aws_glue_catalog_database.abuse.name
      GLUE_TABLE       = aws_glue_catalog_table.alb_access_logs.name

      # --- Dual-role results bucket + prefixes (Plan 01; no new bucket) ---
      RESULTS_BUCKET = aws_s3_bucket.results.bucket
      RESULTS_PREFIX = "query-results/"
      REPORT_PREFIX  = "abuse/"
      STATE_PREFIX   = "abuse/state/"

      # --- Reused Phase 40 alert topic (composed, not recreated) ---
      SNS_TOPIC_ARN = local.sns_topic_arn

      # --- Query templates shipped alongside the handler (Plan 02) ---
      QUERY_DIR = "queries"

      # --- Detection thresholds (surfaced from site.hcl in Plan 05) ---
      LOOKBACK_HOURS        = tostring(var.lookback_hours)
      SESSION_HOURS         = tostring(var.session_hours)
      SESSION_GAP_MIN       = tostring(var.session_gap_min)
      POSTS_PER_5MIN        = tostring(var.posts_per_5min)
      REQUESTS_PER_5MIN     = tostring(var.requests_per_5min)
      ESCALATION_MULTIPLIER = tostring(var.escalation_multiplier)
      DIGEST_HOUR_UTC       = tostring(var.digest_hour_utc)
    }
  }

  tags = merge(var.tags, {
    Name      = local.function_name
    Site      = var.site.label
    Region    = var.region.label
    Purpose   = "abuse-detection"
    ManagedBy = "Terragrunt"
  })

  depends_on = [
    aws_iam_role_policy.detector,
    aws_cloudwatch_log_group.detector,
  ]
}

# -----------------------------------------------------------------------------
# EventBridge cron → invoke the detector. state gated by var.schedule_enabled so
# the schedule ships DISABLED (AD-08). Only this rule may invoke the function.
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "detector" {
  name                = local.function_name
  description         = "Cron trigger for the abuse-detector Lambda (dark until schedule_enabled=true)."
  schedule_expression = "rate(${var.cron_minutes} minutes)"
  state               = var.schedule_enabled ? "ENABLED" : "DISABLED"

  tags = merge(var.tags, {
    Name      = local.function_name
    Site      = var.site.label
    Purpose   = "abuse-detection"
    ManagedBy = "Terragrunt"
  })
}

resource "aws_cloudwatch_event_target" "detector" {
  rule      = aws_cloudwatch_event_rule.detector.name
  target_id = "detector"
  arn       = aws_lambda_function.detector.arn
}

resource "aws_lambda_permission" "events" {
  statement_id  = "AllowInvokeFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.detector.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.detector.arn
}
