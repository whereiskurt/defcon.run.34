# =============================================================================
# KMS Key for CloudTrail Encryption
# =============================================================================

resource "aws_kms_key" "cloudtrail" {
  count = var.cloudtrail.enable_kms_encryption ? 1 : 0

  description              = "${var.site.label} CloudTrail encryption key"
  deletion_window_in_days  = 30
  enable_key_rotation      = true
  policy                   = data.aws_iam_policy_document.kms_policy[0].json

  tags = {
    Name      = "${var.site.label}-cloudtrail-key"
    Site      = var.site.label
    Purpose   = "cloudtrail-encryption"
    ManagedBy = "Terragrunt"
  }
}

resource "aws_kms_alias" "cloudtrail" {
  count = var.cloudtrail.enable_kms_encryption ? 1 : 0

  name          = "alias/${var.site.label}-cloudtrail"
  target_key_id = aws_kms_key.cloudtrail[0].key_id
}

data "aws_iam_policy_document" "kms_policy" {
  count = var.cloudtrail.enable_kms_encryption ? 1 : 0

  # Allow account root full access (required for key administration)
  statement {
    sid    = "EnableAccountAdmin"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${local.account_id}:root"]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  # Allow CloudTrail to encrypt logs
  statement {
    sid    = "AllowCloudTrailEncrypt"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    actions = [
      "kms:GenerateDataKey*",
      "kms:DescribeKey"
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
    condition {
      test     = "StringLike"
      variable = "kms:EncryptionContext:aws:cloudtrail:arn"
      values   = ["arn:aws:cloudtrail:*:${local.account_id}:trail/*"]
    }
  }

  # Allow CloudTrail to describe key for log file validation
  statement {
    sid    = "AllowCloudTrailDescribe"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    actions = [
      "kms:DescribeKey"
    ]
    resources = ["*"]
  }

  # Allow SNS to use the key for encrypting alert messages
  statement {
    sid    = "AllowSNSEncrypt"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }
    actions = [
      "kms:GenerateDataKey*",
      "kms:Decrypt"
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }

  # Allow EventBridge to use the key for publishing to encrypted SNS
  statement {
    sid    = "AllowEventBridgeEncrypt"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
    actions = [
      "kms:GenerateDataKey*",
      "kms:Decrypt"
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}
