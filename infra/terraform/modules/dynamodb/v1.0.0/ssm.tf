# SSM Parameters for DynamoDB configuration
# Parameters are stored in a hierarchical structure for easy lookup
# String parameters store non-sensitive metadata (table names, ARNs, regions)
# SecureString parameters (secret keys) use KMS encryption via kms.tf

locals {
  ssm_prefixes = {
    for name, config in local.table_configs :
    name => "/${var.site.label}/dynamodb/${var.region.label}/${config.table_name}"
  }
}

# Table name for each table
#checkov:skip=CKV2_AWS_34:Table names are non-sensitive infrastructure metadata
resource "aws_ssm_parameter" "table_name" {
  for_each = local.table_configs

  name        = "${local.ssm_prefixes[each.key]}/table_name"
  description = "DynamoDB table name for ${each.key} in ${var.region.label}"
  type        = "String"
  value       = each.value.table_name

  tags = {
    Site      = var.site.label
    Region    = var.region.label
    TableName = each.key
  }
}

# Table ARN for each table
#checkov:skip=CKV2_AWS_34:Table ARNs are non-sensitive infrastructure metadata
resource "aws_ssm_parameter" "table_arn" {
  for_each = local.table_configs

  name        = "${local.ssm_prefixes[each.key]}/table_arn"
  description = "DynamoDB table ARN for ${each.key} in ${var.region.label}"
  type        = "String"
  value       = local.tables_output[each.key].table_arn

  tags = {
    Site      = var.site.label
    Region    = var.region.label
    TableName = each.key
  }
}

# Stream ARN (if streams are enabled)
#checkov:skip=CKV2_AWS_34:Stream ARNs are non-sensitive infrastructure metadata
resource "aws_ssm_parameter" "stream_arn" {
  for_each = {
    for name, config in local.table_configs :
    name => config if config.config.stream_enabled
  }

  name        = "${local.ssm_prefixes[each.key]}/stream_arn"
  description = "DynamoDB stream ARN for ${each.key} in ${var.region.label}"
  type        = "String"
  value       = local.tables_output[each.key].stream_arn

  tags = {
    Site      = var.site.label
    Region    = var.region.label
    TableName = each.key
  }
}

# IAM user access key ID for each table
#checkov:skip=CKV2_AWS_34:Access key IDs are non-sensitive identifiers (not the secret)
resource "aws_ssm_parameter" "access_key_id" {
  for_each = aws_iam_access_key.dynamodb_user

  name        = "${local.ssm_prefixes[each.key]}/access_key_id"
  description = "IAM access key ID for DynamoDB user for ${each.key} in ${var.region.label}"
  type        = "String"
  value       = each.value.id

  tags = {
    Site      = var.site.label
    Region    = var.region.label
    TableName = each.key
  }
}

# IAM user secret access key (stored securely) for each table
resource "aws_ssm_parameter" "secret_access_key" {
  for_each = aws_iam_access_key.dynamodb_user

  name        = "${local.ssm_prefixes[each.key]}/secret_access_key"
  description = "IAM secret access key for DynamoDB user for ${each.key} in ${var.region.label}"
  type        = "SecureString"
  value       = each.value.secret
  key_id      = aws_kms_key.ssm.arn

  tags = {
    Site      = var.site.label
    Region    = var.region.label
    TableName = each.key
  }
}

# Region information for each table
#checkov:skip=CKV2_AWS_34:Region names are non-sensitive infrastructure metadata
resource "aws_ssm_parameter" "region" {
  for_each = local.table_configs

  name        = "${local.ssm_prefixes[each.key]}/region"
  description = "AWS region for DynamoDB table ${each.key}"
  type        = "String"
  value       = var.region.full

  tags = {
    Site      = var.site.label
    Region    = var.region.label
    TableName = each.key
  }
}
