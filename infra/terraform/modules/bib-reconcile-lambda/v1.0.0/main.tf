data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  function_name = substr(
    "bib-reconcile-${var.site.label}-${var.region.label}",
    0,
    64,
  )

  # Substitute {region_label} placeholder in SSM path prefixes so callers
  # can share a single shape across regions without a per-region unit.
  ssm_bib_prefix = replace(
    var.ssm_bib_prefix,
    "{region_label}",
    var.region.label,
  )
  ssm_kms_key_alias = replace(
    var.ssm_kms_key_alias,
    "{region_label}",
    var.region.label,
  )
}

# Zip the Lambda source. The consuming Terragrunt unit is expected to have
# run `npm ci --omit=dev` inside var.source_path so the archive includes
# node_modules/ — Terraform does not npm-install for us.
data "archive_file" "reconcile" {
  type        = "zip"
  source_dir  = var.source_path
  output_path = "${path.module}/.lambda-zips/${local.function_name}.zip"

  excludes = [
    ".gitignore",
    "vitest.config.ts",
    # tests/ carries fixtures/synthetic emails — no reason to ship them
    # to production, and Anthropic docs discourage bundling test emails
    # with production runtime code.
    "tests",
  ]
}

# Reconciliation Lambda function.
#
# The handler contract is `handler` exported from `index.mjs` (ES module).
# The Lambda runtime (Node.js 20.x+) natively supports `.mjs` and
# top-level `import` — no bundler required.
resource "aws_lambda_function" "reconcile" {
  function_name = local.function_name
  role          = aws_iam_role.reconcile.arn
  handler       = "index.handler"
  runtime       = var.lambda_runtime

  filename         = data.archive_file.reconcile.output_path
  source_code_hash = data.archive_file.reconcile.output_base64sha256

  timeout                        = var.lambda_timeout
  memory_size                    = var.lambda_memory_size
  reserved_concurrent_executions = var.reserved_concurrent_executions

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = merge(
      {
        # Table + bucket wiring — read at Lambda cold start.
        RUN_ELECTRO_DBNAME = var.electro_table_name
        SES_INBOX_BUCKET   = var.ses_inbox_bucket_name
        SES_OBJECT_PREFIX  = var.object_key_prefix

        # SSM path so the handler doesn't hardcode the parameter name.
        ANTHROPIC_API_KEY_SSM_PATH = "${local.ssm_bib_prefix}/anthropic/api_key"

        # Notification-mail wiring (Plan 22-04-03).
        SES_FROM_ADDRESS    = var.ses_from_address
        SES_ADMIN_RECIPIENT = var.ses_admin_recipient

        # Region label for structured logs / entity partitioning.
        REGION_LABEL = var.region.label
      },
      var.extra_environment,
    )
  }

  tags = {
    Name    = local.function_name
    Service = "run-bib"
    Region  = var.region.label
    Site    = var.site.label
    Phase   = "22"
  }

  depends_on = [
    aws_iam_role_policy.reconcile,
    aws_cloudwatch_log_group.reconcile,
  ]
}

# Dedicated log group — retained per var.log_retention_days.
resource "aws_cloudwatch_log_group" "reconcile" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days

  tags = {
    Name    = "${local.function_name}-logs"
    Service = "run-bib"
    Region  = var.region.label
    Site    = var.site.label
  }
}

# Allow S3 to invoke the Lambda. Scoped to the SES inbox bucket ARN so a
# stray bucket policy cannot cause unrelated buckets to fire this Lambda.
resource "aws_lambda_permission" "allow_s3" {
  statement_id  = "AllowExecutionFromSESInboxS3"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.reconcile.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = var.ses_inbox_bucket_arn
  source_account = data.aws_caller_identity.current.account_id
}

# S3 → Lambda notification on Object Create, filtered to bib-payments/
# prefix so replies to other SES receive rules on the same bucket do NOT
# trigger this handler.
resource "aws_s3_bucket_notification" "ses_inbox" {
  bucket = var.ses_inbox_bucket_name

  lambda_function {
    lambda_function_arn = aws_lambda_function.reconcile.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = var.object_key_prefix
  }

  depends_on = [aws_lambda_permission.allow_s3]
}
