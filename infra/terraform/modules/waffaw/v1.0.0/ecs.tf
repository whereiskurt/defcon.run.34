# ECS cluster and service for Fargate tasks (Tier 2: rotating IPs)

resource "aws_ecs_cluster" "waffaw" {
  count = var.waffaw.enabled ? 1 : 0

  name = "waffaw-${var.region.label}-${var.site.label}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name   = "waffaw-${var.region.label}"
    Region = var.region.label
    Site   = var.site.label
  }
}

# Capacity provider: FARGATE_SPOT by default
resource "aws_ecs_cluster_capacity_providers" "waffaw" {
  count = var.waffaw.enabled ? 1 : 0

  cluster_name = aws_ecs_cluster.waffaw[0].name

  capacity_providers = var.waffaw.ecs_use_spot ? ["FARGATE_SPOT", "FARGATE"] : ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = var.waffaw.ecs_use_spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
    base              = 0
  }
}

# Task definition for the waffaw agent
resource "aws_ecs_task_definition" "waffaw" {
  count = var.waffaw.enabled ? 1 : 0

  family                   = "waffaw-${var.region.label}-${var.site.label}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.waffaw.ecs_task_cpu
  memory                   = var.waffaw.ecs_task_memory
  task_role_arn            = aws_iam_role.node[0].arn
  execution_role_arn       = aws_iam_role.ecs_execution[0].arn

  container_definitions = jsonencode([
    {
      name      = "waffaw-agent"
      image     = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region.full}.amazonaws.com/${var.image_uri}"
      essential = true
      cpu       = var.waffaw.ecs_task_cpu
      memory    = var.waffaw.ecs_task_memory

      environment = [
        { name = "CONTROL_BUCKET", value = aws_s3_bucket.control[0].bucket },
        { name = "REGION", value = var.region.full },
        { name = "NODE_TYPE", value = "fargate" },
        { name = "LOG_LEVEL", value = "normal" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-region"        = var.region.full
          "awslogs-group"         = aws_cloudwatch_log_group.waffaw[0].name
          "awslogs-stream-prefix" = "fargate"
          "awslogs-create-group"  = "true"
        }
      }
    }
  ])

  tags = {
    Name   = "waffaw-task-${var.region.label}"
    Region = var.region.label
    Site   = var.site.label
  }
}

# ECS service
resource "aws_ecs_service" "waffaw" {
  count = var.waffaw.enabled ? 1 : 0

  name            = "waffaw-${var.region.label}"
  cluster         = aws_ecs_cluster.waffaw[0].id
  task_definition = aws_ecs_task_definition.waffaw[0].arn
  desired_count   = var.waffaw.ecs_desired_count

  capacity_provider_strategy {
    capacity_provider = var.waffaw.ecs_use_spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
    base              = 0
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.node[0].id]
    assign_public_ip = true
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = false
  }

  tags = {
    Name   = "waffaw-service-${var.region.label}"
    Region = var.region.label
    Site   = var.site.label
  }
}
