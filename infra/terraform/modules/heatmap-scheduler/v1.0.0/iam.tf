# IAM for the heatmap-scheduler v1.0.0.
#
# This Lambda is a THIN INVOKER: it reads one SSM SecureString and makes one
# HTTP call. All DynamoDB and object-storage work happens on the run.gpx ECS
# task role, which already holds those grants. Do NOT add data-plane
# permissions here.

# Resolve the SSM SecureString KMS alias to its target key ARN. kms:Decrypt
# identity-based policies match on the KEY arn, NOT the alias arn — scoping to
# the alias silently denies at runtime (AccessDeniedException on key/<uuid>).
data "aws_kms_alias" "ssm" {
  name = local.ssm_kms_key_alias
}

# --- Lambda execution role ---
# CONFUSED DEPUTY: the source-account condition below pins the trust to THIS
# account, so an AWS service principal acting on behalf of some other account
# cannot be talked into assuming this role. Applied here for symmetry with the
# scheduler trust below (which AWS explicitly documents as needing it). The
# blast radius of a successful confusion is small — this module is a thin
# invoker whose only power is invoking one function and reading one parameter —
# but the mitigation is free. data.aws_caller_identity.current is declared in
# main.tf; do NOT add a second declaration here (duplicate = plan error).
data "aws_iam_policy_document" "sync_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
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
  # KMS decrypt for the SSM SecureString above. Scoped to the alias's target
  # KEY arn (not the alias arn — the alias arn does not satisfy a
  # kms:Decrypt resource match), further constrained to this parameter's
  # encryption context.
  statement {
    actions   = ["kms:Decrypt"]
    resources = [data.aws_kms_alias.ssm.target_key_arn]
    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:PARAMETER_ARN"
      values   = [var.internal_sync_secret_ssm_arn]
    }
  }
}

resource "aws_iam_role_policy" "sync" {
  name   = "${local.function_name}-policy"
  role   = aws_iam_role.sync.id
  policy = data.aws_iam_policy_document.sync.json
}

# ENI create/describe/delete + basic Lambda logging permissions needed
# whenever the Lambda attaches to a VPC (var.vpc_subnet_ids non-empty).
#
# NOT harmless — this is the WIDEST grant in the module. The AWS-managed policy
# grants ec2:CreateNetworkInterface / DeleteNetworkInterface /
# DescribeNetworkInterfaces AND logs:CreateLogGroup / logs:PutLogEvents on
# Resource: "*" — i.e. logs actions on every log group in the account, strictly
# broader than the hand-written, log-group-scoped statement above. It is
# accepted only because the Lambda genuinely needs the ENI permissions to reach
# run-gpx over the VPC-private Cloud Map name.
#
# DEFERRED, deliberately: gating this behind
# `count = length(var.vpc_subnet_ids) > 0 ? 1 : 0` is the right long-term fix,
# but adding a count meta-argument changes the resource ADDRESS from unindexed
# to indexed, which Terraform executes as destroy-then-create — a momentary IAM
# policy detach on a live Lambda during con week, for zero behavioural change
# (this deployment always supplies subnets, so the count evaluates to 1
# regardless). Filed for post-con.
resource "aws_iam_role_policy_attachment" "sync_vpc" {
  role       = aws_iam_role.sync.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# --- EventBridge Scheduler role (assumed by the scheduler to invoke the Lambda) ---
# CONFUSED DEPUTY: this is the trust AWS explicitly documents as needing the
# source-account condition below. WITHOUT it, an EventBridge Scheduler in ANY AWS
# account that learns this role ARN can attempt to assume it. The blast radius
# is small — the role's only grant is lambda:InvokeFunction on this one thin
# invoker, so the worst outcome is an unscheduled heat-map rebuild — but the
# mitigation costs nothing. Account id comes from the caller-identity data
# source declared in main.tf; do NOT redeclare it here.
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
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
