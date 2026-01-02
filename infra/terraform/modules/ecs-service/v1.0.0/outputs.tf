output "services" {
  description = "Map of ECS service details by service name"
  value = {
    for name, service in aws_ecs_service.service :
    name => {
      service_id    = service.id
      service_name  = service.name
      service_arn   = service.arn
      cluster       = service.cluster
      desired_count = service.desired_count
      launch_type   = service.launch_type
    }
  }
}

output "service_discovery_services" {
  description = "Map of service discovery service details by service name"
  value = {
    for name, sd in aws_service_discovery_service.service :
    name => {
      id   = sd.id
      name = sd.name
      arn  = sd.arn
    }
  }
}

output "target_groups" {
  description = "Map of target group details by target group key"
  value = {
    for key, tg in aws_lb_target_group.target_group :
    key => {
      id       = tg.id
      name     = tg.name
      arn      = tg.arn
      port     = tg.port
      protocol = tg.protocol
    }
  }
}

output "autoscaling_targets" {
  description = "Map of autoscaling target details by service name"
  value = {
    for name, target in aws_appautoscaling_target.service :
    name => {
      id                 = target.id
      resource_id        = target.resource_id
      scalable_dimension = target.scalable_dimension
      min_capacity       = target.min_capacity
      max_capacity       = target.max_capacity
    }
  }
}
