# =============================================================================
# abuse-detection — Lambda/alert outputs (Plan 03)
#
# NEW output file (single-file ownership): Plan 01's outputs.tf only declares
# outputs for resources that existed after Plan 01. The Lambda + reused-topic
# outputs live here so the Plan 05 wiring/checkpoint can reference them.
# =============================================================================

output "lambda_function_name" {
  description = "Name of the abuse-detector Lambda."
  value       = aws_lambda_function.detector.function_name
}

output "lambda_function_arn" {
  description = "ARN of the abuse-detector Lambda."
  value       = aws_lambda_function.detector.arn
}

output "event_rule_name" {
  description = "Name of the EventBridge cron rule that invokes the detector (state gated by schedule_enabled)."
  value       = aws_cloudwatch_event_rule.detector.name
}

output "sns_topic_arn" {
  description = "The reused Phase 40 SNS topic ARN (composed, not created by this module)."
  value       = local.sns_topic_arn
}
