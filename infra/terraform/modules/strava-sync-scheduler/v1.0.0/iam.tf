# IAM for the strava-sync-scheduler (v1.7 Phase 33). DRAFT — validate before apply.

# --- Lambda execution role ---
data "aws_iam_policy_document" "sync_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "sync" {
  name               = "${local.function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.sync_assume.json
}

data "aws_iam_policy_document" "sync" {
  # CloudWatch Logs.
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.sync.arn}:*"]
  }
  # X-Ray tracing.
  statement {
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }
  # Read the shared internal secret only.
  statement {
    actions   = ["ssm:GetParameter"]
    resources = [var.internal_sync_secret_ssm_arn]
  }
}

resource "aws_iam_role_policy" "sync" {
  name   = "${local.function_name}-policy"
  role   = aws_iam_role.sync.id
  policy = data.aws_iam_policy_document.sync.json
}

# --- EventBridge Scheduler role (assumed by the scheduler to invoke the Lambda) ---
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${local.function_name}-scheduler-role"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.sync.arn]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "${local.function_name}-scheduler-policy"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}
