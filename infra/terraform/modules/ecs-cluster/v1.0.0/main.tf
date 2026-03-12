data "aws_caller_identity" "current" {}

locals {
  # Filter clusters for the current region
  region_clusters = [
    for cluster in var.ecs_clusters :
    cluster if cluster.region == var.region.full
  ]

  # Create a map of clusters by name for this region
  clusters_map = {
    for cluster in local.region_clusters :
    cluster.name => {
      name            = cluster.name
      region          = cluster.region
      enable_insights = cluster.enable_insights
      cluster_type    = cluster.cluster_type
      # Generate cluster name: name-region_label-dns-zonename (e.g., "app-use1-<domain-slug>")
      cluster_name = "${cluster.name}-${var.region.label}-${var.site.label}"
      # Generate namespace name: name-region_label-site_label.local (e.g., "app-use1-dc34.local")
      namespace_name = cluster.namespace_name != "" ? cluster.namespace_name : "${cluster.name}-${var.region.label}-${var.site.label}.local"
    }
  }
}

# Service Discovery Private DNS Namespace
resource "aws_service_discovery_private_dns_namespace" "namespace" {
  for_each = local.clusters_map

  name        = each.value.namespace_name
  description = "Private DNS namespace for ${each.value.cluster_name}"
  vpc         = var.vpc_id

  tags = {
    Name        = each.value.namespace_name
    ClusterName = each.key
    Region      = var.region.label
    Site        = var.site.label
  }
}

# ECS Cluster
resource "aws_ecs_cluster" "cluster" {
  for_each = local.clusters_map

  name = each.value.cluster_name

  setting {
    name  = "containerInsights"
    value = each.value.enable_insights ? "enabled" : "disabled"
  }

  tags = {
    Name        = each.value.cluster_name
    ClusterName = each.key
    ClusterType = each.value.cluster_type
    Region      = var.region.label
    Site        = var.site.label
  }
}

# IAM Role for ECS Tasks
resource "aws_iam_role" "ecs_task_role" {
  for_each = local.clusters_map

  name = "ecs-task-role-${each.value.cluster_name}-${var.site.random_suffix}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
        Condition = {
          ArnLike = {
            "aws:SourceArn" = "arn:aws:ecs:${var.region.full}:${data.aws_caller_identity.current.account_id}:*"
          }
          StringEquals = {
            "aws:SourceAccount" = data.aws_caller_identity.current.account_id
          }
        }
      }
    ]
  })

  tags = {
    Name        = "ecs-task-role-${each.value.cluster_name}"
    ClusterName = each.key
    Region      = var.region.label
    Site        = var.site.label
  }
}

# IAM Policy for ECS Task Role
resource "aws_iam_role_policy" "ecs_task_policy" {
  for_each = local.clusters_map

  name = "ecs-task-policy-${each.value.cluster_name}"
  role = aws_iam_role.ecs_task_role[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "servicediscovery:*",
          "ssm:*",
          "s3:*",
          "dynamodb:*",
          "ecr:*",
          "logs:*",
          "cloudwatch:*",
          "cloudwatchlogs:*",
          "cloudtrail:*",
          "kms:*",
          "secretsmanager:*",
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = "*"
      }
    ]
  })
}

# Attach AWS Managed Policy for ECS Task Execution
resource "aws_iam_role_policy_attachment" "ecs_task_execution_policy" {
  for_each = local.clusters_map

  role       = aws_iam_role.ecs_task_role[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Attach AWS Managed Policy for CloudWatch
resource "aws_iam_role_policy_attachment" "ecs_task_cloudwatch_policy" {
  for_each = local.clusters_map

  role       = aws_iam_role.ecs_task_role[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchFullAccessV2"
}
