locals {
  electro_index_arn = "${var.electro_table_arn}/index/*"
  ssm_kms_alias_arn = "arn:aws:kms:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:${local.ssm_kms_key_alias}"

  # Grant the flush-token read only when a token ARN is supplied.
  flush_ssm_statements = var.flush_token_ssm_arn != "" ? [
    {
      Sid      = "SSMFlushTokenRead"
      Effect   = "Allow"
      Action   = ["ssm:GetParameter", "ssm:GetParameters"]
      Resource = var.flush_token_ssm_arn
    },
    {
      Sid      = "KMSDecryptForFlushToken"
      Effect   = "Allow"
      Action   = ["kms:Decrypt"]
      Resource = local.ssm_kms_alias_arn
    },
  ] : []
}

# ===========================================================================
# Resolver role — read qr codes, write its own logs. NEVER reads ctf answers,
# NEVER writes user data. Least privilege by design (spec §3, §8).
# ===========================================================================
resource "aws_iam_role" "resolver" {
  name = substr("lambda-${local.resolver_function_name}", 0, 64)

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = merge(local.common_tags, { Name = "lambda-${local.resolver_function_name}" })
}

resource "aws_iam_role_policy" "resolver" {
  name = "qr-resolver-lambda-policy"
  role = aws_iam_role.resolver.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "CloudWatchLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:${local.resolver_log_group}:*"
      },
      {
        Sid      = "XRayTracing"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      # Read-only on the shared table. GetItem for qr code lookups; Query on
      # the byOwner GSI is admin-side (run.human), not the resolver — but the
      # resolver only needs GetItem. Scope stays read-only, no write actions.
      {
        Sid    = "ElectroReadQrCodes"
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:BatchGetItem"]
        Resource = [
          var.electro_table_arn,
          local.electro_index_arn,
        ]
      },
    ]
  })
}

# ===========================================================================
# Rollup role — Logs Insights over the resolver log group, write qrstat only.
# ===========================================================================
resource "aws_iam_role" "rollup" {
  name = substr("lambda-${local.rollup_function_name}", 0, 64)

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = merge(local.common_tags, { Name = "lambda-${local.rollup_function_name}" })
}

resource "aws_iam_role_policy" "rollup" {
  name = "qr-rollup-lambda-policy"
  role = aws_iam_role.rollup.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Sid      = "CloudWatchLogsOwn"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:log-group:${local.rollup_log_group}:*"
      },
      {
        Sid      = "XRayTracing"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      # Logs Insights is an account/region-scoped API: StartQuery/GetQueryResults
      # do not take a resource ARN, so these are "*" but constrained to the
      # Insights actions. The query itself targets only the resolver log group.
      {
        Sid    = "LogsInsightsQuery"
        Effect = "Allow"
        Action = [
          "logs:StartQuery",
          "logs:StopQuery",
          "logs:GetQueryResults",
          "logs:GetLogGroupFields",
        ]
        Resource = "*"
      },
      # Write aggregates + read/advance the watermark row. Qrstat only — the
      # rollup never touches qr/ctf or user records. ElectroDB shares one
      # table, so we scope by table ARN (item-level scoping is not available
      # for a single-table design without leading-key conditions).
      {
        Sid    = "ElectroWriteQrstat"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
        ]
        Resource = var.electro_table_arn
      },
    ], local.flush_ssm_statements)
  })
}
