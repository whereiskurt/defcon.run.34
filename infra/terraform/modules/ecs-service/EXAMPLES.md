# ECS Service Module Examples

This file contains examples of how to configure different app types in `site.hcl` using the `ecs_services` parameter.

## NextJS App (ALB with HTTPS)

```hcl
{
  name          = "webapp"
  regions       = ["us-east-1", "ca-central-1"]
  cluster_name  = "app"
  task_family   = "auth"  # Must match task definition family name
  desired_count = 1

  service_discovery = {
    name           = "webapp"
    container_name = "auth-app"  # Register app container in service discovery
  }

  load_balancers = [
    {
      type                  = "alb"
      container_name        = "auth-nginx"
      container_port        = 443
      target_group_protocol = "HTTPS"
      health_check_path     = "/hello"
      health_check_protocol = "HTTPS"

      health_check = {
        healthy_threshold   = 2
        unhealthy_threshold = 2
        timeout             = 5
        interval            = 30
        matcher             = "200-499"
      }

      listener = {
        port         = 443
        protocol     = "HTTPS"
        host_headers = ["run.<domain>", "*.run.<domain>"]
      }
    }
  ]

  autoscaling = {
    enabled      = true
    min_capacity = 1
    max_capacity = 10

    cpu_target = {
      scale_out_threshold = 75
      scale_in_threshold  = 25
      evaluation_periods  = 2
      period              = 60
      cooldown            = 120
    }
  }
}
```

## MQTT App (NLB with multiple ports)

```hcl
{
  name          = "run-mqtt"
  regions       = ["us-east-1", "ca-central-1"]
  cluster_name  = "app"
  task_family   = "run-mqtt"
  desired_count = 1

  service_discovery = {
    name           = "run-mqtt"
    container_name = "run-mqtt-mosquitto"
  }

  load_balancers = [
    # HTTPS for nginx web interface
    {
      type                  = "nlb"
      container_name        = "run-mqtt-nginx"
      container_port        = 443
      target_group_protocol = "TLS"

      listener = {
        port            = 443
        protocol        = "TLS"
        certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/xxx"
      }
    },
    # TCP for MQTT broker
    {
      type                  = "nlb"
      container_name        = "run-mqtt-grpc"
      container_port        = 1883
      target_group_protocol = "TCP"

      listener = {
        port     = 1883
        protocol = "TCP"
      }
    },
    # TLS for secure MQTT
    {
      type                  = "nlb"
      container_name        = "run-mqtt-grpc"
      container_port        = 1883
      target_group_port     = 1883
      target_group_protocol = "TCP"

      listener = {
        port            = 8883
        protocol        = "TLS"
        certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/xxx"
      }
    },
    # WebSocket over TLS
    {
      type                  = "nlb"
      container_name        = "run-mqtt-mosquitto"
      container_port        = 9001
      target_group_protocol = "TCP"

      listener = {
        port            = 8443
        protocol        = "TLS"
        certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/xxx"
      }
    }
  ]

  autoscaling = {
    enabled      = false
  }
}
```

## Strapi App (ALB with database)

```hcl
{
  name          = "strapi"
  regions       = ["us-east-1", "ca-central-1"]
  cluster_name  = "app"
  task_family   = "strapi"
  desired_count = 1

  service_discovery = {
    name           = "strapi"
    container_name = "strapi-app"
  }

  load_balancers = [
    {
      type                  = "alb"
      container_name        = "strapi-nginx"
      container_port        = 443
      target_group_protocol = "HTTPS"
      health_check_path     = "/hello"
      health_check_protocol = "HTTPS"

      health_check = {
        healthy_threshold   = 2
        unhealthy_threshold = 2
        timeout             = 5
        interval            = 30
        matcher             = "200-499"
      }

      listener = {
        port         = 443
        protocol     = "HTTPS"
        host_headers = ["strapi.<domain>", "*.strapi.<domain>"]
      }
    }
  ]

  deployment_circuit_breaker = {
    enable   = true
    rollback = false
  }

  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 50
  health_check_grace_period_seconds  = 300

  autoscaling = {
    enabled      = true
    min_capacity = 1
    max_capacity = 5

    cpu_target = {
      scale_out_threshold = 75
      scale_in_threshold  = 25
    }

    memory_target = {
      scale_out_threshold = 75
      scale_in_threshold  = 25
    }
  }
}
```

## Etherpad App (ALB, minimal configuration)

```hcl
{
  name          = "etherpad"
  regions       = ["us-east-1", "ca-central-1"]
  cluster_name  = "app"
  task_family   = "etherpad"
  desired_count = 1

  service_discovery = {
    name           = "etherpad"
    container_name = "etherpad-app"
  }

  load_balancers = [
    {
      type                  = "alb"
      container_name        = "etherpad-nginx"
      container_port        = 443
      target_group_protocol = "HTTPS"
      health_check_path     = "/hello"

      listener = {
        port         = 443
        protocol     = "HTTPS"
        host_headers = ["etherpad.<domain>"]
      }
    }
  ]

  autoscaling = {
    enabled = false
  }
}
```

## Simple HTTP Service (No Load Balancer)

```hcl
{
  name          = "background-worker"
  regions       = ["us-east-1"]
  cluster_name  = "app"
  task_family   = "worker"
  desired_count = 2

  service_discovery = {
    name           = "worker"
    container_name = "worker-app"
  }

  # No load balancers - internal service only
  load_balancers = []

  autoscaling = {
    enabled      = true
    min_capacity = 1
    max_capacity = 20

    cpu_target = {
      scale_out_threshold = 80
      scale_in_threshold  = 20
    }
  }
}
```

## Key Configuration Patterns

### Multi-Region Deployment

Services are automatically expanded across their `regions` list:

```hcl
regions = ["us-east-1", "ca-central-1"]  # Deploys to both regions
```

### Service Discovery

Service discovery registers containers in AWS Cloud Map for DNS-based discovery:

```hcl
service_discovery = {
  name           = "myservice"      # DNS name: myservice.namespace.local
  container_name = "app"            # Container to register
  ttl            = 10               # DNS TTL in seconds
}
```

To disable service discovery:
```hcl
service_discovery = {
  name           = "myservice"
  container_name = ""  # Empty container_name disables registration
}
```

### Load Balancer Types

**ALB (Application Load Balancer)**
- Layer 7 (HTTP/HTTPS)
- Host-based routing
- Path-based routing
- WebSocket support

**NLB (Network Load Balancer)**
- Layer 4 (TCP/TLS)
- Ultra-low latency
- Static IP addresses
- Proxy Protocol v2 support

### Multiple Load Balancers

A service can have multiple load balancer configurations:

```hcl
load_balancers = [
  {
    type           = "nlb"
    container_name = "nginx"
    container_port = 443
    # ... HTTPS listener
  },
  {
    type           = "nlb"
    container_name = "mqtt"
    container_port = 1883
    # ... TCP listener
  }
]
```

### Health Checks

Health check configuration varies by protocol:

**HTTP/HTTPS:**
```hcl
health_check_path     = "/health"
health_check_protocol = "HTTPS"
health_check = {
  healthy_threshold   = 2
  unhealthy_threshold = 2
  timeout             = 5
  interval            = 30
  matcher             = "200-299"  # HTTP status codes
}
```

**TCP/TLS:**
```hcl
health_check_protocol = "TCP"
health_check = {
  healthy_threshold   = 2
  unhealthy_threshold = 2
  timeout             = 10
  interval            = 30
}
```

### Autoscaling

**CPU-based scaling:**
```hcl
autoscaling = {
  enabled      = true
  min_capacity = 1
  max_capacity = 10

  cpu_target = {
    scale_out_threshold = 75  # Scale out above 75% CPU
    scale_in_threshold  = 25  # Scale in below 25% CPU
    evaluation_periods  = 2   # Number of periods before triggering
    period              = 60  # Period length in seconds
    cooldown            = 120 # Cooldown between scaling actions
  }
}
```

**Memory-based scaling:**
```hcl
autoscaling = {
  enabled      = true
  min_capacity = 1
  max_capacity = 10

  memory_target = {
    scale_out_threshold = 75
    scale_in_threshold  = 25
  }
}
```

**Both CPU and Memory:**
```hcl
autoscaling = {
  enabled      = true
  min_capacity = 1
  max_capacity = 10

  cpu_target = {
    scale_out_threshold = 75
    scale_in_threshold  = 25
  }

  memory_target = {
    scale_out_threshold = 75
    scale_in_threshold  = 25
  }
}
```

### Deployment Configuration

Control deployment behavior:

```hcl
deployment_circuit_breaker = {
  enable   = true   # Enable circuit breaker
  rollback = false  # Don't auto-rollback on failure
}

deployment_maximum_percent         = 200  # Allow 2x desired count during deployment
deployment_minimum_healthy_percent = 50   # Maintain at least 50% capacity
health_check_grace_period_seconds  = 300  # Wait 5 minutes before health checks
```

### Network Configuration

**Private subnets (default):**
```hcl
assign_public_ip = false  # Uses private_subnet_ids
```

**Public subnets:**
```hcl
assign_public_ip = true   # Uses public_subnet_ids
```

## Integration with Other Modules

### Task Definitions (from ecs-task module)

```hcl
# In ecs-service terragrunt.hcl
dependency "ecs_task" {
  config_path = "../ecs-task"
}

inputs = {
  task_definitions = dependency.ecs_task.outputs.task_definitions
}
```

### Clusters (from ecs-cluster module)

```hcl
dependency "ecs_cluster" {
  config_path = "../ecs-cluster"
}

inputs = {
  clusters = dependency.ecs_cluster.outputs.clusters
}
```

### Load Balancers (from alb/nlb modules)

```hcl
dependency "alb" {
  config_path = "../alb"
}

dependency "nlb" {
  config_path = "../nlb"
}

inputs = {
  alb_arn          = dependency.alb.outputs.alb_arn
  alb_listener_arn = dependency.alb.outputs.https_listener_arn
  nlb_arn          = dependency.nlb.outputs.nlb_arn
}
```

## Resource Naming

Resources follow this naming pattern:

- **Service**: `{name}-{region_label}-{zonename}` → `auth-use1-<domain-slug>`
- **Target Group**: `{service_name}-{container_port}` → `auth-use1-<domain-slug>-443`
- **Service Discovery**: `{name}.{namespace}` → `webapp.app-use1-<domain-slug>.local`

## Cost Optimization

- Use `autoscaling` to scale down during low traffic periods
- Set appropriate `min_capacity` and `max_capacity` values
- Consider `desired_count = 0` for dev environments when not in use
- NLB is charged per hour + data processed, ALB per hour + LCU usage
- Service discovery is free (included with Cloud Map)
