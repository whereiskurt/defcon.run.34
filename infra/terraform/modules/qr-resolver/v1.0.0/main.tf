data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  resolver_function_name = substr("qr-resolver-${var.site.label}-${var.region.label}", 0, 64)
  rollup_function_name   = substr("qr-rollup-${var.site.label}-${var.region.label}", 0, 64)

  resolver_log_group = "/aws/lambda/${local.resolver_function_name}"
  rollup_log_group   = "/aws/lambda/${local.rollup_function_name}"

  ssm_kms_key_alias = replace(var.ssm_kms_key_alias, "{region_label}", var.region.label)

  common_tags = {
    Service = "run-qr"
    Region  = var.region.label
    Site    = var.site.label
  }
}

# ---------------------------------------------------------------------------
# Resolver Lambda — parse path, GetItem qr, apply rules, 302, emit 1 log line.
# Handler `handler` exported from index.mjs (ES module). Node 22.x runs .mjs
# natively; no bundler. Source dir must already contain node_modules/ (the
# consuming unit runs `npm ci --omit=dev`).
# ---------------------------------------------------------------------------
data "archive_file" "resolver" {
  type        = "zip"
  source_dir  = var.resolver_source_path
  output_path = "${path.module}/.lambda-zips/${local.resolver_function_name}.zip"
  excludes    = [".gitignore", "vitest.config.ts", "tests"]
}

resource "aws_lambda_function" "resolver" {
  function_name = local.resolver_function_name
  role          = aws_iam_role.resolver.arn
  handler       = "index.handler"
  runtime       = var.lambda_runtime

  filename         = data.archive_file.resolver.output_path
  source_code_hash = data.archive_file.resolver.output_base64sha256

  timeout     = var.resolver_timeout
  memory_size = var.resolver_memory_size

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = merge(
      {
        RUN_ELECTRO_DBNAME = var.electro_table_name
        REGION_LABEL       = var.region.label
      },
      var.extra_environment,
    )
  }

  tags = merge(local.common_tags, { Name = local.resolver_function_name })

  depends_on = [
    aws_iam_role_policy.resolver,
    aws_cloudwatch_log_group.resolver,
  ]
}

resource "aws_cloudwatch_log_group" "resolver" {
  name              = local.resolver_log_group
  retention_in_days = var.log_retention_days
  tags              = merge(local.common_tags, { Name = "${local.resolver_function_name}-logs" })
}

# ---------------------------------------------------------------------------
# Rollup Lambda — cron/flush → Logs Insights over resolver log group → qrstat.
# ---------------------------------------------------------------------------
data "archive_file" "rollup" {
  type        = "zip"
  source_dir  = var.rollup_source_path
  output_path = "${path.module}/.lambda-zips/${local.rollup_function_name}.zip"
  excludes    = [".gitignore", "vitest.config.ts", "tests"]
}

resource "aws_lambda_function" "rollup" {
  function_name = local.rollup_function_name
  role          = aws_iam_role.rollup.arn
  handler       = "index.handler"
  runtime       = var.lambda_runtime

  filename         = data.archive_file.rollup.output_path
  source_code_hash = data.archive_file.rollup.output_base64sha256

  timeout     = var.rollup_timeout
  memory_size = var.rollup_memory_size

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      RUN_ELECTRO_DBNAME = var.electro_table_name
      QR_LOG_GROUP       = local.resolver_log_group
      REGION_LABEL       = var.region.label
      # Flush token is read from SSM at cold start when flush_token_ssm_arn
      # is set; the ARN is passed so the handler need not hardcode the path.
      QR_FLUSH_TOKEN_SSM_ARN = var.flush_token_ssm_arn
    }
  }

  tags = merge(local.common_tags, { Name = local.rollup_function_name })

  depends_on = [
    aws_iam_role_policy.rollup,
    aws_cloudwatch_log_group.rollup,
  ]
}

resource "aws_cloudwatch_log_group" "rollup" {
  name              = local.rollup_log_group
  retention_in_days = var.log_retention_days
  tags              = merge(local.common_tags, { Name = "${local.rollup_function_name}-logs" })
}

# ---------------------------------------------------------------------------
# EventBridge cron → rollup Lambda (default rate(30 minutes)).
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_event_rule" "rollup_cron" {
  name                = substr("qr-rollup-cron-${var.site.label}-${var.region.label}", 0, 64)
  description         = "Periodic q.defcon.run analytics rollup (Logs Insights -> qrstat)."
  schedule_expression = var.rollup_schedule_expression
  tags                = merge(local.common_tags, { Name = "qr-rollup-cron" })
}

resource "aws_cloudwatch_event_target" "rollup_cron" {
  rule      = aws_cloudwatch_event_rule.rollup_cron.name
  target_id = "qr-rollup"
  arn       = aws_lambda_function.rollup.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowExecutionFromEventBridgeCron"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rollup.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.rollup_cron.arn
}
