# Outputs for strava-sync-scheduler (v1.7 Phase 33).

output "function_name" {
  value = aws_lambda_function.sync.function_name
}

output "function_arn" {
  value = aws_lambda_function.sync.arn
}

output "schedule_name" {
  value = aws_scheduler_schedule.sync.name
}
