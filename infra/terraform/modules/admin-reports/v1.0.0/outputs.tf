# Consumed by 40-06 (dashboard + alarms) so both plans read one source of truth
# for the namespace and metric names.

output "metric_namespace" {
  description = "CloudWatch namespace the activity metric filters publish into."
  value       = var.metric_namespace
}

output "metric_names" {
  description = "All DefconRun/Activity metric names produced by the filters."
  value = [
    aws_cloudwatch_log_metric_filter.signups.metric_transformation[0].name,
    aws_cloudwatch_log_metric_filter.logins.metric_transformation[0].name,
    aws_cloudwatch_log_metric_filter.gpx_uploads.metric_transformation[0].name,
    aws_cloudwatch_log_metric_filter.gpx_shares.metric_transformation[0].name,
    aws_cloudwatch_log_metric_filter.map_views.metric_transformation[0].name,
    aws_cloudwatch_log_metric_filter.strava_ratelimit_usage.metric_transformation[0].name,
    aws_cloudwatch_log_metric_filter.checkins.metric_transformation[0].name,
    aws_cloudwatch_log_metric_filter.uploads.metric_transformation[0].name,
  ]
}

output "log_group_names" {
  description = "The /ecs/* app log groups this module attaches filters/retention to."
  value       = var.log_group_names
}

output "dashboard_name" {
  description = "Name of the admin-reports CloudWatch dashboard."
  value       = aws_cloudwatch_dashboard.admin_reports.dashboard_name
}

output "query_definition_names" {
  description = "The saved admin/* Logs Insights query definition names."
  value = [
    aws_cloudwatch_query_definition.user_activity.name,
    aws_cloudwatch_query_definition.ip_activity.name,
    aws_cloudwatch_query_definition.top_ips_1h.name,
    aws_cloudwatch_query_definition.top_uploaders.name,
    aws_cloudwatch_query_definition.signups_over_time.name,
    aws_cloudwatch_query_definition.distinct_users_by_day.name,
    aws_cloudwatch_query_definition.error_spikes.name,
  ]
}
