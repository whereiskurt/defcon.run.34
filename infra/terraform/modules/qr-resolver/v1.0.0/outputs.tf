output "resolver_function_name" {
  description = "Name of the resolver Lambda function."
  value       = aws_lambda_function.resolver.function_name
}

output "resolver_function_arn" {
  description = "ARN of the resolver Lambda function."
  value       = aws_lambda_function.resolver.arn
}

output "resolver_log_group_name" {
  description = "CloudWatch Logs group the resolver writes one JSON line per scan to (rollup source)."
  value       = aws_cloudwatch_log_group.resolver.name
}

output "rollup_function_name" {
  description = "Name of the analytics rollup Lambda function."
  value       = aws_lambda_function.rollup.function_name
}

output "rollup_function_arn" {
  description = "ARN of the rollup Lambda function."
  value       = aws_lambda_function.rollup.arn
}

output "rollup_schedule_expression" {
  description = "EventBridge schedule driving the rollup."
  value       = aws_cloudwatch_event_rule.rollup_cron.schedule_expression
}

output "resolver_target_group_arn" {
  description = "ARN of the ALB->Lambda target group when enable_transport = true, else empty."
  value       = var.enable_transport ? aws_lb_target_group.resolver[0].arn : ""
}

output "resolver_distribution_id" {
  description = "Id of the q.defcon.run CloudFront distribution when enable_transport = true, else empty."
  value       = var.enable_transport ? aws_cloudfront_distribution.resolver[0].id : ""
}

output "resolver_distribution_domain_name" {
  description = "CloudFront domain name (dxxx.cloudfront.net) fronting the resolver when enable_transport = true, else empty."
  value       = var.enable_transport ? aws_cloudfront_distribution.resolver[0].domain_name : ""
}

output "resolver_distribution_arn" {
  description = "ARN of the q.defcon.run CloudFront distribution when enable_transport = true, else empty."
  value       = var.enable_transport ? aws_cloudfront_distribution.resolver[0].arn : ""
}
