# =============================================================================
# KMS Key for SSM Parameter Encryption
# Creates a regional key for encrypting SSM SecureString parameters
# Uses data.aws_caller_identity.current from s3.tf
# =============================================================================

resource "aws_kms_key" "ssm" {
  description              = "${var.site.label} Email SSM parameter encryption key - ${var.region.label}"
  deletion_window_in_days  = 30
  enable_key_rotation      = true
  policy                   = data.aws_iam_policy_document.ssm_key_policy.json

  tags = {
    Name      = "${var.site.label}-email-ssm-key-${var.region.label}"
    Site      = var.site.label
    Region    = var.region.label
    Purpose   = "ssm-parameter-encryption"
    ManagedBy = "Terragrunt"
  }
}

resource "aws_kms_alias" "ssm" {
  name          = "alias/${var.site.label}-email-ssm-${var.region.label}"
  target_key_id = aws_kms_key.ssm.key_id
}

data "aws_iam_policy_document" "ssm_key_policy" {
  # Allow account root full access (required for key administration)
  statement {
    sid    = "EnableAccountAdmin"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  # Allow SSM to use the key
  statement {
    sid    = "AllowSSMAccess"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["ssm.amazonaws.com"]
    }
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:GenerateDataKey*",
      "kms:DescribeKey"
    ]
    resources = ["*"]
  }

  # Allow ECS tasks to decrypt parameters (for container secrets)
  statement {
    sid    = "AllowECSTaskDecrypt"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey"
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  # Allow Lambda to decrypt parameters (for email forwarding)
  statement {
    sid    = "AllowLambdaDecrypt"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey"
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}
