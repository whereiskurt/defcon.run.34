# SSM Parameters for DynamoDB configuration
# Parameters are stored in a hierarchical structure for easy lookup

locals {
  ssm_prefix = "/${var.site.label}/dynamodb/${var.region.label}/${local.table_name}"
}

# Table name
resource "aws_ssm_parameter" "table_name" {
  name        = "${local.ssm_prefix}/table_name"
  description = "DynamoDB table name for ${var.site.label} in ${var.region.label}"
  type        = "String"
  value       = local.table_name

  tags = {
    Site   = var.site.label
    Region = var.region.label
  }
}

# Table ARN
resource "aws_ssm_parameter" "table_arn" {
  name        = "${local.ssm_prefix}/table_arn"
  description = "DynamoDB table ARN for ${var.site.label} in ${var.region.label}"
  type        = "String"
  value       = local.table_arn

  tags = {
    Site   = var.site.label
    Region = var.region.label
  }
}

# Stream ARN (if streams are enabled)
resource "aws_ssm_parameter" "stream_arn" {
  count = var.dynamodb.stream_enabled ? 1 : 0

  name        = "${local.ssm_prefix}/stream_arn"
  description = "DynamoDB stream ARN for ${var.site.label} in ${var.region.label}"
  type        = "String"
  value       = local.stream_arn

  tags = {
    Site   = var.site.label
    Region = var.region.label
  }
}

# IAM user access key ID
resource "aws_ssm_parameter" "access_key_id" {
  name        = "${local.ssm_prefix}/access_key_id"
  description = "IAM access key ID for DynamoDB user in ${var.region.label}"
  type        = "String"
  value       = aws_iam_access_key.dynamodb_user.id

  tags = {
    Site   = var.site.label
    Region = var.region.label
  }
}

# IAM user secret access key (stored securely)
resource "aws_ssm_parameter" "secret_access_key" {
  name        = "${local.ssm_prefix}/secret_access_key"
  description = "IAM secret access key for DynamoDB user in ${var.region.label}"
  type        = "SecureString"
  value       = aws_iam_access_key.dynamodb_user.secret

  tags = {
    Site   = var.site.label
    Region = var.region.label
  }
}

# Region information
resource "aws_ssm_parameter" "region" {
  name        = "${local.ssm_prefix}/region"
  description = "AWS region for DynamoDB table"
  type        = "String"
  value       = var.region.full

  tags = {
    Site   = var.site.label
    Region = var.region.label
  }
}
