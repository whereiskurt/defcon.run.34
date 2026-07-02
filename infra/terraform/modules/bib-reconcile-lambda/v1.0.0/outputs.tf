output "function_name" {
  description = "Name of the reconcile Lambda function."
  value       = aws_lambda_function.reconcile.function_name
}

output "function_arn" {
  description = "ARN of the reconcile Lambda function."
  value       = aws_lambda_function.reconcile.arn
}

output "role_arn" {
  description = "IAM role ARN assumed by the reconcile Lambda."
  value       = aws_iam_role.reconcile.arn
}

output "log_group_name" {
  description = "CloudWatch Logs group name for the reconcile Lambda."
  value       = aws_cloudwatch_log_group.reconcile.name
}

output "s3_notification_bucket" {
  description = "The S3 bucket that fires this Lambda on ObjectCreated under the bib-payments/ prefix."
  value       = var.ses_inbox_bucket_name
}
