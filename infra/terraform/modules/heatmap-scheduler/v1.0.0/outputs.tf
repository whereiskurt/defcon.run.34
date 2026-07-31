# Outputs for heatmap-scheduler v1.0.0.

output "function_name" {
  value = aws_lambda_function.sync.function_name
}

output "function_arn" {
  value = aws_lambda_function.sync.arn
}

output "schedule_names" {
  description = "Names of all EventBridge schedules created (one per var.schedules entry)."
  value       = [for s in aws_scheduler_schedule.sync : s.name]
}
