locals {
  # If caller provides an explicit SSM parameter ARN, IAM scopes to exactly
  # that resource. Otherwise fall back to a wildcard under the bib prefix
  # (still region-scoped via var.region.label substitution above).
  anthropic_ssm_arn = var.anthropic_api_key_ssm_arn != "" ? var.anthropic_api_key_ssm_arn : "arn:aws:ssm:${data.aws_region.current.id}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_bib_prefix}/anthropic/*"

  # Table + index-GSI ARN (runnerCode-index is defined at the shared
  # electro table in run.human/service.hcl). Query IAM must include the
  # index-scoped ARN, not just the table ARN.
  electro_index_arn = "${var.electro_table_arn}/index/*"
}

# Resolve the SSM SecureString KMS alias to its target key ARN. kms:Decrypt
# identity-based policies match on the KEY arn, NOT the alias arn — scoping to
# the alias silently denies at runtime (AccessDeniedException on key/<uuid>).
data "aws_kms_alias" "ssm" {
  name = local.ssm_kms_key_alias
}

resource "aws_iam_role" "reconcile" {
  name = substr("lambda-${local.function_name}", 0, 64)

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      },
    ]
  })

  tags = {
    Name    = "lambda-${local.function_name}"
    Service = "run-bib"
    Region  = var.region.label
    Site    = var.site.label
  }
}

resource "aws_iam_role_policy" "reconcile" {
  name = "bib-reconcile-lambda-policy"
  role = aws_iam_role.reconcile.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # CloudWatch Logs — dedicated log group provisioned in main.tf.
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.id}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.function_name}:*"
      },

      # X-Ray tracing (tracing_config { mode = "Active" }).
      {
        Sid    = "XRayTracing"
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
        ]
        Resource = "*"
      },

      # S3 — read raw MIME messages that SES writes at bib-payments/.
      # Scoped to the exact bucket + prefix; not the whole account.
      {
        Sid    = "SESInboxRead"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:HeadObject",
          "s3:GetObjectTagging",
        ]
        Resource = "${var.ses_inbox_bucket_arn}/${var.object_key_prefix}*"
      },

      # DynamoDB — read Bib by runnerCode (GSI query), read/write
      # BibReconcile ledger + BudgetCounter increment, and idempotent Bib
      # payment updates. Scope: shared electro table + its GSIs.
      {
        Sid    = "ElectroTableAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:BatchGetItem",
          "dynamodb:ConditionCheckItem",
        ]
        Resource = [
          var.electro_table_arn,
          local.electro_index_arn,
        ]
      },

      # SSM — read the Anthropic API key at cold start (5-min in-memory
      # cache in handler code). Kept as narrow as caller provides.
      {
        Sid    = "SSMAnthropicKeyRead"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
        ]
        Resource = local.anthropic_ssm_arn
      },

      # KMS decrypt for the SSM SecureString above. Scoped to the alias's
      # target KEY arn (not the alias arn — the alias arn does not satisfy a
      # kms:Decrypt resource match), further constrained to this parameter's
      # encryption context.
      {
        Sid    = "KMSDecryptForSSM"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
        ]
        Resource = data.aws_kms_alias.ssm.target_key_arn
        Condition = {
          StringEquals = {
            "kms:EncryptionContext:PARAMETER_ARN" = local.anthropic_ssm_arn
          }
        }
      },

      # SES — send admin notification emails from the verified sender
      # identity on unmatched/ambiguous receipts (Plan 22-04-03).
      {
        Sid    = "SESSendAdminEmail"
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail",
        ]
        Resource = "arn:aws:ses:${data.aws_region.current.id}:${data.aws_caller_identity.current.account_id}:identity/*"
        Condition = {
          StringEquals = {
            "ses:FromAddress" = var.ses_from_address
          }
          "ForAllValues:StringEquals" = {
            "ses:Recipients" = [var.ses_admin_recipient]
          }
        }
      },
    ]
  })
}
