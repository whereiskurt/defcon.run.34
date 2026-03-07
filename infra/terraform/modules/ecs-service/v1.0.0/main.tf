data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # Expand each service across its list of regions
  expanded_services = flatten([
    for service in var.ecs_services :
    [
      for region in service.regions :
      {
        key                                = "${service.name}-${region}"
        name                               = service.name
        region                             = region
        cluster_name                       = service.cluster_name
        task_family                        = service.task_family
        desired_count                      = service.desired_count
        launch_type                        = service.launch_type
        force_new_deployment               = service.force_new_deployment
        assign_public_ip                   = service.assign_public_ip
        service_discovery                  = service.service_discovery
        load_balancers                     = service.load_balancers
        deployment_circuit_breaker         = service.deployment_circuit_breaker
        deployment_maximum_percent         = service.deployment_maximum_percent
        deployment_minimum_healthy_percent = service.deployment_minimum_healthy_percent
        health_check_grace_period_seconds  = service.health_check_grace_period_seconds
        autoscaling                        = service.autoscaling
      }
    ]
  ])

  # Filter services for the current region only
  region_services = [
    for service in local.expanded_services :
    service if service.region == var.region.full
  ]

  # Create a map of services by name for this region
  services_map = {
    for service in local.region_services :
    service.name => {
      name                               = service.name
      region                             = service.region
      cluster_name                       = service.cluster_name
      task_family                        = service.task_family
      desired_count                      = service.desired_count
      launch_type                        = service.launch_type
      force_new_deployment               = service.force_new_deployment
      assign_public_ip                   = service.assign_public_ip
      service_discovery                  = service.service_discovery
      load_balancers                     = service.load_balancers
      deployment_circuit_breaker         = service.deployment_circuit_breaker
      deployment_maximum_percent         = service.deployment_maximum_percent
      deployment_minimum_healthy_percent = service.deployment_minimum_healthy_percent
      health_check_grace_period_seconds  = service.health_check_grace_period_seconds
      autoscaling                        = service.autoscaling
      # Construct service name: name-region_label (shortened for AWS 32-char limits)
      service_name = "${service.name}-${var.region.label}"
      # Subnet selection based on assign_public_ip
      subnets = service.assign_public_ip ? var.public_subnet_ids : var.private_subnet_ids
    }
  }

  # Flatten load balancer configurations for target group creation
  load_balancer_configs = flatten([
    for service_name, service in local.services_map :
    [
      for lb_idx, lb in service.load_balancers :
      {
        key                   = "${service.service_name}-lb-${lb_idx}"
        service_name          = service.service_name
        service_key           = service_name
        type                  = lb.type
        container_name        = lb.container_name
        container_port        = lb.container_port
        target_group_port     = lb.target_group_port != null ? lb.target_group_port : lb.container_port
        target_group_protocol = lb.target_group_protocol
        proxy_protocol_v2     = lb.proxy_protocol_v2
        health_check_path     = lb.health_check_path
        health_check_protocol = lb.health_check_protocol != null ? lb.health_check_protocol : lb.target_group_protocol
        health_check          = lb.health_check
        listener = lb.listener != null ? {
          port            = lb.listener.port
          protocol        = lb.listener.protocol
          ssl_policy      = lb.listener.ssl_policy
          certificate_arn = lb.listener.certificate_arn
          host_headers    = lb.listener.host_headers
          path_patterns   = coalesce(lb.listener.path_patterns, [])
          priority        = lb.listener.priority
        } : null
      }
    ]
  ])

  # Create map of load balancer configs by key
  lb_map = {
    for lb in local.load_balancer_configs :
    lb.key => lb
  }
}

# Service Discovery Service
resource "aws_service_discovery_service" "service" {
  for_each = {
    for name, service in local.services_map :
    name => service if try(service.service_discovery.container_name, "") != ""
  }

  name = each.value.service_discovery.name

  dns_config {
    namespace_id = var.clusters[each.value.cluster_name].namespace_id

    dns_records {
      type = "A"
      ttl  = each.value.service_discovery.ttl
    }

    routing_policy = "MULTIVALUE"
  }

  tags = {
    Name    = each.value.service_discovery.name
    Service = each.key
    Region  = var.region.label
    Site    = var.site.label
  }
}

# Target Groups
resource "aws_lb_target_group" "target_group" {
  for_each = local.lb_map

  name        = "${each.value.service_name}-${each.value.target_group_port}"
  port        = each.value.target_group_port
  protocol    = each.value.target_group_protocol
  vpc_id      = var.vpc_id
  target_type = "ip"

  # Health check configuration varies by protocol
  dynamic "health_check" {
    for_each = contains(["HTTP", "HTTPS"], each.value.health_check_protocol) ? [1] : []
    content {
      enabled             = each.value.health_check.enabled
      path                = each.value.health_check_path
      protocol            = each.value.health_check_protocol
      healthy_threshold   = each.value.health_check.healthy_threshold
      unhealthy_threshold = each.value.health_check.unhealthy_threshold
      timeout             = each.value.health_check.timeout
      interval            = each.value.health_check.interval
      matcher             = each.value.health_check.matcher
    }
  }

  # For TCP/TLS, health checks are different
  dynamic "health_check" {
    for_each = contains(["TCP", "TLS"], each.value.health_check_protocol) ? [1] : []
    content {
      enabled             = each.value.health_check.enabled
      protocol            = each.value.health_check_protocol
      healthy_threshold   = each.value.health_check.healthy_threshold
      unhealthy_threshold = each.value.health_check.unhealthy_threshold
      timeout             = each.value.health_check.timeout
      interval            = each.value.health_check.interval
    }
  }

  # Enable proxy protocol v2: explicit toggle if set, otherwise auto-detect for NLB TCP targets
  proxy_protocol_v2 = each.value.proxy_protocol_v2 != null ? each.value.proxy_protocol_v2 : (each.value.type == "nlb" && each.value.target_group_protocol == "TCP" ? true : false)

  tags = {
    Name    = "${each.value.service_name}-${each.value.container_port}"
    Service = each.value.service_key
    Region  = var.region.label
    Site    = var.site.label
  }
}

# ALB Listener Rules (for existing ALB listener)
resource "aws_lb_listener_rule" "alb_rule" {
  for_each = {
    for key, lb in local.lb_map :
    key => lb if lb.type == "alb" && lb.listener != null && length(lb.listener.host_headers) > 0
  }

  listener_arn = var.alb_listener_arn
  priority     = each.value.listener.priority

  condition {
    host_header {
      values = each.value.listener.host_headers
    }
  }

  dynamic "condition" {
    for_each = length(each.value.listener.path_patterns) > 0 ? [1] : []
    content {
      path_pattern {
        values = each.value.listener.path_patterns
      }
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.target_group[each.key].arn
  }

  tags = {
    Name    = each.value.service_name
    Service = each.value.service_key
    Region  = var.region.label
    Site    = var.site.label
  }
}

# NLB Listeners (creates new listeners on NLB)
resource "aws_lb_listener" "nlb_listener" {
  for_each = {
    for key, lb in local.lb_map :
    key => lb if lb.type == "nlb" && lb.listener != null
  }

  load_balancer_arn = var.nlb_arn
  port              = each.value.listener.port
  protocol          = each.value.listener.protocol

  ssl_policy      = contains(["TLS", "HTTPS"], each.value.listener.protocol) ? each.value.listener.ssl_policy : null
  certificate_arn = contains(["TLS", "HTTPS"], each.value.listener.protocol) ? (
    each.value.listener.certificate_arn != "" ? each.value.listener.certificate_arn : var.nlb_default_certificate_arn
  ) : null

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.target_group[each.key].arn
  }

  tags = {
    Name    = "${each.value.service_name}-${each.value.listener.port}"
    Service = each.value.service_key
    Region  = var.region.label
    Site    = var.site.label
  }
}

# ECS Service
resource "aws_ecs_service" "service" {
  for_each = local.services_map

  name                 = each.value.service_name
  cluster              = var.clusters[each.value.cluster_name].cluster_id
  task_definition      = var.task_definitions[each.value.task_family]
  desired_count        = each.value.desired_count
  launch_type          = each.value.launch_type
  force_new_deployment = each.value.force_new_deployment

  network_configuration {
    subnets          = each.value.subnets
    security_groups  = var.security_group_ids
    assign_public_ip = each.value.assign_public_ip
  }

  # Service discovery registration
  dynamic "service_registries" {
    for_each = try(each.value.service_discovery.container_name, "") != "" ? [1] : []
    content {
      registry_arn   = aws_service_discovery_service.service[each.key].arn
      container_name = each.value.service_discovery.container_name
    }
  }

  # Load balancer configurations
  dynamic "load_balancer" {
    for_each = [
      for lb_idx, lb in each.value.load_balancers :
      {
        key            = "${each.value.service_name}-lb-${lb_idx}"
        container_name = lb.container_name
        container_port = lb.container_port
      }
    ]
    content {
      target_group_arn = aws_lb_target_group.target_group[load_balancer.value.key].arn
      container_name   = load_balancer.value.container_name
      container_port   = load_balancer.value.container_port
    }
  }

  deployment_circuit_breaker {
    enable   = each.value.deployment_circuit_breaker.enable
    rollback = each.value.deployment_circuit_breaker.rollback
  }

  deployment_maximum_percent         = each.value.deployment_maximum_percent
  deployment_minimum_healthy_percent = each.value.deployment_minimum_healthy_percent
  health_check_grace_period_seconds  = length(each.value.load_balancers) > 0 ? each.value.health_check_grace_period_seconds : null

  # Task definition changes are managed via VERSION files in apps/
  # Terraform will deploy new task definition revisions when version changes

  tags = {
    Name    = each.value.service_name
    Service = each.key
    Cluster = each.value.cluster_name
    Region  = var.region.label
    Site    = var.site.label
  }
}

# Autoscaling Target
resource "aws_appautoscaling_target" "service" {
  for_each = {
    for name, service in local.services_map :
    name => service if service.autoscaling.enabled
  }

  depends_on         = [aws_ecs_service.service]
  service_namespace  = "ecs"
  resource_id        = "service/${var.clusters[each.value.cluster_name].cluster_name}/${aws_ecs_service.service[each.key].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = each.value.autoscaling.min_capacity
  max_capacity       = each.value.autoscaling.max_capacity

  tags = {
    Name    = "${each.value.service_name}-autoscaling"
    Service = each.key
    Region  = var.region.label
    Site    = var.site.label
  }
}

# CPU-based Scale Out Policy
resource "aws_appautoscaling_policy" "cpu_scale_out" {
  for_each = {
    for name, service in local.services_map :
    name => service if service.autoscaling.enabled && service.autoscaling.cpu_target != null
  }

  name               = "cpu-scale-out-${aws_ecs_service.service[each.key].name}"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.service[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = each.value.autoscaling.cpu_target.cooldown
    metric_aggregation_type = "Maximum"

    step_adjustment {
      metric_interval_lower_bound = 0
      scaling_adjustment          = 1
    }
  }
}

# CPU-based Scale In Policy
resource "aws_appautoscaling_policy" "cpu_scale_in" {
  for_each = {
    for name, service in local.services_map :
    name => service if service.autoscaling.enabled && service.autoscaling.cpu_target != null
  }

  name               = "cpu-scale-in-${aws_ecs_service.service[each.key].name}"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.service[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = each.value.autoscaling.cpu_target.cooldown
    metric_aggregation_type = "Maximum"

    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = -1
    }
  }
}

# CPU High Alarm
resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  for_each = {
    for name, service in local.services_map :
    name => service if service.autoscaling.enabled && service.autoscaling.cpu_target != null
  }

  alarm_name          = "high-cpu-${aws_ecs_service.service[each.key].name}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = each.value.autoscaling.cpu_target.evaluation_periods
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = each.value.autoscaling.cpu_target.period
  statistic           = "Average"
  threshold           = each.value.autoscaling.cpu_target.scale_out_threshold
  alarm_description   = "Trigger scale-out if CPU > ${each.value.autoscaling.cpu_target.scale_out_threshold}%"
  actions_enabled     = true
  alarm_actions       = [aws_appautoscaling_policy.cpu_scale_out[each.key].arn]

  dimensions = {
    ClusterName = var.clusters[each.value.cluster_name].cluster_name
    ServiceName = aws_ecs_service.service[each.key].name
  }

  tags = {
    Name    = "high-cpu-${each.value.service_name}"
    Service = each.key
    Region  = var.region.label
    Site    = var.site.label
  }
}

# CPU Low Alarm
resource "aws_cloudwatch_metric_alarm" "cpu_low" {
  for_each = {
    for name, service in local.services_map :
    name => service if service.autoscaling.enabled && service.autoscaling.cpu_target != null
  }

  alarm_name          = "low-cpu-${aws_ecs_service.service[each.key].name}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = each.value.autoscaling.cpu_target.evaluation_periods
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = each.value.autoscaling.cpu_target.period
  statistic           = "Average"
  threshold           = each.value.autoscaling.cpu_target.scale_in_threshold
  alarm_description   = "Trigger scale-in if CPU < ${each.value.autoscaling.cpu_target.scale_in_threshold}%"
  actions_enabled     = true
  alarm_actions       = [aws_appautoscaling_policy.cpu_scale_in[each.key].arn]

  dimensions = {
    ClusterName = var.clusters[each.value.cluster_name].cluster_name
    ServiceName = aws_ecs_service.service[each.key].name
  }

  tags = {
    Name    = "low-cpu-${each.value.service_name}"
    Service = each.key
    Region  = var.region.label
    Site    = var.site.label
  }
}

# Memory-based Scale Out Policy
resource "aws_appautoscaling_policy" "memory_scale_out" {
  for_each = {
    for name, service in local.services_map :
    name => service if service.autoscaling.enabled && service.autoscaling.memory_target != null
  }

  name               = "memory-scale-out-${aws_ecs_service.service[each.key].name}"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.service[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = each.value.autoscaling.memory_target.cooldown
    metric_aggregation_type = "Maximum"

    step_adjustment {
      metric_interval_lower_bound = 0
      scaling_adjustment          = 1
    }
  }
}

# Memory-based Scale In Policy
resource "aws_appautoscaling_policy" "memory_scale_in" {
  for_each = {
    for name, service in local.services_map :
    name => service if service.autoscaling.enabled && service.autoscaling.memory_target != null
  }

  name               = "memory-scale-in-${aws_ecs_service.service[each.key].name}"
  service_namespace  = "ecs"
  resource_id        = aws_appautoscaling_target.service[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = each.value.autoscaling.memory_target.cooldown
    metric_aggregation_type = "Maximum"

    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = -1
    }
  }
}

# Memory High Alarm
resource "aws_cloudwatch_metric_alarm" "memory_high" {
  for_each = {
    for name, service in local.services_map :
    name => service if service.autoscaling.enabled && service.autoscaling.memory_target != null
  }

  alarm_name          = "high-memory-${aws_ecs_service.service[each.key].name}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = each.value.autoscaling.memory_target.evaluation_periods
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = each.value.autoscaling.memory_target.period
  statistic           = "Average"
  threshold           = each.value.autoscaling.memory_target.scale_out_threshold
  alarm_description   = "Trigger scale-out if Memory > ${each.value.autoscaling.memory_target.scale_out_threshold}%"
  actions_enabled     = true
  alarm_actions       = [aws_appautoscaling_policy.memory_scale_out[each.key].arn]

  dimensions = {
    ClusterName = var.clusters[each.value.cluster_name].cluster_name
    ServiceName = aws_ecs_service.service[each.key].name
  }

  tags = {
    Name    = "high-memory-${each.value.service_name}"
    Service = each.key
    Region  = var.region.label
    Site    = var.site.label
  }
}

# Memory Low Alarm
resource "aws_cloudwatch_metric_alarm" "memory_low" {
  for_each = {
    for name, service in local.services_map :
    name => service if service.autoscaling.enabled && service.autoscaling.memory_target != null
  }

  alarm_name          = "low-memory-${aws_ecs_service.service[each.key].name}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = each.value.autoscaling.memory_target.evaluation_periods
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = each.value.autoscaling.memory_target.period
  statistic           = "Average"
  threshold           = each.value.autoscaling.memory_target.scale_in_threshold
  alarm_description   = "Trigger scale-in if Memory < ${each.value.autoscaling.memory_target.scale_in_threshold}%"
  actions_enabled     = true
  alarm_actions       = [aws_appautoscaling_policy.memory_scale_in[each.key].arn]

  dimensions = {
    ClusterName = var.clusters[each.value.cluster_name].cluster_name
    ServiceName = aws_ecs_service.service[each.key].name
  }

  tags = {
    Name    = "low-memory-${each.value.service_name}"
    Service = each.key
    Region  = var.region.label
    Site    = var.site.label
  }
}
