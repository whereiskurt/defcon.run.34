# Lambda function for email forwarding
# Source code is provided by the region's email.hcl configuration
data "archive_file" "email_forwarder" {
  count       = length(var.fwd_rules) > 0 ? 1 : 0
  type        = "zip"
  source_dir  = var.forwarder_lambda_source_path
  output_path = "${path.module}/.lambda-zips/email-forwarder.zip"
}

resource "aws_lambda_function" "email_forwarder" {
  count                          = length(var.fwd_rules) > 0 ? 1 : 0
  filename                       = data.archive_file.email_forwarder[0].output_path
  function_name                  = "${var.site.label}-email-forwarder"
  role                           = aws_iam_role.email_forwarder[0].arn
  handler                        = "index.lambda_handler"
  source_code_hash               = data.archive_file.email_forwarder[0].output_base64sha256
  runtime                        = "python3.12"
  timeout                        = 60
  reserved_concurrent_executions = 10

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      FORWARDING_RULES = jsonencode({
        for rule in var.fwd_rules :
        rule.match => rule.send_to
      })
      FROM_DOMAIN   = var.email.zonenames[0]
      S3_BUCKET     = aws_s3_bucket.received_emails.id
      S3_KEY_PREFIX = "forwarding/"
    }
  }
}

# Lambda permission for SES to invoke the function
resource "aws_lambda_permission" "allow_ses" {
  count          = length(var.fwd_rules) > 0 ? 1 : 0
  statement_id   = "AllowExecutionFromSES"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.email_forwarder[0].function_name
  principal      = "ses.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
}

# IAM role for Lambda function
resource "aws_iam_role" "email_forwarder" {
  count = length(var.fwd_rules) > 0 ? 1 : 0
  name  = "${var.site.label}-${var.region.label}-email-fwd-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
          ArnLike = {
            "aws:SourceArn" = "arn:aws:lambda:${var.region.full}:${data.aws_caller_identity.current.account_id}:function:${var.site.label}-email-forwarder"
          }
        }
      }
    ]
  })
}

# IAM policy for Lambda to send emails via SES and read from S3
resource "aws_iam_role_policy" "email_forwarder" {
  count = length(var.fwd_rules) > 0 ? 1 : 0
  name  = "email-forwarder-policy"
  role  = aws_iam_role.email_forwarder[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${var.region.full}:${data.aws_caller_identity.current.account_id}:*"
      },
      {
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.received_emails.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = aws_s3_bucket.received_emails.arn
      }
    ]
  })
}

# SES receipt rules for email forwarding
# Simplified to avoid chaining issues with for_each
locals {
  fwd_rules_map = {
    for rule in var.fwd_rules :
    rule.match => {
      match   = rule.match
      send_to = rule.send_to
    }
  }
}

resource "aws_ses_receipt_rule" "forwarding" {
  for_each      = local.fwd_rules_map
  name          = "forward-${replace(each.value.match, "@", "-at-")}"
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
  recipients    = [each.value.match]
  enabled       = true
  scan_enabled  = true

  # Note: 'after' parameter not used - SES applies rules based on recipient matching
  # Order doesn't matter for these specific recipient-based forwarding rules

  # Store in S3 first
  s3_action {
    bucket_name       = aws_s3_bucket.received_emails.id
    object_key_prefix = "forwarding/${each.value.match}/"
    position          = 1
  }

  # Then invoke Lambda to forward
  lambda_action {
    function_arn    = aws_lambda_function.email_forwarder[0].arn
    invocation_type = "Event"
    position        = 2
  }

  depends_on = [
    aws_lambda_permission.allow_ses,
    aws_s3_bucket_policy.received_emails
  ]

  lifecycle {
    # Create new rule before destroying old one to maintain rule chain
    create_before_destroy = true
  }
}
