output "control_bucket_name" {
  description = "Name of the S3 control plane bucket"
  value       = var.waffaw.enabled ? aws_s3_bucket.control[0].bucket : null
}

output "log_bucket_name" {
  description = "Name of the S3 logs bucket"
  value       = var.waffaw.enabled ? aws_s3_bucket.logs[0].bucket : null
}

output "vpc_id" {
  description = "ID of the waffaw VPC"
  value       = var.waffaw.enabled ? aws_vpc.waffaw[0].id : null
}

output "node_role_arn" {
  description = "ARN of the IAM role used by waffaw nodes"
  value       = var.waffaw.enabled ? aws_iam_role.node[0].arn : null
}

output "ecs_cluster_name" {
  description = "Name of the waffaw ECS cluster"
  value       = var.waffaw.enabled ? aws_ecs_cluster.waffaw[0].name : null
}

output "log_group_name" {
  description = "Name of the CloudWatch log group"
  value       = var.waffaw.enabled ? aws_cloudwatch_log_group.waffaw[0].name : null
}

output "athena_workgroup" {
  description = "Name of the Athena workgroup"
  value       = var.waffaw.enabled ? aws_athena_workgroup.waffaw[0].name : null
}
