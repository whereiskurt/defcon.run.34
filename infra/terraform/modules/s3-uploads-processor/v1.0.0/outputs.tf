# SNS Topics
output "sns_topic_arns" {
  description = "Map of SNS topic ARNs by processor name"
  value = {
    for name, topic in aws_sns_topic.upload_notifications : name => topic.arn
  }
}

output "sns_topic_names" {
  description = "Map of SNS topic names by processor name"
  value = {
    for name, topic in aws_sns_topic.upload_notifications : name => topic.name
  }
}

# Lambda Functions
output "on_upload_lambda_arns" {
  description = "Map of on-upload Lambda ARNs by processor name"
  value = {
    for name, fn in aws_lambda_function.on_upload : name => fn.arn
  }
}

output "on_upload_lambda_names" {
  description = "Map of on-upload Lambda function names by processor name"
  value = {
    for name, fn in aws_lambda_function.on_upload : name => fn.function_name
  }
}

output "processor_lambda_arns" {
  description = "Map of processor Lambda ARNs by processor name"
  value = {
    for name, fn in aws_lambda_function.processor : name => fn.arn
  }
}

output "processor_lambda_names" {
  description = "Map of processor Lambda function names by processor name"
  value = {
    for name, fn in aws_lambda_function.processor : name => fn.function_name
  }
}

# Processor names
output "processor_names" {
  description = "List of processor names in this region"
  value       = keys(local.processors_map)
}
