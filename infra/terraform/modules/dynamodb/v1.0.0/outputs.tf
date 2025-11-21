output "table_name" {
  description = "The name of the DynamoDB table"
  value       = local.table_name
}

output "table_arn" {
  description = "The ARN of the DynamoDB table"
  value       = local.table_arn
}

output "table_id" {
  description = "The ID of the DynamoDB table"
  value       = local.table_id
}

output "stream_arn" {
  description = "The ARN of the DynamoDB stream (if enabled)"
  value       = var.dynamodb.stream_enabled ? local.stream_arn : null
}

output "iam_user_name" {
  description = "The name of the IAM user for DynamoDB access"
  value       = aws_iam_user.dynamodb_user.name
}

output "iam_user_arn" {
  description = "The ARN of the IAM user for DynamoDB access"
  value       = aws_iam_user.dynamodb_user.arn
}

output "access_key_id" {
  description = "The access key ID for the IAM user"
  value       = aws_iam_access_key.dynamodb_user.id
  sensitive   = true
}

output "secret_access_key" {
  description = "The secret access key for the IAM user"
  value       = aws_iam_access_key.dynamodb_user.secret
  sensitive   = true
}

output "ssm_prefix" {
  description = "The SSM parameter store prefix for DynamoDB configuration"
  value       = local.ssm_prefix
}

output "region" {
  description = "The AWS region where the table is deployed"
  value       = var.region.full
}

output "is_primary_region" {
  description = "Whether this is the primary region for the global table"
  value       = local.is_primary_region
}
